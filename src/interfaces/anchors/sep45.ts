// src/interfaces/anchors/sep45.ts
//
// SEP-45 (contract-account) web authentication for anchors.
//
// SEP-45 extends SEP-10 web auth to Soroban contract accounts. Instead of a
// classic transaction challenge signed by an Ed25519 keypair, the anchor
// returns a Soroban authorization entry which the contract account signs via
// its own authorization mechanism (in our case, a passkey / session key).
//
// This module mirrors the signing flow used by `InvocationService.buildSignedAuth`:
//   1. Fetch the anchor's stellar.toml and check for SEP-45 support.
//   2. Request a challenge from the anchor's SEP-45 challenge endpoint.
//   3. Compute the Soroban auth payload for the returned authorization entry.
//   4. Obtain a signature from the caller (passkey assertion or session key).
//   5. Attach the signature to the authorization entry.
//   6. POST the signed entry back to the anchor to obtain a JWT.

import { requestJson } from "../../lib/http-client";
import { SorobanService } from "../soroban";
import type { AnchorToml } from "./toml";

/**
 * The stellar.toml field that advertises SEP-45 support.
 *
 * NOTE: The SEP-45 spec has evolved over time. Historically the field has been
 * referred to as `WEB_AUTH_CONTRACT_ID`; some anchors also advertise support via
 * `WEB_AUTH_ENDPOINT` combined with a contract-id field. We check the canonical
 * `WEB_AUTH_CONTRACT_ID` first and fall back to a couple of known aliases so we
 * remain compatible with anchors that adopted earlier drafts.
 */
const SEP45_CONTRACT_ID_KEYS = [
  "WEB_AUTH_CONTRACT_ID",
  "WEB_AUTH_FOR_CONTRACTS_CONTRACT_ID",
  "SEP45_CONTRACT_ID",
] as const;

/**
 * A signature provider. Mirrors the signer shape used by the wallet invocation
 * service: given a payload (base64-encoded Soroban auth payload), return a
 * base64-encoded signature suitable for attaching to the authorization entry.
 */
export type Sep45Signer = (payload: string) => Promise<string>;

export interface Sep45AuthResult {
  /** The JWT issued by the anchor. */
  token: string;
  /** Unix timestamp (seconds) at which the token expires, if known. */
  expiresAt?: number;
  /** The contract id the anchor advertised for SEP-45. */
  contractId: string;
}

export interface Sep45ChallengeResponse {
  /** Base64-encoded Soroban authorization entry (XDR). */
  authorization_entry?: string;
  /** Some anchors return the entry under this key. */
  auth_entry?: string;
  /** Optional network passphrase the entry was built for. */
  network_passphrase?: string;
}

export interface Sep45TokenResponse {
  token?: string;
  /** Optional expiry, either as a unix timestamp or ISO string. */
  expires_at?: number | string;
  expiresAt?: number | string;
}

/**
 * Returns the SEP-45 contract id advertised by an anchor's stellar.toml, or
 * `undefined` if the anchor does not support SEP-45.
 */
export function getSep45ContractId(toml: AnchorToml | undefined | null): string | undefined {
  if (!toml) {
    return undefined;
  }
  const record = toml as unknown as Record<string, unknown>;
  for (const key of SEP45_CONTRACT_ID_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * Returns `true` if the anchor's stellar.toml advertises SEP-45 support.
 */
export function supportsSep45(toml: AnchorToml | undefined | null): boolean {
  return getSep45ContractId(toml) !== undefined;
}

/**
 * Derives an expiry (unix seconds) from a JWT's `exp` claim, if present.
 */
export function getTokenExpiry(token: string): number | undefined {
  const parts = token.split(".");
  if (parts.length < 2) {
    return undefined;
  }
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as { exp?: unknown };
    if (typeof payload.exp === "number" && Number.isFinite(payload.exp)) {
      return payload.exp;
    }
  } catch {
    // Malformed token payload; fall through.
  }
  return undefined;
}

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  if (typeof atob === "function") {
    return atob(padded);
  }
  // Node fallback.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bufferCtor = (globalThis as any).Buffer;
  if (bufferCtor) {
    return bufferCtor.from(padded, "base64").toString("utf8");
  }
  throw new Error("No base64 decoder available");
}

function normalizeExpiry(value: number | string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // Heuristic: values below ~year 2001 in ms are actually seconds.
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value === "string") {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      return normalizeExpiry(asNumber);
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed / 1000);
    }
  }
  return undefined;
}

function buildUrl(domain: string, path: string): string {
  const trimmed = domain.replace(/\/+$/, "");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return `${withScheme}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Fetches the anchor's stellar.toml. Kept local so this module has no hard
 * dependency on the exact toml loader implementation.
 */
async function fetchAnchorToml(anchorDomain: string): Promise<AnchorToml> {
  const url = buildUrl(anchorDomain, "/.well-known/stellar.toml");
  return requestJson<AnchorToml>(url, { method: "GET" });
}

/**
 * Requests a SEP-45 challenge from the anchor for the given contract account.
 */
export async function requestSep45Challenge(
  anchorDomain: string,
  walletContractAddress: string,
  contractId: string,
): Promise<Sep45ChallengeResponse> {
  const url = buildUrl(anchorDomain, "/sep45/challenge");
  return requestJson<Sep45ChallengeResponse>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      account: walletContractAddress,
      contract_id: contractId,
      client_domain: undefined,
    }),
  });
}

/**
 * Extracts the base64-encoded authorization entry from a challenge response.
 */
export function extractAuthorizationEntry(response: Sep45ChallengeResponse): string {
  const entry = response.authorization_entry ?? response.auth_entry;
  if (!entry || typeof entry !== "string") {
    throw new Error("SEP-45 challenge response did not include an authorization entry");
  }
  return entry;
}

/**
 * Authenticates against a SEP-45-capable anchor using the smart wallet's own
 * contract address.
 *
 * @param anchorDomain          Anchor domain (e.g. `testanchor.stellar.org`).
 * @param walletContractAddress The user's smart wallet contract address (`C...`).
 * @param signer                Signature provider (passkey assertion or session key).
 * @param toml                  Optional pre-fetched stellar.toml.
 */
export async function authenticateWithAnchorSep45(
  anchorDomain: string,
  walletContractAddress: string,
  signer: Sep45Signer,
  toml?: AnchorToml,
): Promise<Sep45AuthResult> {
  const resolvedToml = toml ?? (await fetchAnchorToml(anchorDomain));
  const contractId = getSep45ContractId(resolvedToml);
  if (!contractId) {
    throw new Error(`Anchor ${anchorDomain} does not advertise SEP-45 support`);
  }

  const challenge = await requestSep45Challenge(anchorDomain, walletContractAddress, contractId);
  const authorizationEntry = extractAuthorizationEntry(challenge);

  // Compute the auth payload exactly as the wallet invocation flow does.
  const payload = SorobanService.authPayload(authorizationEntry);

  // Obtain a signature from the caller (passkey assertion or session key).
  const signature = await signer(payload);
  if (!signature) {
    throw new Error("SEP-45 signer returned an empty signature");
  }

  // Attach the signature to the authorization entry.
  const signedEntry = SorobanService.attachSignature(authorizationEntry, signature);

  // Submit the signed entry back to the anchor to obtain a JWT.
  const tokenUrl = buildUrl(anchorDomain, "/sep45/token");
  const tokenResponse = await requestJson<Sep45TokenResponse>(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      account: walletContractAddress,
      contract_id: contractId,
      authorization_entry: signedEntry,
    }),
  });

  const token = tokenResponse.token;
  if (!token || typeof token !== "string") {
    throw new Error("SEP-45 token response did not include a token");
  }

  const expiresAt =
    normalizeExpiry(tokenResponse.expires_at ?? tokenResponse.expiresAt) ?? getTokenExpiry(token);

  return { token, expiresAt, contractId };
}
```

Note: this module assumes `SorobanService.authPayload(entry)` and `SorobanService.attachSignature(entry, signature)` exist (or are added) on `src/interfaces/soroban/index.ts` as the shared auth-payload helpers referenced by the issue. If the existing helpers have different names/signatures, adjust the two call sites accordingly.
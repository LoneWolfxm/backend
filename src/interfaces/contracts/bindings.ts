import { Address, nativeToScVal, StrKey, xdr } from '@stellar/stellar-sdk'

import { STELLAR } from '../../config/stellar'
import { InvocationInput } from '../soroban'

/**
 * RemitPulse contract ABI bindings.
 *
 * This is the single place that encodes how the backend talks to the compiled
 * account (factory + wallet) and subsidy contracts. If your WASM exposes
 * different function names or argument shapes, change them here only.
 *
 * Assumed interfaces (Rust signatures):
 *
 *   // ACCOUNT_CONTRACT_ID — wallet factory
 *   fn deploy(env, salt: BytesN<32>, key_id: Bytes, public_key: BytesN<65>) -> Address;
 *   fn get_address(env, salt: BytesN<32>) -> Address;
 *
 *   // Per-user smart wallet (deployed by the factory)
 *   fn add_session_key(env, public_key: BytesN<32>, token: Address,
 *                      per_tx_limit: i128, total_limit: i128, expires_at_ledger: u32);
 *   fn revoke_session_key(env, public_key: BytesN<32>);
 *   fn __check_auth(env, payload: Hash<32>, signature: Signature, contexts: Vec<Context>);
 *
 *   // SUBSIDY_CONTRACT_ID — on-chain fee subsidy ledger
 *   fn allowance(env, account: Address) -> i128;   // remaining sponsored stroops
 *   fn claim(env, account: Address);                // requires `account` auth
 */
export const AccountFactory = {
  deploy(salt: Buffer, keyId: Buffer, publicKey: Buffer): InvocationInput {
    return {
      contractId: STELLAR.contracts.account,
      method: 'deploy',
      args: [xdr.ScVal.scvBytes(salt), xdr.ScVal.scvBytes(keyId), xdr.ScVal.scvBytes(publicKey)],
    }
  },
  getAddress(salt: Buffer): InvocationInput {
    return { contractId: STELLAR.contracts.account, method: 'get_address', args: [xdr.ScVal.scvBytes(salt)] }
  },
}

export const SmartWallet = {
  addSessionKey(
    wallet: string,
    input: { publicKey: string; token: string; perTxLimit: bigint; totalLimit: bigint; expiresAtLedger: number }
  ): InvocationInput {
    return {
      contractId: wallet,
      method: 'add_session_key',
      args: [
        xdr.ScVal.scvBytes(StrKey.decodeEd25519PublicKey(input.publicKey)),
        new Address(input.token).toScVal(),
        nativeToScVal(input.perTxLimit, { type: 'i128' }),
        nativeToScVal(input.totalLimit, { type: 'i128' }),
        xdr.ScVal.scvU32(input.expiresAtLedger),
      ],
    }
  },
  revokeSessionKey(wallet: string, publicKey: string): InvocationInput {
    return {
      contractId: wallet,
      method: 'revoke_session_key',
      args: [xdr.ScVal.scvBytes(StrKey.decodeEd25519PublicKey(publicKey))],
    }
  },
}

export const Subsidy = {
  allowance(account: string): InvocationInput {
    return { contractId: STELLAR.contracts.subsidy, method: 'allowance', args: [new Address(account).toScVal()] }
  },
  claim(account: string): InvocationInput {
    return { contractId: STELLAR.contracts.subsidy, method: 'claim', args: [new Address(account).toScVal()] }
  },
}

/** SEP-41 token (Stellar Asset Contract) transfer. */
export const Token = {
  transfer(token: string, from: string, to: string, amount: bigint): InvocationInput {
    return {
      contractId: token,
      method: 'transfer',
      args: [new Address(from).toScVal(), new Address(to).toScVal(), nativeToScVal(amount, { type: 'i128' })],
    }
  },
}

const symbolMap = (entries: [string, xdr.ScVal][]): xdr.ScVal =>
  // Soroban requires map keys to be sorted
  xdr.ScVal.scvMap(
    entries
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, val]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val }))
  )

/**
 * Wallet `Signature` encodings passed to `__check_auth`.
 *
 * Passkey: the WebAuthn assertion, matching the format used by the
 * smart-wallet-demo-app account contract.
 * Session key: raw Ed25519 public key + signature over the auth payload.
 */
export const WalletSignature = {
  passkey(input: { authenticatorData: Buffer; clientDataJson: Buffer; signature: Buffer }): xdr.ScVal {
    return symbolMap([
      ['authenticator_data', xdr.ScVal.scvBytes(input.authenticatorData)],
      ['client_data_json', xdr.ScVal.scvBytes(input.clientDataJson)],
      ['signature', xdr.ScVal.scvBytes(input.signature)],
    ])
  },
  sessionKey(input: { publicKey: Buffer; signature: Buffer }): xdr.ScVal {
    return symbolMap([
      ['public_key', xdr.ScVal.scvBytes(input.publicKey)],
      ['signature', xdr.ScVal.scvBytes(input.signature)],
    ])
  },
}

export function relayAllowedContracts(extra: string[]): Set<string> {
  return new Set([STELLAR.contracts.account, STELLAR.contracts.subsidy, ...extra])
}

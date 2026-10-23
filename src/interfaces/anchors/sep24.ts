import { Keypair } from '@stellar/stellar-sdk'

import { env } from '../../config/env'
import { UpstreamError } from '../../errors'
import { requestJson } from '../../lib/http-client'
import { getAnchorToml } from './toml'

export type InteractiveFlowResponse = { type: string; url: string; id: string }

export type Sep24Transaction = {
  id: string
  kind: 'deposit' | 'withdrawal'
  status: string
  status_eta?: number
  amount_in?: string
  amount_out?: string
  amount_fee?: string
  started_at?: string
  completed_at?: string
  stellar_transaction_id?: string
  more_info_url?: string
  withdraw_anchor_account?: string
  withdraw_memo?: string
  withdraw_memo_type?: string
  message?: string
}

async function transferServer(anchorDomain: string): Promise<string> {
  const toml = await getAnchorToml(anchorDomain)
  if (!toml.transferServerSep24) throw new UpstreamError('anchor', `${anchorDomain} does not advertise TRANSFER_SERVER_SEP0024`)
  return toml.transferServerSep24
}

/** Starts a SEP-24 interactive deposit (fiat/local rail -> corridor asset into `account`). */
export async function startDeposit(
  anchorDomain: string,
  token: string,
  input: { assetCode: string; account: string; amount?: string; lang?: string }
): Promise<InteractiveFlowResponse> {
  const base = await transferServer(anchorDomain)
  return requestJson<InteractiveFlowResponse>('anchor', `${base}/transactions/deposit/interactive`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    form: { asset_code: input.assetCode, account: input.account, amount: input.amount, lang: input.lang ?? 'en' },
    timeoutMs: env.ANCHOR_REQUEST_TIMEOUT_MS,
  })
}

/** Starts a SEP-24 interactive withdrawal (corridor asset from `account` -> fiat/local rail). */
export async function startWithdrawal(
  anchorDomain: string,
  token: string,
  input: { assetCode: string; account: string; amount?: string; lang?: string }
): Promise<InteractiveFlowResponse> {
  const base = await transferServer(anchorDomain)
  return requestJson<InteractiveFlowResponse>('anchor', `${base}/transactions/withdraw/interactive`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    form: { asset_code: input.assetCode, account: input.account, amount: input.amount, lang: input.lang ?? 'en' },
    timeoutMs: env.ANCHOR_REQUEST_TIMEOUT_MS,
  })
}

/** Polls the anchor for the latest status of a previously started SEP-24 transaction. */
export async function fetchTransaction(anchorDomain: string, token: string, anchorTxId: string): Promise<Sep24Transaction> {
  const base = await transferServer(anchorDomain)
  const { transaction } = await requestJson<{ transaction: Sep24Transaction }>('anchor', `${base}/transaction`, {
    headers: { authorization: `Bearer ${token}` },
    query: { id: anchorTxId },
    timeoutMs: env.ANCHOR_REQUEST_TIMEOUT_MS,
  })
  return transaction
}

/**
 * Verifies the `Signature: t=<unix seconds>, s=<base64 ed25519 sig>` header some anchors
 * (e.g. Stellar's Anchor Platform) attach to SEP-24 status-change callbacks, signed with the
 * same SIGNING_KEY published in the anchor's stellar.toml (SEP-1).
 */
export async function verifyWebhookSignature(anchorDomain: string, rawBody: Buffer, signatureHeader: string | undefined): Promise<void> {
  if (!env.WEBHOOK_REQUIRE_SIGNATURE) return
  if (!signatureHeader) throw new UpstreamError('anchor', 'missing Signature header on webhook')

  const parts = Object.fromEntries(
    signatureHeader.split(',').map(part => {
      const [key, value] = part.trim().split('=')
      return [key, value]
    })
  )
  const timestamp = Number(parts.t)
  const signature = parts.s
  if (!timestamp || !signature) throw new UpstreamError('anchor', 'malformed Signature header on webhook')
  if (Math.abs(Date.now() / 1000 - timestamp) > env.WEBHOOK_MAX_AGE_SECONDS) {
    throw new UpstreamError('anchor', 'webhook signature timestamp outside allowed window')
  }

  const toml = await getAnchorToml(anchorDomain)
  if (!toml.signingKey) throw new UpstreamError('anchor', `${anchorDomain} does not advertise a SIGNING_KEY`)

  const payload = Buffer.from(`${timestamp}.${rawBody.toString('utf8')}`)
  const verified = Keypair.fromPublicKey(toml.signingKey).verify(payload, Buffer.from(signature, 'base64'))
  if (!verified) throw new UpstreamError('anchor', 'webhook signature verification failed')
}

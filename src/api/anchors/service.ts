import { RemittanceStatus } from '@prisma/client'
import { Asset } from '@stellar/stellar-sdk'

import { prisma } from '../../config/database'
import { BadRequestError, NotFoundError } from '../../errors'
import { deriveAnchorKeypair, ensureAnchorAccount } from '../../interfaces/anchors/custody'
import { authenticateWithAnchor } from '../../interfaces/anchors/sep10'
import { fetchTransaction, Sep24Transaction, startDeposit, startWithdrawal, verifyWebhookSignature } from '../../interfaces/anchors/sep24'
import { decrypt, encrypt } from '../../lib/crypto'
import { getCorridor } from '../corridors/service'

function mapAnchorStatus(status: string): RemittanceStatus {
  switch (status) {
    case 'incomplete':
      return 'incomplete'
    case 'pending_user_transfer_start':
    case 'pending_user_transfer_complete':
    case 'pending_trust':
    case 'pending_user':
      return 'pending_user_transfer'
    case 'pending_external':
    case 'pending_anchor':
    case 'pending_stellar':
      return 'pending_anchor'
    case 'completed':
      return 'completed'
    case 'error':
    case 'no_market':
    case 'too_small':
    case 'too_large':
    case 'expired':
    case 'refunded':
      return 'failed'
    default:
      return 'pending_anchor'
  }
}

/** Ensures a live SEP-10 session with the corridor's anchor, authenticating if needed. */
async function ensureAnchorSession(userId: string, corridorId: string, anchorDomain: string, account: string) {
  const existing = await prisma.anchorSession.findUnique({ where: { userId_corridorId_account: { userId, corridorId, account } } })
  if (existing && existing.expiresAt > new Date(Date.now() + 60_000)) return decrypt(existing.encryptedToken)

  const keypair = deriveAnchorKeypair(userId)
  const { token, expiresAt } = await authenticateWithAnchor(anchorDomain, keypair)
  await prisma.anchorSession.upsert({
    where: { userId_corridorId_account: { userId, corridorId, account } },
    create: { userId, corridorId, account, encryptedToken: encrypt(token), expiresAt },
    update: { encryptedToken: encrypt(token), expiresAt },
  })
  return token
}

export async function authenticate(userId: string, code: string) {
  const corridor = await getCorridor(code)
  const keypair = deriveAnchorKeypair(userId)
  const token = await ensureAnchorSession(userId, corridor.id, corridor.anchorDomain, keypair.publicKey())
  return { account: keypair.publicKey(), anchorDomain: corridor.anchorDomain, authenticated: Boolean(token) }
}

async function initiate(
  userId: string,
  code: string,
  kind: 'deposit' | 'withdrawal',
  amount?: string
) {
  const corridor = await getCorridor(code)
  const keypair = deriveAnchorKeypair(userId)
  const asset = new Asset(corridor.assetCode, corridor.assetIssuer)

  await ensureAnchorAccount(keypair, asset)
  const token = await ensureAnchorSession(userId, corridor.id, corridor.anchorDomain, keypair.publicKey())

  const flow = kind === 'deposit'
    ? await startDeposit(corridor.anchorDomain, token, { assetCode: corridor.assetCode, account: keypair.publicKey(), amount })
    : await startWithdrawal(corridor.anchorDomain, token, { assetCode: corridor.assetCode, account: keypair.publicKey(), amount })

  const transaction = await prisma.remittanceTransaction.create({
    data: {
      userId,
      corridorId: corridor.id,
      kind,
      account: keypair.publicKey(),
      anchorTxId: flow.id,
      status: 'incomplete',
      anchorStatus: 'incomplete',
      amountIn: kind === 'deposit' ? amount : undefined,
      interactiveUrl: flow.url,
      events: {
        create: { source: 'initiation', toStatus: 'incomplete', anchorStatus: 'incomplete', payload: flow as object },
      },
    },
  })

  return { transactionId: transaction.id, interactiveUrl: flow.url, anchorTxId: flow.id, account: keypair.publicKey() }
}

export const initiateDeposit = (userId: string, code: string, amount?: string) => initiate(userId, code, 'deposit', amount)
export const initiateWithdrawal = (userId: string, code: string, amount?: string) => initiate(userId, code, 'withdrawal', amount)

async function recordUpdate(transactionId: string, source: 'webhook' | 'poll', remote: Sep24Transaction) {
  const current = await prisma.remittanceTransaction.findUniqueOrThrow({ where: { id: transactionId } })
  const toStatus = mapAnchorStatus(remote.status)
  if (toStatus === current.status && remote.status === current.anchorStatus) return current

  return prisma.remittanceTransaction.update({
    where: { id: transactionId },
    data: {
      status: toStatus,
      anchorStatus: remote.status,
      amountIn: remote.amount_in,
      amountOut: remote.amount_out,
      amountFee: remote.amount_fee,
      moreInfoUrl: remote.more_info_url,
      stellarTxHash: remote.stellar_transaction_id,
      withdrawAnchorAccount: remote.withdraw_anchor_account,
      withdrawMemo: remote.withdraw_memo,
      withdrawMemoType: remote.withdraw_memo_type,
      statusMessage: remote.message,
      completedAt: toStatus === 'completed' ? new Date() : current.completedAt,
      events: {
        create: { source, fromStatus: current.status, toStatus, anchorStatus: remote.status, payload: remote as object },
      },
    },
  })
}

/** Handles an anchor's SEP-24 status-change callback for a corridor. */
export async function handleWebhook(code: string, rawBody: Buffer, signatureHeader: string | undefined) {
  const corridor = await getCorridor(code, { activeOnly: false })
  await verifyWebhookSignature(corridor.anchorDomain, rawBody, signatureHeader)

  const body = JSON.parse(rawBody.toString('utf8')) as { transaction?: Sep24Transaction } & Partial<Sep24Transaction>
  const remote = body.transaction ?? (body as Sep24Transaction)
  if (!remote?.id) throw new BadRequestError('Webhook payload is missing transaction.id')

  const transaction = await prisma.remittanceTransaction.findUnique({ where: { corridorId_anchorTxId: { corridorId: corridor.id, anchorTxId: remote.id } } })
  if (!transaction) throw new NotFoundError('Remittance transaction')

  await recordUpdate(transaction.id, 'webhook', remote)
}

/** Re-fetches the anchor's view of a transaction and applies any status change. */
export async function syncTransaction(userId: string, transactionId: string) {
  const transaction = await prisma.remittanceTransaction.findUnique({ where: { id: transactionId }, include: { corridor: true } })
  if (!transaction || transaction.userId !== userId) throw new NotFoundError('Remittance transaction')

  const keypair = deriveAnchorKeypair(userId)
  const token = await ensureAnchorSession(userId, transaction.corridorId, transaction.corridor.anchorDomain, keypair.publicKey())
  const remote = await fetchTransaction(transaction.corridor.anchorDomain, token, transaction.anchorTxId)
  return recordUpdate(transactionId, 'poll', remote)
}

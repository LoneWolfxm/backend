import type { RemittanceEvent, RemittanceTransaction, SponsoredTransaction } from '@prisma/client'

import { prisma } from '../../config/database'
import { NotFoundError } from '../../errors'
import { syncTransaction } from '../anchors/service'

export function serializeRemittance(tx: RemittanceTransaction & { corridor: { code: string } }) {
  return {
    id: tx.id,
    corridorCode: tx.corridor.code,
    kind: tx.kind,
    status: tx.status,
    anchorStatus: tx.anchorStatus,
    account: tx.account,
    anchorTxId: tx.anchorTxId,
    amountIn: tx.amountIn?.toFixed(7) ?? null,
    amountOut: tx.amountOut?.toFixed(7) ?? null,
    amountFee: tx.amountFee?.toFixed(7) ?? null,
    platformFee: tx.platformFee?.toFixed(7) ?? null,
    interactiveUrl: tx.interactiveUrl,
    moreInfoUrl: tx.moreInfoUrl,
    stellarTxHash: tx.stellarTxHash,
    statusMessage: tx.statusMessage,
    completedAt: tx.completedAt?.toISOString() ?? null,
    createdAt: tx.createdAt.toISOString(),
    updatedAt: tx.updatedAt.toISOString(),
  }
}

export function serializeSponsoredTransaction(tx: SponsoredTransaction) {
  return {
    id: tx.id,
    userId: tx.userId,
    contractId: tx.contractId,
    method: tx.method,
    status: tx.status,
    feeCharged: tx.feeCharged?.toString() ?? null,
    stellarTxHash: tx.feeBumpHash,
    errorMessage: tx.error,
    createdAt: tx.createdAt.toISOString(),
    updatedAt: tx.updatedAt.toISOString(),
  }
}

export function serializeRemittanceEvent(event: RemittanceEvent) {
  return {
    id: event.id,
    transactionId: event.transactionId,
    source: event.source,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    anchorStatus: event.anchorStatus,
    payload: event.payload,
    createdAt: event.createdAt.toISOString(),
  }
}

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

function resolveLimit(limit?: number) {
  return Math.min(limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
}

function resolveDateRange(from?: Date, to?: Date) {
  if (!from && !to) return undefined
  return {
    ...(from ? { gte: from } : {}),
    ...(to ? { lte: to } : {}),
  }
}

export async function list(userId: string, options: { limit?: number; cursor?: string } = {}) {
  const limit = Math.min(options.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)

  const transactions = await prisma.remittanceTransaction.findMany({
    where: { userId },
    include: { corridor: { select: { code: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  })

  const hasMore = transactions.length > limit
  const page = hasMore ? transactions.slice(0, limit) : transactions
  return { items: page.map(serializeRemittance), nextCursor: hasMore ? page[page.length - 1].id : null }
}

export async function get(userId: string, id: string) {
  const transaction = await prisma.remittanceTransaction.findUnique({ where: { id }, include: { corridor: { select: { code: true } } } })
  if (!transaction || transaction.userId !== userId) throw new NotFoundError('Remittance transaction')
  return serializeRemittance(transaction)
}

export async function sync(userId: string, id: string) {
  await syncTransaction(userId, id)
  return get(userId, id)
}

export async function listAll(
  options: {
    limit?: number
    cursor?: string
    userId?: string
    status?: RemittanceTransaction['status']
    from?: Date
    to?: Date
  } = {}
) {
  const limit = resolveLimit(options.limit)
  const createdAt = resolveDateRange(options.from, options.to)

  const transactions = await prisma.remittanceTransaction.findMany({
    where: {
      ...(options.userId ? { userId: options.userId } : {}),
      ...(options.status ? { status: options.status } : {}),
      ...(createdAt ? { createdAt } : {}),
    },
    include: { corridor: { select: { code: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  })

  const hasMore = transactions.length > limit
  const page = hasMore ? transactions.slice(0, limit) : transactions
  return { items: page.map(serializeRemittance), nextCursor: hasMore ? page[page.length - 1].id : null }
}

export async function listEvents(transactionId: string) {
  const transaction = await prisma.remittanceTransaction.findUnique({ where: { id: transactionId }, select: { id: true } })
  if (!transaction) throw new NotFoundError('Remittance transaction')

  const events = await prisma.remittanceEvent.findMany({
    where: { transactionId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  return events.map(serializeRemittanceEvent)
}

export async function listSponsoredTransactions(
  options: {
    limit?: number
    cursor?: string
    userId?: string
    status?: SponsoredTransaction['status']
    from?: Date
    to?: Date
  } = {}
) {
  const limit = resolveLimit(options.limit)
  const createdAt = resolveDateRange(options.from, options.to)

  const transactions = await prisma.sponsoredTransaction.findMany({
    where: {
      ...(options.userId ? { userId: options.userId } : {}),
      ...(options.status ? { status: options.status } : {}),
      ...(createdAt ? { createdAt } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  })

  const hasMore = transactions.length > limit
  const page = hasMore ? transactions.slice(0, limit) : transactions
  return { items: page.map(serializeSponsoredTransaction), nextCursor: hasMore ? page[page.length - 1].id : null }
}

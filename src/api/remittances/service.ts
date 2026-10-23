import { RemittanceTransaction } from '@prisma/client'

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

export async function list(userId: string) {
  const transactions = await prisma.remittanceTransaction.findMany({
    where: { userId },
    include: { corridor: { select: { code: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return transactions.map(serializeRemittance)
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

import type { PrismaClient } from '@prisma/client'

const TERMINAL_STATUSES: ('completed' | 'failed')[] = ['completed', 'failed']

export type RunRemittancePollTickOptions = {
  prisma: Pick<PrismaClient, 'remittanceTransaction'>
  syncTransaction: (transactionId: string) => Promise<void>
  staleAfterSeconds: number
  batchSize: number
}

/**
 * Finds non-terminal remittance transactions whose `updatedAt` is older than
 * `staleAfterSeconds` and re-syncs each with its anchor, one small batch at a time.
 * Failures are logged per-transaction and never abort the batch.
 */
export async function runRemittancePollTick(options: RunRemittancePollTickOptions): Promise<void> {
  const { prisma, syncTransaction, staleAfterSeconds, batchSize } = options
  const staleBefore = new Date(Date.now() - staleAfterSeconds * 1000)

  const stale = await prisma.remittanceTransaction.findMany({
    where: { status: { notIn: TERMINAL_STATUSES }, updatedAt: { lt: staleBefore } },
    orderBy: { updatedAt: 'asc' },
    take: batchSize,
    select: { id: true },
  })

  for (const { id } of stale) {
    try {
      await syncTransaction(id)
    } catch (error) {
      console.error(`[remittance-poller] failed to sync transaction ${id}`, error)
    }
  }
}

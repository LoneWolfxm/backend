import { initSentry } from './config/sentry'

initSentry()

import { createApp } from './app'
import { prisma } from './config/database'
import { env } from './config/env'
import { logger } from './config/logger'
import { Sentry, sentryEnabled } from './config/sentry'
import { syncTransaction } from './api/anchors/service'

process.on('uncaughtException', error => {
  logger.fatal({ err: error }, 'Uncaught exception')
  if (sentryEnabled) Sentry.captureException(error)
  process.exit(1)
})
process.on('unhandledRejection', reason => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection')
  if (sentryEnabled) Sentry.captureException(reason)
  process.exit(1)
})

const app = createApp()

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, network: env.STELLAR_NETWORK_PASSPHRASE }, 'RemitPulse backend listening')
})

const TERMINAL_STATUSES = ['completed', 'failed']

let pollerRunning = false

async function pollStaleRemittances(): Promise<void> {
  if (pollerRunning) {
    logger.debug('Remittance poller tick skipped: previous tick still running')
    return
  }
  pollerRunning = true
  try {
    const staleBefore = new Date(Date.now() - env.REMITTANCE_POLL_STALE_AFTER_SECONDS * 1000)
    const stale = await prisma.remittanceTransaction.findMany({
      where: {
        status: { notIn: TERMINAL_STATUSES },
        updatedAt: { lt: staleBefore },
      },
      orderBy: { updatedAt: 'asc' },
      take: env.REMITTANCE_POLL_BATCH_SIZE,
      select: { id: true },
    })

    if (stale.length === 0) {
      logger.debug('Remittance poller tick: no stale transactions')
      return
    }

    logger.info({ count: stale.length }, 'Remittance poller tick: syncing stale transactions')

    for (const tx of stale) {
      try {
        await syncTransaction(tx.id, 'poll')
      } catch (err) {
        logger.error({ err, transactionId: tx.id }, 'Remittance poller: failed to sync transaction')
        if (sentryEnabled) Sentry.captureException(err)
      }
    }
  } catch (err) {
    logger.error({ err }, 'Remittance poller tick failed')
    if (sentryEnabled) Sentry.captureException(err)
  } finally {
    pollerRunning = false
  }
}

const pollerInterval = setInterval(
  () => void pollStaleRemittances(),
  env.REMITTANCE_POLL_INTERVAL_SECONDS * 1000,
)
if (typeof pollerInterval.unref === 'function') pollerInterval.unref()

logger.info(
  {
    intervalSeconds: env.REMITTANCE_POLL_INTERVAL_SECONDS,
    staleAfterSeconds: env.REMITTANCE_POLL_STALE_AFTER_SECONDS,
    batchSize: env.REMITTANCE_POLL_BATCH_SIZE,
  },
  'Remittance poller started',
)

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down')
  clearInterval(pollerInterval)
  server.close()
  await prisma.$disconnect()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
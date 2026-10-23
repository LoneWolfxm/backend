import { initSentry } from './config/sentry'

initSentry()

import { createApp } from './app'
import { prisma } from './config/database'
import { env } from './config/env'
import { logger } from './config/logger'
import { Sentry, sentryEnabled } from './config/sentry'

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

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down')
  server.close()
  await prisma.$disconnect()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

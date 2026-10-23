import { createApp } from './app'
import { prisma } from './config/database'
import { env } from './config/env'
import { logger } from './config/logger'

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

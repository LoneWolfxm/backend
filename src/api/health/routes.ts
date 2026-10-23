import { prisma } from '../../config/database'
import { env } from '../../config/env'
import { z } from '../../lib/zod'
import { ApiRouter } from '../core/router'

export const healthRouter = new ApiRouter('/v1/health')

const start = Date.now()

healthRouter.get({
  path: '',
  summary: 'Liveness and readiness probe',
  description: 'Checks process uptime and database connectivity. Used by Docker/orchestrator health checks.',
  tags: ['Health'],
  auth: 'none',
  response: z.object({
    status: z.enum(['ok', 'degraded']),
    uptimeSeconds: z.number(),
    database: z.enum(['ok', 'error']),
    network: z.string(),
  }),
  handler: async () => {
    let database: 'ok' | 'error' = 'ok'
    try {
      await prisma.$queryRaw`SELECT 1`
    } catch {
      database = 'error'
    }
    const status: 'ok' | 'degraded' = database === 'ok' ? 'ok' : 'degraded'
    return {
      status,
      uptimeSeconds: Math.floor((Date.now() - start) / 1000),
      database,
      network: env.STELLAR_NETWORK_PASSPHRASE,
    }
  },
})

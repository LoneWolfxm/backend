import cors from 'cors'
import type { Express, Request } from 'express'
import express from 'express'
import helmet from 'helmet'
import pinoHttp from 'pino-http'
import swaggerUi from 'swagger-ui-express'

import { anchorsRouter } from './api/anchors/routes'
import { authRouter } from './api/auth/routes'
import { adminCorridorsRouter, corridorsRouter } from './api/corridors/routes'
import { buildOpenApiDocument } from './api/core/openapi'
import { errorHandler, notFoundHandler } from './api/core/middlewares/error-handler'
import { apiRateLimit } from './api/core/middlewares/rate-limit'
import { requestId } from './api/core/middlewares/request-id'
import { fxRouter } from './api/fx/routes'
import { healthRouter } from './api/health/routes'
import { paymasterRouter } from './api/paymaster/routes'
import { remittancesRouter } from './api/remittances/routes'
import { sessionKeysRouter } from './api/session-keys/routes'
import { walletRouter } from './api/wallet/routes'
import { env } from './config/env'
import { logger } from './config/logger'

export function createApp(): Express {
  const app = express()

  app.set('trust proxy', env.TRUST_PROXY)
  app.use(helmet())
  app.use(cors({ origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : false }))
  app.use(requestId)
  app.use(pinoHttp({ logger, genReqId: req => (req as unknown as { requestId: string }).requestId }))
  app.use(
    express.json({
      limit: '256kb',
      verify: (req, _res, buf) => {
        ;(req as Request).rawBody = buf
      },
    })
  )
  app.use(apiRateLimit)

  app.use(healthRouter.prefix, healthRouter.router)
  app.use(authRouter.prefix, authRouter.router)
  app.use(walletRouter.prefix, walletRouter.router)
  app.use(sessionKeysRouter.prefix, sessionKeysRouter.router)
  app.use(paymasterRouter.prefix, paymasterRouter.router)
  app.use(corridorsRouter.prefix, corridorsRouter.router)
  app.use(adminCorridorsRouter.prefix, adminCorridorsRouter.router)
  app.use(anchorsRouter.prefix, anchorsRouter.router)
  app.use(remittancesRouter.prefix, remittancesRouter.router)
  app.use(fxRouter.prefix, fxRouter.router)

  const openapi = buildOpenApiDocument()
  app.get('/openapi.json', (_req, res) => res.json(openapi))
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi))

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}

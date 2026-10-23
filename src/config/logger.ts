import pino from 'pino'

import { env, isProduction } from './env'

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'remitpulse-backend' },
  redact: {
    paths: ['req.headers.authorization', 'req.headers["x-api-key"]', '*.secret', '*.token', '*.encryptedToken', '*.privateKey'],
    censor: '[redacted]',
  },
  transport: isProduction || env.NODE_ENV === 'test' ? undefined : { target: 'pino-pretty', options: { colorize: true } },
})

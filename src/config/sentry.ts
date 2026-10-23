import * as Sentry from '@sentry/node'

import { env, isProduction } from './env'

export const sentryEnabled = Boolean(env.SENTRY_DSN)

/** Call once, as early as possible in the process, before anything else is imported. */
export function initSentry(): void {
  if (!sentryEnabled) return
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: isProduction ? 0.1 : 0,
  })
}

export { Sentry }

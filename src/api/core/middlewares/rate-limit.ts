import { Request } from 'express'
import rateLimit from 'express-rate-limit'

import { TooManyRequestsError } from '../../../errors'

const keyByUserOrIp = (req: Request): string => req.auth?.userId ?? req.ip ?? 'unknown'

const handler = (): never => {
  throw new TooManyRequestsError()
}

/** General API limiter. */
export const apiRateLimit = rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false, handler })

/** Tighter limiter for endpoints that spend money (relay, fee-bump) or hit anchors. */
export const sensitiveRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  handler,
})

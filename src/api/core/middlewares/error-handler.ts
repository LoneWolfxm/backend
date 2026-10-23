import { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'

import { logger } from '../../../config/logger'
import { AppError } from '../../../errors'

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` } })
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const context = { requestId: req.requestId, method: req.method, url: req.originalUrl }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: err.flatten() },
    })
    return
  }

  if (err instanceof AppError) {
    const log = err.statusCode >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger)
    log({ ...context, code: err.code, details: err.details }, err.message)
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message, details: err.details } })
    return
  }

  // body-parser errors (malformed JSON, payload too large)
  if (typeof err === 'object' && err && 'status' in err && 'type' in err) {
    const status = Number((err as { status: number }).status)
    if (status >= 400 && status < 500) {
      res.status(status).json({ error: { code: 'BAD_REQUEST', message: String((err as { message?: unknown }).message ?? 'Bad request') } })
      return
    }
  }

  logger.error({ ...context, err }, 'Unhandled error')
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error has occurred' } })
}

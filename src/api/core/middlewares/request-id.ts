import { randomUUID } from 'node:crypto'

import type { NextFunction, Request, Response } from 'express'

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id')
  const id = incoming && /^[\w-]{1,128}$/.test(incoming) ? incoming : randomUUID()
  req.requestId = id
  res.setHeader('x-request-id', id)
  next()
}

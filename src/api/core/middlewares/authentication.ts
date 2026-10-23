import { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'

import { env } from '../../../config/env'
import { ForbiddenError, UnauthorizedError } from '../../../errors'
import { safeEqual } from '../../../lib/crypto'

export type AuthContext = { userId: string; email: string }

type TokenClaims = { sub: string; email: string }

export function signUserToken(user: AuthContext): string {
  return jwt.sign({ email: user.email }, env.JWT_SECRET, {
    subject: user.userId,
    expiresIn: env.JWT_EXPIRATION as jwt.SignOptions['expiresIn'],
    issuer: 'remitpulse',
    audience: 'remitpulse-app',
    algorithm: 'HS256',
  })
}

export function verifyUserToken(token: string): AuthContext {
  try {
    const claims = jwt.verify(token, env.JWT_SECRET, {
      issuer: 'remitpulse',
      audience: 'remitpulse-app',
      algorithms: ['HS256'],
    }) as TokenClaims
    return { userId: claims.sub, email: claims.email }
  } catch {
    throw new UnauthorizedError('Invalid or expired token')
  }
}

export function requireUser(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization')
  if (!header?.startsWith('Bearer ')) throw new UnauthorizedError('Missing bearer token')
  req.auth = verifyUserToken(header.slice('Bearer '.length).trim())
  next()
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const key = req.header('x-api-key')
  if (!key || !env.ADMIN_API_KEYS.some(valid => safeEqual(valid, key))) {
    throw new ForbiddenError('Invalid API key')
  }
  next()
}

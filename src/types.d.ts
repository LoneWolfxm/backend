import type { AuthContext } from './api/core/middlewares/authentication'

declare global {
  namespace Express {
    interface Request {
      requestId: string
      auth?: AuthContext
      rawBody?: Buffer
    }
  }
}

export {}

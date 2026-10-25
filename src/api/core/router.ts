import type { RouteConfig } from '@asteasolutions/zod-to-openapi'
import type { Request, RequestHandler, Response } from 'express'
import { Router } from 'express'
import type { ZodObject, ZodTypeAny } from 'zod'

import { UnauthorizedError } from '../../errors'
import { z } from '../../lib/zod'
import type { AuthContext } from './middlewares/authentication'
import { requireAdmin, requireUser } from './middlewares/authentication'
import { sensitiveRateLimit } from './middlewares/rate-limit'
import { ErrorResponseSchema, registry } from './openapi'

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete'
type Auth = 'none' | 'user' | 'admin'

type Infer<T> = T extends ZodTypeAny ? z.infer<T> : undefined

export type RouteContext<B, Q, P, A extends Auth> = {
  body: Infer<B>
  query: Infer<Q>
  params: Infer<P>
  auth: A extends 'user' ? AuthContext : undefined
  req: Request
  res: Response
}

export type RouteDefinition<
  B extends ZodTypeAny | undefined,
  Q extends ZodObject | undefined,
  P extends ZodObject | undefined,
  R extends ZodTypeAny,
  A extends Auth,
> = {
  path: string
  summary: string
  description?: string
  tags: string[]
  auth: A
  body?: B
  query?: Q
  params?: P
  response: R
  /** Success status code, default 200. */
  status?: number
  /** Apply the stricter per-user limiter (endpoints that spend relayer/paymaster funds or hit anchors). */
  sensitive?: boolean
  /** Extra middlewares, run after auth. */
  middlewares?: RequestHandler[]
  /** Extra documented error responses, e.g. { 409: 'Already enrolled' } */
  errors?: Record<number, string>
  handler: (ctx: RouteContext<B, Q, P, A>) => Promise<z.infer<R>>
}

const DEFAULT_ERRORS: Record<number, string> = {
  400: 'Validation error',
  500: 'Unexpected error',
}

/**
 * Express router that validates each request with zod and registers the same
 * schemas in the OpenAPI registry, so docs can never drift from runtime checks.
 *
 * Successful responses are wrapped as `{ data: <response> }`.
 */
export class ApiRouter {
  public readonly router = Router()

  constructor(public readonly prefix: string) {}

  get = this.method('get')
  post = this.method('post')
  patch = this.method('patch')
  put = this.method('put')
  delete = this.method('delete')

  private method(method: Method) {
    return <
      R extends ZodTypeAny,
      A extends Auth,
      B extends ZodTypeAny | undefined = undefined,
      Q extends ZodObject | undefined = undefined,
      P extends ZodObject | undefined = undefined,
    >(
      def: RouteDefinition<B, Q, P, R, A>
    ): void => {
      this.document(method, def)

      const chain: RequestHandler[] = []
      if (def.auth === 'user') chain.push(requireUser)
      if (def.auth === 'admin') chain.push(requireAdmin)
      if (def.sensitive) chain.push(sensitiveRateLimit)
      chain.push(...(def.middlewares ?? []))

      this.router[method](def.path, ...chain, async (req: Request, res: Response) => {
        if (def.auth === 'user' && !req.auth) throw new UnauthorizedError()
        const ctx = {
          body: def.body ? def.body.parse(req.body ?? {}) : undefined,
          query: def.query ? def.query.parse(req.query) : undefined,
          params: def.params ? def.params.parse(req.params) : undefined,
          auth: req.auth,
          req,
          res,
        } as RouteContext<B, Q, P, A>
        const data = await def.handler(ctx)
        res.status(def.status ?? 200).json({ data })
      })
    }
  }

  private document(
    method: Method,
    def: RouteDefinition<ZodTypeAny | undefined, ZodObject | undefined, ZodObject | undefined, ZodTypeAny, Auth>
  ): void {
    const fullPath = `${this.prefix}${def.path}`.replace(/:(\w+)/g, '{$1}')
    const errors = { ...DEFAULT_ERRORS, ...def.errors }
    if (def.auth === 'user') errors[401] ??= 'Missing or invalid bearer token'
    if (def.auth === 'admin') errors[403] ??= 'Invalid API key'
    if (def.sensitive) errors[429] ??= 'Rate limit exceeded'

    const responses: RouteConfig['responses'] = {
      [def.status ?? 200]: {
        description: 'Success',
        content: { 'application/json': { schema: z.object({ data: def.response }) } },
      },
    }
    for (const [status, description] of Object.entries(errors)) {
      responses[status] = { description, content: { 'application/json': { schema: ErrorResponseSchema } } }
    }

    registry.registerPath({
      method,
      path: fullPath,
      summary: def.summary,
      description: def.description,
      tags: def.tags,
      security: def.auth === 'user' ? [{ BearerAuth: [] }] : def.auth === 'admin' ? [{ ApiKey: [] }] : undefined,
      request: {
        params: def.params,
        query: def.query,
        body: def.body ? { content: { 'application/json': { schema: def.body } }, required: true } : undefined,
      },
      responses,
    })
  }
}

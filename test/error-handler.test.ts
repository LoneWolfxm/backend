import { Prisma } from '@prisma/client'
import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { errorHandler, notFoundHandler } from '../src/api/core/middlewares/error-handler'

function appThatThrows(err: unknown) {
  const app = express()
  app.get('/boom', () => {
    throw err
  })
  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}

function prismaError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError('mock prisma error', { code, clientVersion: '6.19.3', meta })
}

describe('errorHandler Prisma mapping', () => {
  it('maps P2025 (record not found) to 404', async () => {
    const response = await request(appThatThrows(prismaError('P2025'))).get('/boom')
    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('NOT_FOUND')
  })

  it('maps P2002 (unique constraint) to 409 with the violated field', async () => {
    const response = await request(appThatThrows(prismaError('P2002', { target: ['code'] }))).get('/boom')
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('CONFLICT')
    expect(response.body.error.details.target).toEqual(['code'])
  })

  it('maps P2003 (foreign key violation) to 400', async () => {
    const response = await request(appThatThrows(prismaError('P2003', { field_name: 'corridorId' }))).get('/boom')
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('BAD_REQUEST')
  })

  it('falls back to 500 for an unmapped Prisma error code', async () => {
    const response = await request(appThatThrows(prismaError('P9999'))).get('/boom')
    expect(response.status).toBe(500)
    expect(response.body.error.code).toBe('INTERNAL_ERROR')
  })

  it('still returns a structured 404 for unknown routes', async () => {
    const response = await request(appThatThrows(new Error('unused'))).get('/does-not-exist')
    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('NOT_FOUND')
  })
})

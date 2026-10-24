import { Prisma } from '@prisma/client'
import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

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

describe('errorHandler ZodError mapping', () => {
  const schema = z.object({
    name: z.string(),
    age: z.number().int().positive(),
  })

  it('maps a thrown ZodError to 400 VALIDATION_ERROR with issue details', async () => {
    const result = schema.safeParse({ name: 123, age: -1 })
    expect(result.success).toBe(false)
    if (result.success) return

    const response = await request(appThatThrows(result.error)).get('/boom')
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')

    const details = response.body.error.details
    expect(Array.isArray(details)).toBe(true)
    expect(details.length).toBeGreaterThan(0)
    for (const issue of details) {
      expect(typeof issue.path).toBe('string')
      expect(typeof issue.message).toBe('string')
    }
    const paths = details.map((issue: { path: string }) => issue.path)
    expect(paths).toContain('name')
    expect(paths).toContain('age')
  })

  it('includes the issue code in the details for each issue', async () => {
    const result = schema.safeParse({ name: 'ok', age: -1 })
    expect(result.success).toBe(false)
    if (result.success) return

    const response = await request(appThatThrows(result.error)).get('/boom')
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')

    const details = response.body.error.details
    expect(details).toHaveLength(1)
    expect(details[0].path).toBe('age')
    expect(typeof details[0].code).toBe('string')
  })
})

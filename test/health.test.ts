import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { createApp } from '../src/app'

const app = createApp()

describe('GET /v1/health', () => {
  it('reports process uptime and database status', async () => {
    const response = await request(app).get('/v1/health')
    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({ status: expect.stringMatching(/ok|degraded/) })
    expect(typeof response.body.data.uptimeSeconds).toBe('number')
    expect(['ok', 'error']).toContain(response.body.data.database)
  })
})

describe('unknown routes', () => {
  it('returns a structured 404', async () => {
    const response = await request(app).get('/v1/does-not-exist')
    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('NOT_FOUND')
  })
})

import { randomUUID } from 'node:crypto'

import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createApp } from '../src/app'
import { prisma } from '../src/config/database'

const app = createApp()
const code = `TST${randomUUID().slice(0, 4).toUpperCase()}`

beforeAll(async () => {
  await prisma.corridor.create({
    data: {
      code,
      name: 'Test Corridor',
      assetCode: code,
      assetIssuer: 'GCUZ37M45SEMGYFYYZE7IBTS3ISKGPDLFRNHS73ORSTMNYM64NLEQO76',
      fiatCurrency: 'USD',
      anchorDomain: 'testanchor.stellar.org',
    },
  })
})

afterAll(async () => {
  await prisma.corridor.deleteMany({ where: { code } })
  await prisma.$disconnect()
})

describe('GET /v1/corridors', () => {
  it('lists active corridors, including the seeded test corridor', async () => {
    const response = await request(app).get('/v1/corridors')
    expect(response.status).toBe(200)
    expect(response.body.data.some((corridor: { code: string }) => corridor.code === code)).toBe(true)
  })

  it('404s for an unknown corridor code', async () => {
    const response = await request(app).get('/v1/corridors/DOESNOTEXIST')
    expect(response.status).toBe(404)
  })
})

describe('POST /v1/admin/corridors', () => {
  const newCode = `NEW${randomUUID().slice(0, 4).toUpperCase()}`
  const body = {
    code: newCode,
    name: 'New Corridor',
    assetCode: newCode,
    assetIssuer: 'GCUZ37M45SEMGYFYYZE7IBTS3ISKGPDLFRNHS73ORSTMNYM64NLEQO76',
    fiatCurrency: 'USD',
    anchorDomain: 'testanchor.stellar.org',
  }

  afterAll(async () => {
    await prisma.corridor.deleteMany({ where: { code: newCode } })
  })

  it('rejects requests without a valid admin API key', async () => {
    const response = await request(app).post('/v1/admin/corridors').send(body)
    expect(response.status).toBe(403)
  })

  it('creates a corridor for a valid admin key', async () => {
    const response = await request(app).post('/v1/admin/corridors').set('x-api-key', 'test-admin-key').send(body)
    expect(response.status).toBe(201)
    expect(response.body.data.code).toBe(newCode)
    expect(response.body.data.isActive).toBe(true)
  })

  it('409s when the corridor code already exists', async () => {
    const response = await request(app).post('/v1/admin/corridors').set('x-api-key', 'test-admin-key').send(body)
    expect(response.status).toBe(409)
  })
})

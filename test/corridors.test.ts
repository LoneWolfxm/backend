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

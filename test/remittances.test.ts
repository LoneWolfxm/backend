import { randomUUID } from 'node:crypto'

import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { signUserToken } from '../src/api/core/middlewares/authentication'
import { createApp } from '../src/app'
import { prisma } from '../src/config/database'

const app = createApp()
const userId = randomUUID()
const corridorCode = `PAG${randomUUID().slice(0, 4).toUpperCase()}`
const token = signUserToken({ userId, email: 'pagination-test@example.com' })

beforeAll(async () => {
  await prisma.user.create({ data: { id: userId, email: 'pagination-test@example.com' } })
  const corridor = await prisma.corridor.create({
    data: {
      code: corridorCode,
      name: 'Pagination Test Corridor',
      assetCode: corridorCode,
      assetIssuer: 'GCUZ37M45SEMGYFYYZE7IBTS3ISKGPDLFRNHS73ORSTMNYM64NLEQO76',
      fiatCurrency: 'USD',
      anchorDomain: 'testanchor.stellar.org',
    },
  })

  // Five transactions, oldest to newest, so the API's newest-first order is deterministic.
  for (let i = 0; i < 5; i++) {
    await prisma.remittanceTransaction.create({
      data: {
        userId,
        corridorId: corridor.id,
        kind: 'deposit',
        account: 'GCUZ37M45SEMGYFYYZE7IBTS3ISKGPDLFRNHS73ORSTMNYM64NLEQO76',
        anchorTxId: `tx-${i}`,
        status: 'incomplete',
        anchorStatus: 'incomplete',
        createdAt: new Date(Date.now() - (5 - i) * 1000),
      },
    })
  }
})

afterAll(async () => {
  await prisma.remittanceTransaction.deleteMany({ where: { userId } })
  await prisma.corridor.deleteMany({ where: { code: corridorCode } })
  await prisma.user.delete({ where: { id: userId } })
})

describe('GET /v1/remittances pagination', () => {
  it('returns the first page newest-first, capped at the requested limit', async () => {
    const response = await request(app).get('/v1/remittances').query({ limit: 2 }).set('authorization', `Bearer ${token}`)
    expect(response.status).toBe(200)
    expect(response.body.data.items).toHaveLength(2)
    expect(response.body.data.items[0].anchorTxId).toBe('tx-4')
    expect(response.body.data.items[1].anchorTxId).toBe('tx-3')
    expect(response.body.data.nextCursor).not.toBeNull()
  })

  it('follows nextCursor to fetch the next page without repeating items', async () => {
    const first = await request(app).get('/v1/remittances').query({ limit: 2 }).set('authorization', `Bearer ${token}`)
    const second = await request(app)
      .get('/v1/remittances')
      .query({ limit: 2, cursor: first.body.data.nextCursor })
      .set('authorization', `Bearer ${token}`)

    expect(second.status).toBe(200)
    expect(second.body.data.items.map((item: { anchorTxId: string }) => item.anchorTxId)).toEqual(['tx-2', 'tx-1'])
  })

  it('returns nextCursor: null on the last page', async () => {
    const response = await request(app).get('/v1/remittances').query({ limit: 100 }).set('authorization', `Bearer ${token}`)
    expect(response.body.data.items).toHaveLength(5)
    expect(response.body.data.nextCursor).toBeNull()
  })

  it('requires authentication', async () => {
    const response = await request(app).get('/v1/remittances')
    expect(response.status).toBe(401)
  })
})

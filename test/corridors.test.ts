import { randomUUID } from 'node:crypto'

import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createApp } from '../src/app'
import { prisma } from '../src/config/database'
import { corridorTokenContract } from '../src/api/corridors/service'

const app = createApp()
const code = `TST${randomUUID().slice(0, 4).toUpperCase()}`
const adminKey = 'test-admin-key'

const SEEDED_CORRIDOR_CODES = ['USDC', 'EURC', 'ARST', 'BRLA']
const STELLAR_PUBLIC_KEY = /^G[A-Z2-7]{55}$/

let corridorId: string

beforeAll(async () => {
  const corridor = await prisma.corridor.create({
    data: {
      code,
      name: 'Test Corridor',
      assetCode: code,
      assetIssuer: 'GCUZ37M45SEMGYFYYZE7IBTS3ISKGPDLFRNHS73ORSTMNYM64NLEQO76',
      fiatCurrency: 'USD',
      anchorDomain: 'testanchor.stellar.org',
    },
  })
  corridorId = corridor.id
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

describe('seeded corridors', () => {
  it('have real (non-placeholder) asset issuers', async () => {
    const corridors = await prisma.corridor.findMany({ where: { code: { in: SEEDED_CORRIDOR_CODES } } })
    expect(corridors.map(corridor => corridor.code).sort()).toEqual([...SEEDED_CORRIDOR_CODES].sort())

    for (const corridor of corridors) {
      expect(corridor.assetIssuer, `${corridor.code} assetIssuer`).toMatch(STELLAR_PUBLIC_KEY)
      expect(corridor.anchorDomain, `${corridor.code} anchorDomain`).toBeTruthy()
    }
  })

  it('expose a derived asset contractId via GET /v1/corridors', async () => {
    const response = await request(app).get('/v1/corridors')
    expect(response.status).toBe(200)

    for (const corridorCode of SEEDED_CORRIDOR_CODES) {
      const corridor = response.body.data.find((item: { code: string }) => item.code === corridorCode)
      expect(corridor, `${corridorCode} corridor`).toBeDefined()
      expect(corridor.asset.contractId, `${corridorCode} contractId`).toBeTruthy()
      expect(corridor.asset.contractId).toBe(corridorTokenContract({ assetCode: corridor.asset.code, assetIssuer: corridor.asset.issuer }))
    }
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

describe('GET /v1/admin/sponsored-transactions', () => {
  const userId = randomUUID()
  const contractId = `C${randomUUID().replace(/-/g, '').slice(0, 55).toUpperCase()}`
  const createdIds: string[] = []

  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, email: `${userId}@example.com` } })

    const first = await prisma.sponsoredTransaction.create({
      data: {
        userId,
        contractId,
        method: 'transfer',
        status: 'succeeded',
        innerHash: randomUUID().replace(/-/g, ''),
        feeBumpHash: randomUUID().replace(/-/g, ''),
        maxFee: 1_000_000n,
        feeCharged: 100n,
      },
    })
    const second = await prisma.sponsoredTransaction.create({
      data: {
        userId,
        contractId,
        method: 'transfer',
        status: 'failed',
        innerHash: randomUUID().replace(/-/g, ''),
        feeBumpHash: randomUUID().replace(/-/g, ''),
        maxFee: 1_000_000n,
        feeCharged: 0n,
      },
    })
    createdIds.push(first.id, second.id)
  })

  afterAll(async () => {
    await prisma.sponsoredTransaction.deleteMany({ where: { id: { in: createdIds } } })
    await prisma.user.delete({ where: { id: userId } })
  })

  it('rejects requests without a valid admin API key', async () => {
    const response = await request(app).get('/v1/admin/sponsored-transactions')
    expect(response.status).toBe(403)
  })

  it('lists sponsored transactions across all users', async () => {
    const response = await request(app).get('/v1/admin/sponsored-transactions').set('x-api-key', adminKey)
    expect(response.status).toBe(200)
    expect(Array.isArray(response.body.data.items)).toBe(true)
    const ids = response.body.data.items.map((row: { id: string }) => row.id)
    expect(ids).toEqual(expect.arrayContaining(createdIds))
  })

  it('filters by userId and status', async () => {
    const response = await request(app)
      .get('/v1/admin/sponsored-transactions')
      .query({ userId, status: 'succeeded' })
      .set('x-api-key', adminKey)
    expect(response.status).toBe(200)
    expect(response.body.data.items.length).toBe(1)
    expect(response.body.data.items[0].id).toBe(createdIds[0])
    expect(response.body.data.items[0].status).toBe('succeeded')
  })

  it('paginates with a keyset cursor', async () => {
    const firstPage = await request(app).get('/v1/admin/sponsored-transactions').query({ userId, limit: 1 }).set('x-api-key', adminKey)
    expect(firstPage.status).toBe(200)
    expect(firstPage.body.data.items.length).toBe(1)
    expect(firstPage.body.data.nextCursor).toBeTruthy()

    const secondPage = await request(app)
      .get('/v1/admin/sponsored-transactions')
      .query({ userId, limit: 1, cursor: firstPage.body.data.nextCursor })
      .set('x-api-key', adminKey)
    expect(secondPage.status).toBe(200)
    expect(secondPage.body.data.items.length).toBe(1)
    expect(secondPage.body.data.items[0].id).not.toBe(firstPage.body.data.items[0].id)
  })
})

describe('GET /v1/admin/remittances', () => {
  const userId = randomUUID()
  const createdIds: string[] = []

  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, email: `${userId}@example.com` } })

    const first = await prisma.remittanceTransaction.create({
      data: {
        userId,
        corridorId,
        kind: 'deposit',
        account: 'GCUZ37M45SEMGYFYYZE7IBTS3ISKGPDLFRNHS73ORSTMNYM64NLEQO76',
        anchorTxId: randomUUID(),
        status: 'pending_anchor',
        anchorStatus: 'pending_anchor',
        amountIn: '100',
      },
    })
    const second = await prisma.remittanceTransaction.create({
      data: {
        userId,
        corridorId,
        kind: 'deposit',
        account: 'GCUZ37M45SEMGYFYYZE7IBTS3ISKGPDLFRNHS73ORSTMNYM64NLEQO76',
        anchorTxId: randomUUID(),
        status: 'completed',
        anchorStatus: 'completed',
        amountIn: '250',
      },
    })
    createdIds.push(first.id, second.id)
  })

  afterAll(async () => {
    await prisma.remittanceTransaction.deleteMany({ where: { id: { in: createdIds } } })
    await prisma.user.delete({ where: { id: userId } })
  })

  it('rejects requests without a valid admin API key', async () => {
    const response = await request(app).get('/v1/admin/remittances')
    expect(response.status).toBe(403)
  })

  it('lists remittances across all users', async () => {
    const response = await request(app).get('/v1/admin/remittances').set('x-api-key', adminKey)
    expect(response.status).toBe(200)
    expect(Array.isArray(response.body.data.items)).toBe(true)
    const ids = response.body.data.items.map((row: { id: string }) => row.id)
    expect(ids).toEqual(expect.arrayContaining(createdIds))
  })

  it('filters by userId and status', async () => {
    const response = await request(app).get('/v1/admin/remittances').query({ userId, status: 'completed' }).set('x-api-key', adminKey)
    expect(response.status).toBe(200)
    expect(response.body.data.items.length).toBe(1)
    expect(response.body.data.items[0].id).toBe(createdIds[1])
  })

  it('paginates with a keyset cursor', async () => {
    const firstPage = await request(app).get('/v1/admin/remittances').query({ userId, limit: 1 }).set('x-api-key', adminKey)
    expect(firstPage.status).toBe(200)
    expect(firstPage.body.data.items.length).toBe(1)
    expect(firstPage.body.data.nextCursor).toBeTruthy()

    const secondPage = await request(app)
      .get('/v1/admin/remittances')
      .query({ userId, limit: 1, cursor: firstPage.body.data.nextCursor })
      .set('x-api-key', adminKey)
    expect(secondPage.status).toBe(200)
    expect(secondPage.body.data.items.length).toBe(1)
    expect(secondPage.body.data.items[0].id).not.toBe(firstPage.body.data.items[0].id)
  })
})

describe('GET /v1/admin/remittances/:id/events', () => {
  const userId = randomUUID()
  let remittanceId: string

  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, email: `${userId}@example.com` } })

    const remittance = await prisma.remittanceTransaction.create({
      data: {
        userId,
        corridorId,
        kind: 'deposit',
        account: 'GCUZ37M45SEMGYFYYZE7IBTS3ISKGPDLFRNHS73ORSTMNYM64NLEQO76',
        anchorTxId: randomUUID(),
        status: 'pending_anchor',
        anchorStatus: 'pending_anchor',
      },
    })
    remittanceId = remittance.id
    await prisma.remittanceEvent.createMany({
      data: [
        {
          transactionId: remittanceId,
          source: 'initiation',
          toStatus: 'incomplete',
          anchorStatus: 'incomplete',
          payload: {},
          createdAt: new Date(Date.now() - 1000),
        },
        {
          transactionId: remittanceId,
          source: 'poll',
          fromStatus: 'incomplete',
          toStatus: 'pending_anchor',
          anchorStatus: 'pending_anchor',
          payload: { from: 'incomplete', to: 'pending_anchor' },
          createdAt: new Date(),
        },
      ],
    })
  })

  afterAll(async () => {
    await prisma.remittanceEvent.deleteMany({ where: { transactionId: remittanceId } })
    await prisma.remittanceTransaction.deleteMany({ where: { id: remittanceId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  it('rejects requests without a valid admin API key', async () => {
    const response = await request(app).get(`/v1/admin/remittances/${remittanceId}/events`)
    expect(response.status).toBe(403)
  })

  it('returns the full event history for a remittance', async () => {
    const response = await request(app).get(`/v1/admin/remittances/${remittanceId}/events`).set('x-api-key', adminKey)
    expect(response.status).toBe(200)
    expect(response.body.data.items.length).toBe(2)
    expect(response.body.data.items.map((event: { source: string }) => event.source)).toEqual(['initiation', 'poll'])
  })

  it('404s for an unknown remittance id', async () => {
    const response = await request(app).get(`/v1/admin/remittances/${randomUUID()}/events`).set('x-api-key', adminKey)
    expect(response.status).toBe(404)
  })
})

import { randomUUID } from 'node:crypto'

import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { signUserToken } from '../src/api/core/middlewares/authentication'
import { createApp } from '../src/app'
import { prisma } from '../src/config/database'

const webauthnMocks = vi.hoisted(() => ({
  registrationOptions: vi.fn(),
  verifyRegistration: vi.fn(),
}))

vi.mock('../src/interfaces/webauthn', () => ({
  WebAuthnService: {
    registrationOptions: webauthnMocks.registrationOptions,
    verifyRegistration: webauthnMocks.verifyRegistration,
  },
}))

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
  await prisma.passkey.deleteMany({ where: { userId } })
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

describe('multi-passkey support', () => {
  const passkeyUserId = randomUUID()
  const passkeyEmail = 'multi-passkey-test@example.com'
  const passkeyToken = signUserToken({ userId: passkeyUserId, email: passkeyEmail })

  const firstCredentialId = `cred-${randomUUID()}`
  const secondCredentialId = `cred-${randomUUID()}`

  beforeAll(async () => {
    await prisma.user.create({ data: { id: passkeyUserId, email: passkeyEmail } })
    await prisma.passkey.create({
      data: {
        userId: passkeyUserId,
        credentialId: firstCredentialId,
        publicKey: Buffer.from('first-public-key').toString('base64url'),
        counter: 0,
        transports: ['internal'],
      },
    })
  })

  afterAll(async () => {
    await prisma.passkey.deleteMany({ where: { userId: passkeyUserId } })
    await prisma.user.delete({ where: { id: passkeyUserId } })
  })

  it('requires authentication to add a passkey', async () => {
    const optionsResponse = await request(app).post('/v1/auth/passkey/add/options').send({})
    expect(optionsResponse.status).toBe(401)

    const verifyResponse = await request(app).post('/v1/auth/passkey/add/verify').send({})
    expect(verifyResponse.status).toBe(401)
  })

  it('requires authentication to remove a passkey', async () => {
    const response = await request(app).delete(`/v1/auth/passkeys/${firstCredentialId}`)
    expect(response.status).toBe(401)
  })

  it('adds a second passkey while retaining the first', async () => {
    webauthnMocks.registrationOptions.mockResolvedValueOnce({
      challenge: 'add-passkey-challenge',
      rp: { id: 'localhost', name: 'Test' },
      user: { id: passkeyUserId, name: passkeyEmail, displayName: passkeyEmail },
      pubKeyCredParams: [],
      excludeCredentials: [{ id: firstCredentialId, type: 'public-key' }],
    })
    webauthnMocks.verifyRegistration.mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        credential: {
          id: secondCredentialId,
          publicKey: Buffer.from('second-public-key'),
          counter: 0,
        },
      },
    })

    const optionsResponse = await request(app)
      .post('/v1/auth/passkey/add/options')
      .set('authorization', `Bearer ${passkeyToken}`)
      .send({})
    expect(optionsResponse.status).toBe(200)
    expect(webauthnMocks.registrationOptions).toHaveBeenCalled()

    const verifyResponse = await request(app)
      .post('/v1/auth/passkey/add/verify')
      .set('authorization', `Bearer ${passkeyToken}`)
      .send({ response: { id: secondCredentialId } })
    expect(verifyResponse.status).toBe(200)

    const meResponse = await request(app).get('/v1/auth/me').set('authorization', `Bearer ${passkeyToken}`)
    expect(meResponse.status).toBe(200)
    const credentialIds = (meResponse.body.data.passkeys as Array<{ credentialId: string }>).map((p) => p.credentialId)
    expect(credentialIds).toContain(firstCredentialId)
    expect(credentialIds).toContain(secondCredentialId)
    expect(credentialIds).toHaveLength(2)
  })

  it('removes a passkey when more than one exists', async () => {
    const response = await request(app)
      .delete(`/v1/auth/passkeys/${secondCredentialId}`)
      .set('authorization', `Bearer ${passkeyToken}`)
    expect(response.status).toBe(200)

    const meResponse = await request(app).get('/v1/auth/me').set('authorization', `Bearer ${passkeyToken}`)
    const credentialIds = (meResponse.body.data.passkeys as Array<{ credentialId: string }>).map((p) => p.credentialId)
    expect(credentialIds).toEqual([firstCredentialId])
  })

  it('rejects removing the only remaining passkey', async () => {
    const response = await request(app)
      .delete(`/v1/auth/passkeys/${firstCredentialId}`)
      .set('authorization', `Bearer ${passkeyToken}`)
    expect(response.status).toBe(409)

    const remaining = await prisma.passkey.count({ where: { userId: passkeyUserId } })
    expect(remaining).toBe(1)
  })
})

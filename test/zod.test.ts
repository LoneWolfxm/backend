import { describe, expect, it } from 'vitest'

import { zAccountId, zAddress, zAmount, zContractId } from '../src/lib/zod'

const G_ADDRESS = 'GCUZ37M45SEMGYFYYZE7IBTS3ISKGPDLFRNHS73ORSTMNYM64NLEQO76'
const C_ADDRESS = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'

describe('zAccountId', () => {
  it('accepts a valid G... account', () => {
    expect(zAccountId.safeParse(G_ADDRESS).success).toBe(true)
  })

  it('rejects a contract address', () => {
    expect(zAccountId.safeParse(C_ADDRESS).success).toBe(false)
  })

  it('rejects garbage', () => {
    expect(zAccountId.safeParse('not-an-address').success).toBe(false)
  })

  it('reports a zod v4 issue with a string message', () => {
    const result = zAccountId.safeParse('not-an-address')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0)
      expect(typeof result.error.issues[0].message).toBe('string')
      expect(result.error.issues[0].code).toBeDefined()
    }
  })
})

describe('zContractId', () => {
  it('accepts a valid C... contract', () => {
    expect(zContractId.safeParse(C_ADDRESS).success).toBe(true)
  })

  it('rejects a classic account', () => {
    expect(zContractId.safeParse(G_ADDRESS).success).toBe(false)
  })
})

describe('zAddress', () => {
  it('accepts either a G... or C... address', () => {
    expect(zAddress.safeParse(G_ADDRESS).success).toBe(true)
    expect(zAddress.safeParse(C_ADDRESS).success).toBe(true)
  })

  it('rejects anything else', () => {
    expect(zAddress.safeParse('xyz').success).toBe(false)
  })

  it('exposes issues via the v4 error API', () => {
    const result = zAddress.safeParse('xyz')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(Array.isArray(result.error.issues)).toBe(true)
      expect(result.error.issues.length).toBeGreaterThan(0)
    }
  })
})

describe('zAmount', () => {
  it.each(['0', '1', '100.00', '0.0000001', '123456789.1234567'])('accepts %s', value => {
    expect(zAmount.safeParse(value).success).toBe(true)
  })

  it.each(['-1', '1.12345678', 'abc', ''])('rejects %s', value => {
    expect(zAmount.safeParse(value).success).toBe(false)
  })

  it('reports a string message for invalid amounts', () => {
    const result = zAmount.safeParse('abc')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(typeof result.error.issues[0].message).toBe('string')
    }
  })
})

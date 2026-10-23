import { describe, expect, it } from 'vitest'

import { encrypt, decrypt, safeEqual } from '../src/lib/crypto'

describe('encrypt / decrypt', () => {
  it('round-trips a secret', () => {
    const ciphertext = encrypt('super-secret-anchor-jwt')
    expect(ciphertext).not.toContain('super-secret')
    expect(decrypt(ciphertext)).toBe('super-secret-anchor-jwt')
  })

  it('produces a different ciphertext each time (random IV)', () => {
    expect(encrypt('same-input')).not.toBe(encrypt('same-input'))
  })
})

describe('safeEqual', () => {
  it('matches equal strings and rejects different lengths or content', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abcd')).toBe(false)
    expect(safeEqual('abc', 'xyz')).toBe(false)
  })
})

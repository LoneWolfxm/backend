import { describe, expect, it, vi } from 'vitest'

import { retry } from '../src/lib/retry'

describe('retry', () => {
  it('returns the result on the first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    await expect(retry(fn)).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on failure and eventually succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce('ok')
    await expect(retry(fn, { attempts: 3, delayMs: 1 })).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('throws the last error once attempts are exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('permanent'))
    await expect(retry(fn, { attempts: 2, delayMs: 1 })).rejects.toThrow('permanent')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

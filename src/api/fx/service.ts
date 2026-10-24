import { env } from '../../config/env'
import { UpstreamError } from '../../errors'
import { requestJson } from '../../lib/http-client'
import { Big } from '../../lib/money'
import { getCorridor } from '../corridors/service'

let httpCache: { at: number; base: string; rates: Record<string, number> } | undefined

/** Units of each fiat currency per 1 unit of `base`, e.g. { USD: 1, EUR: 0.92, ARS: 1050 }. */
export async function getReferenceRates(base = 'USD'): Promise<Record<string, number>> {
  if (env.FX_PROVIDER === 'http') {
    if (httpCache && httpCache.base === base && Date.now() - httpCache.at < env.FX_CACHE_TTL_SECONDS * 1000) {
      return httpCache.rates
    }
    if (!env.FX_REFERENCE_URL) throw new UpstreamError('fx', 'FX_PROVIDER=http but FX_REFERENCE_URL is not configured')
    const payload = await requestJson<{ rates: Record<string, number> }>('fx', env.FX_REFERENCE_URL, {
      query: { base },
      timeoutMs: env.ANCHOR_REQUEST_TIMEOUT_MS,
    })
    httpCache = { at: Date.now(), base, rates: payload.rates }
    return payload.rates
  }

  // 'static' (also the fallback reference for 'sep38', which quotes per-corridor rather than per-base-currency)
  const rates = env.FX_STATIC_RATES
  const baseRate = rates[base.toUpperCase()]
  if (!baseRate) throw new UpstreamError('fx', `No static rate configured for base currency ${base}`)
  return Object.fromEntries(Object.entries(rates).map(([currency, unitsPerUsd]) => [currency, unitsPerUsd / baseRate]))
}

export type FxQuote = {
  corridorCode: string
  kind: 'deposit' | 'withdrawal'
  amountIn: string
  fiatCurrency: string
  referenceRate: string
  platformFee: string
  amountOut: string
  provider: string
}

/**
 * Quotes a RemitPulse transfer through a corridor. Corridor assets (USDC, EURC, ARST, BRLA) are
 * assumed to track their fiat currency ~1:1, so `referenceRate` here is informational (USD
 * equivalent) while the platform fee (fixedFee + markupBps) is what actually moves the amount.
 */
export async function quoteCorridor(code: string, amount: string, kind: 'deposit' | 'withdrawal'): Promise<FxQuote> {
  const corridor = await getCorridor(code)
  const amountIn = new Big(amount)
  if (amountIn.lt(corridor.minAmount.toString())) throw new UpstreamError('fx', `Amount below corridor minimum (${corridor.minAmount})`)
  if (corridor.maxAmount && amountIn.gt(corridor.maxAmount.toString())) {
    throw new UpstreamError('fx', `Amount above corridor maximum (${corridor.maxAmount})`)
  }

  const rates = await getReferenceRates('USD')
  const referenceRate = new Big(rates[corridor.fiatCurrency.toUpperCase()] ?? 1)

  const platformFee = amountIn.times(corridor.markupBps.toString()).div(10_000).plus(corridor.fixedFee.toString())
  const amountOut = amountIn.minus(platformFee)
  if (amountOut.lte(0)) throw new UpstreamError('fx', 'Amount is too small to cover the platform fee')

  return {
    corridorCode: corridor.code,
    kind,
    amountIn: amountIn.toFixed(7),
    fiatCurrency: corridor.fiatCurrency,
    referenceRate: referenceRate.toFixed(12),
    platformFee: platformFee.toFixed(7),
    amountOut: amountOut.toFixed(7),
    provider: env.FX_PROVIDER,
  }
}

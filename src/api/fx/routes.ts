import { z } from '../../lib/zod'
import { ApiRouter } from '../core/router'
import { getReferenceRates, quoteCorridor } from './service'

export const fxRouter = new ApiRouter('/v1/fx')

fxRouter.get({
  path: '/rates',
  summary: 'Live FX reference rates',
  description: 'Units of each supported fiat currency per 1 unit of `base`.',
  tags: ['FX'],
  auth: 'none',
  query: z.object({ base: z.string().length(3).default('USD').openapi({ example: 'USD' }) }),
  response: z.object({ base: z.string(), rates: z.record(z.number()), asOf: z.string() }),
  handler: async ({ query }) => ({
    base: query.base.toUpperCase(),
    rates: await getReferenceRates(query.base.toUpperCase()),
    asOf: new Date().toISOString(),
  }),
})

fxRouter.get({
  path: '/quote',
  summary: 'Quote the RemitPulse fee and net amount for a corridor transfer',
  tags: ['FX'],
  auth: 'none',
  query: z.object({
    corridor: z.string().min(2).max(12).openapi({ example: 'BRLA' }),
    amount: z.string().regex(/^\d+(\.\d{1,7})?$/).openapi({ example: '100.00' }),
    kind: z.enum(['deposit', 'withdrawal']).default('deposit'),
  }),
  response: z.object({
    corridorCode: z.string(),
    kind: z.enum(['deposit', 'withdrawal']),
    amountIn: z.string(),
    fiatCurrency: z.string(),
    referenceRate: z.string(),
    platformFee: z.string(),
    amountOut: z.string(),
    provider: z.string(),
  }),
  errors: { 404: 'Corridor not found', 502: 'FX quote could not be computed' },
  handler: async ({ query }) => quoteCorridor(query.corridor, query.amount, query.kind),
})

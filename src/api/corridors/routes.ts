import { prisma } from '../../config/database'
import { z } from '../../lib/zod'
import { ApiRouter } from '../core/router'
import { getCorridor, invalidateCorridorCache, serializeCorridor } from './service'

export const corridorsRouter = new ApiRouter('/v1/corridors')

export const CorridorSchema = z
  .object({
    code: z.string().openapi({ example: 'BRLA' }),
    name: z.string(),
    asset: z.object({ code: z.string(), issuer: z.string(), contractId: z.string() }),
    fiatCurrency: z.string().openapi({ example: 'BRL' }),
    anchorDomain: z.string(),
    markupBps: z.number().int(),
    fixedFee: z.string(),
    minAmount: z.string(),
    maxAmount: z.string().nullable(),
    isActive: z.boolean(),
  })
  .openapi('Corridor')

const CodeParams = z.object({ code: z.string().min(2).max(12).openapi({ example: 'USDC' }) })

corridorsRouter.get({
  path: '',
  summary: 'List active remittance corridors',
  tags: ['Corridors'],
  auth: 'none',
  response: z.array(CorridorSchema),
  handler: async () => {
    const corridors = await prisma.corridor.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } })
    return corridors.map(serializeCorridor)
  },
})

corridorsRouter.get({
  path: '/:code',
  summary: 'Get a corridor',
  tags: ['Corridors'],
  auth: 'none',
  params: CodeParams,
  response: CorridorSchema,
  errors: { 404: 'Corridor not found' },
  handler: async ({ params }) => serializeCorridor(await getCorridor(params.code)),
})

export const adminCorridorsRouter = new ApiRouter('/v1/admin/corridors')

adminCorridorsRouter.patch({
  path: '/:code',
  summary: 'Update corridor pricing or availability',
  tags: ['Admin'],
  auth: 'admin',
  params: CodeParams,
  body: z
    .object({
      markupBps: z.number().int().min(0).max(2_000),
      fixedFee: z.string().regex(/^\d+(\.\d{1,7})?$/),
      minAmount: z.string().regex(/^\d+(\.\d{1,7})?$/),
      maxAmount: z
        .string()
        .regex(/^\d+(\.\d{1,7})?$/)
        .nullable(),
      isActive: z.boolean(),
      anchorDomain: z.string().min(3),
    })
    .partial(),
  response: CorridorSchema,
  errors: { 404: 'Corridor not found' },
  handler: async ({ params, body }) => {
    const corridor = await getCorridor(params.code, { activeOnly: false })
    const updated = await prisma.corridor.update({ where: { id: corridor.id }, data: body })
    invalidateCorridorCache()
    return serializeCorridor(updated)
  },
})

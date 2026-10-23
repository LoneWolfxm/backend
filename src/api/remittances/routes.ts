import { z } from '../../lib/zod'
import { ApiRouter } from '../core/router'
import { get, list, sync } from './service'

export const remittancesRouter = new ApiRouter('/v1/remittances')

const RemittanceSchema = z
  .object({
    id: z.string().uuid(),
    corridorCode: z.string(),
    kind: z.enum(['deposit', 'withdrawal']),
    status: z.enum(['incomplete', 'pending_user_transfer', 'pending_anchor', 'completed', 'failed']),
    anchorStatus: z.string(),
    account: z.string(),
    anchorTxId: z.string(),
    amountIn: z.string().nullable(),
    amountOut: z.string().nullable(),
    amountFee: z.string().nullable(),
    platformFee: z.string().nullable(),
    interactiveUrl: z.string().nullable(),
    moreInfoUrl: z.string().nullable(),
    stellarTxHash: z.string().nullable(),
    statusMessage: z.string().nullable(),
    completedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('RemittanceTransaction')

const IdParams = z.object({ id: z.string().uuid() })

remittancesRouter.get({
  path: '',
  summary: "List the current user's remittance transactions",
  tags: ['Remittances'],
  auth: 'user',
  response: z.array(RemittanceSchema),
  handler: async ({ auth }) => list(auth.userId),
})

remittancesRouter.get({
  path: '/:id',
  summary: 'Get a remittance transaction',
  tags: ['Remittances'],
  auth: 'user',
  params: IdParams,
  response: RemittanceSchema,
  errors: { 404: 'Remittance transaction not found' },
  handler: async ({ auth, params }) => get(auth.userId, params.id),
})

remittancesRouter.post({
  path: '/:id/sync',
  summary: 'Refresh a transaction\'s status from the anchor',
  tags: ['Remittances'],
  auth: 'user',
  sensitive: true,
  params: IdParams,
  response: RemittanceSchema,
  errors: { 404: 'Remittance transaction not found', 502: 'Anchor could not be reached' },
  handler: async ({ auth, params }) => sync(auth.userId, params.id),
})

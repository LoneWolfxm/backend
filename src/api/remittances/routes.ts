import { z } from '../../lib/zod'
import { ApiRouter } from '../core/router'
import { get, list, listAll, listEvents, listSponsoredTransactions, sync } from './service'

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
  description: "Newest first. Pass the previous response's `nextCursor` to fetch the next page.",
  tags: ['Remittances'],
  auth: 'user',
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().uuid().optional(),
  }),
  response: z.object({ items: z.array(RemittanceSchema), nextCursor: z.string().uuid().nullable() }),
  handler: async ({ auth, query }) => list(auth.userId, query),
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
  summary: "Refresh a transaction's status from the anchor",
  tags: ['Remittances'],
  auth: 'user',
  sensitive: true,
  params: IdParams,
  response: RemittanceSchema,
  errors: { 404: 'Remittance transaction not found', 502: 'Anchor could not be reached' },
  handler: async ({ auth, params }) => sync(auth.userId, params.id),
})

const RemittanceEventSchema = z
  .object({
    id: z.string().uuid(),
    transactionId: z.string().uuid(),
    source: z.enum(['initiation', 'webhook', 'poll']),
    fromStatus: z.enum(['incomplete', 'pending_user_transfer', 'pending_anchor', 'completed', 'failed']).nullable(),
    toStatus: z.enum(['incomplete', 'pending_user_transfer', 'pending_anchor', 'completed', 'failed']),
    anchorStatus: z.string(),
    payload: z.unknown(),
    createdAt: z.string(),
  })
  .openapi('RemittanceEvent')

const AdminListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  status: z.enum(['incomplete', 'pending_user_transfer', 'pending_anchor', 'completed', 'failed']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

export const adminRemittancesRouter = new ApiRouter('/v1/admin/remittances')

adminRemittancesRouter.get({
  path: '',
  summary: 'List remittance transactions across all users',
  description: "Newest first. Pass the previous response's `nextCursor` to fetch the next page.",
  tags: ['Admin'],
  auth: 'admin',
  query: AdminListQuery,
  response: z.object({ items: z.array(RemittanceSchema), nextCursor: z.string().uuid().nullable() }),
  handler: async ({ query }) =>
    listAll({
      ...query,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    }),
})

adminRemittancesRouter.get({
  path: '/:id/events',
  summary: 'Get the full event history for a remittance transaction',
  tags: ['Admin'],
  auth: 'admin',
  params: IdParams,
  response: z.object({ items: z.array(RemittanceEventSchema) }),
  errors: { 404: 'Remittance transaction not found' },
  handler: async ({ params }) => ({ items: await listEvents(params.id) }),
})

const SponsoredTransactionSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string().nullable(),
    contractId: z.string().nullable(),
    method: z.string().nullable(),
    status: z.enum(['submitted', 'succeeded', 'failed']),
    feeCharged: z.string().nullable(),
    stellarTxHash: z.string(),
    errorMessage: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('SponsoredTransaction')

const AdminSponsoredTransactionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
  userId: z.string().optional(),
  status: z.enum(['submitted', 'succeeded', 'failed']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

export const adminSponsoredTransactionsRouter = new ApiRouter('/v1/admin/sponsored-transactions')

adminSponsoredTransactionsRouter.get({
  path: '',
  summary: 'List relayer-sponsored transactions across all users',
  description: "Newest first. Pass the previous response's `nextCursor` to fetch the next page.",
  tags: ['Admin'],
  auth: 'admin',
  query: AdminSponsoredTransactionsQuery,
  response: z.object({ items: z.array(SponsoredTransactionSchema), nextCursor: z.string().uuid().nullable() }),
  handler: async ({ query }) =>
    listSponsoredTransactions({
      ...query,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    }),
})

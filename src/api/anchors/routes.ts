import { z, zAmount } from '../../lib/zod'
import { ApiRouter } from '../core/router'
import { authenticate, handleWebhook, initiateDeposit, initiateWithdrawal } from './service'

export const anchorsRouter = new ApiRouter('/v1/anchors')

const CodeParams = z.object({ code: z.string().min(2).max(12).openapi({ example: 'BRLA' }) })

anchorsRouter.post({
  path: '/:code/sep10',
  summary: 'Authenticate with the corridor anchor (SEP-10)',
  description: 'Derives the user\'s custody account for this corridor and completes SEP-10 WebAuth, caching the anchor JWT.',
  tags: ['Anchors'],
  auth: 'user',
  sensitive: true,
  params: CodeParams,
  response: z.object({ account: z.string(), anchorDomain: z.string(), authenticated: z.boolean() }),
  errors: { 404: 'Corridor not found', 502: 'Anchor authentication failed' },
  handler: async ({ auth, params }) => authenticate(auth.userId, params.code),
})

anchorsRouter.post({
  path: '/:code/deposit',
  summary: 'Start a SEP-24 interactive deposit',
  description: 'Returns an interactive_customer_info_needed URL for the user to complete the anchor\'s hosted deposit flow.',
  tags: ['Anchors'],
  auth: 'user',
  sensitive: true,
  status: 201,
  params: CodeParams,
  body: z.object({ amount: zAmount.optional() }),
  response: z.object({ transactionId: z.string().uuid(), interactiveUrl: z.string(), anchorTxId: z.string(), account: z.string() }),
  errors: { 404: 'Corridor not found', 502: 'Anchor rejected the request' },
  handler: async ({ auth, params, body }) => initiateDeposit(auth.userId, params.code, body.amount),
})

anchorsRouter.post({
  path: '/:code/withdraw',
  summary: 'Start a SEP-24 interactive withdrawal',
  description:
    'Returns an interactive_customer_info_needed URL for the hosted withdrawal flow. The corridor asset must already be ' +
    'in the returned custody `account` (move it there first via POST /v1/wallet/payments) before completing the anchor form.',
  tags: ['Anchors'],
  auth: 'user',
  sensitive: true,
  status: 201,
  params: CodeParams,
  body: z.object({ amount: zAmount.optional() }),
  response: z.object({ transactionId: z.string().uuid(), interactiveUrl: z.string(), anchorTxId: z.string(), account: z.string() }),
  errors: { 404: 'Corridor not found', 502: 'Anchor rejected the request' },
  handler: async ({ auth, params, body }) => initiateWithdrawal(auth.userId, params.code, body.amount),
})

anchorsRouter.post({
  path: '/:code/webhook',
  summary: 'Anchor SEP-24 status-change callback',
  description: 'Receives transaction status updates from the corridor anchor. Verified via its stellar.toml SIGNING_KEY.',
  tags: ['Anchors'],
  auth: 'none',
  params: CodeParams,
  body: z.record(z.unknown()),
  response: z.object({ received: z.literal(true) }),
  errors: { 404: 'Unknown transaction', 502: 'Signature verification failed' },
  handler: async ({ params, req }) => {
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}))
    await handleWebhook(params.code, rawBody, req.header('signature'))
    return { received: true as const }
  },
})

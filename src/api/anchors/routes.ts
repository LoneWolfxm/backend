import { z, zAmount } from '../../lib/zod'
import { ApiRouter } from '../core/router'
import {
  authenticate,
  handleWebhook,
  initiateDeposit,
  initiateWithdrawal,
  prepareWithdrawalFunding,
  startWithdrawal,
} from './service'

export const anchorsRouter = new ApiRouter('/v1/anchors')

const CodeParams = z.object({ code: z.string().min(2).max(12).openapi({ example: 'BRLA' }) })

anchorsRouter.post({
  path: '/:code/sep10',
  summary: 'Authenticate with the corridor anchor (SEP-10)',
  description: "Derives the user's custody account for this corridor and completes SEP-10 WebAuth, caching the anchor JWT.",
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
  description: "Returns an interactive_customer_info_needed URL for the user to complete the anchor's hosted deposit flow.",
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

const PreparedInvocationSchema = z.object({
  id: z.string().uuid(),
  smartAccount: z.string(),
  invocation: z.record(z.unknown()),
  expiresAt: z.string().optional(),
})

anchorsRouter.post({
  path: '/:code/withdraw',
  summary: 'Start a SEP-24 interactive withdrawal',
  description:
    'Prepares the funding transfer that moves `amount` of the corridor asset from the user\'s smart wallet into the ' +
    "corridor's custody `account`, then starts the SEP-24 interactive withdrawal. The response includes a `funding` " +
    'PreparedInvocation that must be signed and submitted via POST /v1/wallet/invocations/:id/submit before the ' +
    'returned `interactiveUrl` is usable. If `funding` is null the custody account was already funded and the ' +
    'interactive URL can be used immediately.',
  tags: ['Anchors'],
  auth: 'user',
  sensitive: true,
  status: 201,
  params: CodeParams,
  body: z.object({ amount: zAmount }),
  response: z.object({
    transactionId: z.string().uuid(),
    interactiveUrl: z.string(),
    anchorTxId: z.string(),
    account: z.string(),
    funding: PreparedInvocationSchema.nullable(),
  }),
  errors: { 404: 'Corridor not found', 502: 'Anchor rejected the request' },
  handler: async ({ auth, params, body }) => initiateWithdrawal(auth.userId, params.code, body.amount),
})

anchorsRouter.post({
  path: '/:code/withdraw/funding',
  summary: 'Prepare the withdrawal funding transfer',
  description:
    "Prepares a wallet payment moving the corridor asset from the user's smart wallet into the corridor's custody " +
    'account. Sign and submit the returned invocation via POST /v1/wallet/invocations/:id/submit, then call ' +
    'POST /v1/anchors/:code/withdraw/start to begin the interactive flow.',
  tags: ['Anchors'],
  auth: 'user',
  sensitive: true,
  status: 201,
  params: CodeParams,
  body: z.object({ amount: zAmount }),
  response: z.object({ account: z.string(), funding: PreparedInvocationSchema.nullable() }),
  errors: { 404: 'Corridor not found' },
  handler: async ({ auth, params, body }) => prepareWithdrawalFunding(auth.userId, params.code, body.amount),
})

anchorsRouter.post({
  path: '/:code/withdraw/start',
  summary: 'Start the SEP-24 interactive withdrawal after funding',
  description:
    'Idempotently starts the SEP-24 interactive withdrawal once the funding transfer has landed in the custody ' +
    'account. Returns the interactive_customer_info_needed URL for the hosted withdrawal flow.',
  tags: ['Anchors'],
  auth: 'user',
  sensitive: true,
  status: 201,
  params: CodeParams,
  body: z.object({ amount: zAmount.optional() }),
  response: z.object({ transactionId: z.string().uuid(), interactiveUrl: z.string(), anchorTxId: z.string(), account: z.string() }),
  errors: { 404: 'Corridor not found', 502: 'Anchor rejected the request' },
  handler: async ({ auth, params, body }) => startWithdrawal(auth.userId, params.code, body.amount),
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

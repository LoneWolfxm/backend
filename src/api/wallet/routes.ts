import { prisma } from '../../config/database'
import { NotFoundError } from '../../errors'
import { z, zAddress, zAmount, zContractId } from '../../lib/zod'
import { ApiRouter } from '../core/router'
import { InvocationResultSchema, PreparedInvocationSchema, SubmitInvocationSchema } from './schemas'
import { WalletService } from './service'

const service = new WalletService()
export const walletRouter = new ApiRouter('/v1/wallet')

const TypedArgSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('address'), value: zAddress }),
    z.object({ type: z.enum(['i128', 'u128', 'i64', 'u64']), value: z.string().regex(/^-?\d+$/) }),
    z.object({ type: z.enum(['u32', 'i32']), value: z.number().int() }),
    z.object({ type: z.literal('bool'), value: z.boolean() }),
    z.object({ type: z.enum(['symbol', 'string']), value: z.string().max(256) }),
    z.object({ type: z.literal('bytes'), value: z.string().regex(/^([0-9a-fA-F]{2})*$/) }),
  ])
  .openapi('TypedScArg')

walletRouter.post({
  path: '/deploy',
  summary: 'Deploy the user smart wallet',
  description:
    'Invokes ACCOUNT_CONTRACT_ID.deploy(salt, key_id, public_key) with the enrolled passkey. ' +
    'Relayer-sourced and fee-bumped by the paymaster. Idempotent.',
  tags: ['Wallet'],
  auth: 'user',
  sensitive: true,
  response: z.object({ contractAddress: z.string(), txHash: z.string().nullable(), alreadyDeployed: z.boolean() }),
  handler: async ({ auth }) => service.deploy(auth.userId),
})

walletRouter.post({
  path: '/invocations',
  summary: 'Build a contract authorization payload',
  description:
    'Simulates contractId.method(args) with the wallet as invoker and returns the Soroban auth payload ' +
    'plus WebAuthn request options. Allowed targets: ACCOUNT_CONTRACT_ID, SUBSIDY_CONTRACT_ID, corridor ' +
    'asset contracts, RELAY_ALLOWED_CONTRACTS and the user wallet itself.',
  tags: ['Wallet'],
  auth: 'user',
  sensitive: true,
  status: 201,
  body: z.object({
    contractId: zContractId,
    method: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/),
    args: z.array(TypedArgSchema).max(16).default([]),
  }),
  response: PreparedInvocationSchema,
  errors: { 403: 'Contract not allowed' },
  handler: async ({ auth, body }) => service.prepareContractCall(auth.userId, body),
})

walletRouter.post({
  path: '/payments',
  summary: 'Prepare a token transfer from the wallet',
  description: 'signer=session_key enforces the key token scope and per-tx / total limits.',
  tags: ['Wallet'],
  auth: 'user',
  sensitive: true,
  status: 201,
  body: z
    .object({
      token: zContractId,
      to: zAddress,
      amount: zAmount,
      signer: z.enum(['passkey', 'session_key']).default('passkey'),
      sessionKeyId: z.string().uuid().optional(),
    })
    .refine(body => body.signer !== 'session_key' || body.sessionKeyId, { message: 'sessionKeyId is required', path: ['sessionKeyId'] }),
  response: PreparedInvocationSchema,
  errors: { 403: 'Session key scope or limit violation' },
  handler: async ({ auth, body }) => service.preparePayment(auth.userId, body),
})

walletRouter.post({
  path: '/invocations/:id/submit',
  summary: 'Submit a signed invocation',
  description:
    'Verifies the passkey assertion (or session-key signature) over the auth payload, attaches it to the auth ' +
    'entry, re-simulates, signs as relayer, fee-bumps via the paymaster and waits for the result.',
  tags: ['Wallet'],
  auth: 'user',
  sensitive: true,
  params: z.object({ id: z.string().uuid() }),
  body: SubmitInvocationSchema,
  response: InvocationResultSchema,
  errors: { 404: 'Invocation not found', 409: 'Already submitted', 502: 'Network rejected the transaction' },
  handler: async ({ auth, params, body }) =>
    service.submit(
      auth.userId,
      params.id,
      body.type === 'passkey' ? body : { type: 'session_key', signature: Buffer.from(body.signature, 'hex') }
    ),
})

walletRouter.get({
  path: '/invocations/:id',
  summary: 'Get invocation status',
  tags: ['Wallet'],
  auth: 'user',
  params: z.object({ id: z.string().uuid() }),
  response: z.object({
    id: z.string(),
    kind: z.string(),
    status: z.string(),
    contractId: z.string(),
    method: z.string(),
    txHash: z.string().nullable(),
    error: z.string().nullable(),
    createdAt: z.string(),
  }),
  errors: { 404: 'Invocation not found' },
  handler: async ({ auth, params }) => {
    const invocation = await prisma.pendingInvocation.findFirst({ where: { id: params.id, userId: auth.userId } })
    if (!invocation) throw new NotFoundError('Invocation')
    return {
      id: invocation.id,
      kind: invocation.kind,
      status: invocation.status,
      contractId: invocation.contractId,
      method: invocation.method,
      txHash: invocation.txHash,
      error: invocation.error,
      createdAt: invocation.createdAt.toISOString(),
    }
  },
})

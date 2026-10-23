import { env } from '../../config/env'
import { z, zAccountId, zAmount, zContractId } from '../../lib/zod'
import { ApiRouter } from '../core/router'
import { PreparedInvocationSchema } from '../wallet/schemas'
import { SessionKeyService } from './service'

const service = new SessionKeyService()
export const sessionKeysRouter = new ApiRouter('/v1/wallet/session-keys')

const SessionKeySchema = z
  .object({
    id: z.string().uuid(),
    publicKey: z.string(),
    tokenContract: z.string(),
    perTxLimit: z.string(),
    totalLimit: z.string(),
    spent: z.string(),
    expiresAt: z.string(),
    expiresAtLedger: z.number().int(),
    status: z.enum(['pending', 'active', 'revoked', 'expired']),
    registerTxHash: z.string().nullable(),
  })
  .openapi('SessionKey')

sessionKeysRouter.post({
  path: '',
  summary: 'Issue a scoped Ed25519 session key',
  description:
    'The client generates an Ed25519 keypair and sends the public key. Returns a prepared ' +
    '`add_session_key` invocation that the user signs once with their passkey via ' +
    'POST /v1/wallet/invocations/{id}/submit; the key becomes active when that transaction lands.',
  tags: ['Session Keys'],
  auth: 'user',
  sensitive: true,
  status: 201,
  body: z.object({
    publicKey: zAccountId.openapi({ description: 'Ed25519 public key (G... strkey) held by the device' }),
    tokenContract: zContractId,
    perTxLimit: zAmount,
    totalLimit: zAmount,
    ttlSeconds: z.number().int().min(60).max(env.SESSION_KEY_MAX_TTL_SECONDS).default(24 * 3600),
  }),
  response: z.object({ sessionKey: SessionKeySchema, invocation: PreparedInvocationSchema }),
  errors: { 409: 'Key already registered' },
  handler: async ({ auth, body }) => service.issue(auth.userId, body),
})

sessionKeysRouter.get({
  path: '',
  summary: 'List session keys',
  tags: ['Session Keys'],
  auth: 'user',
  response: z.array(SessionKeySchema),
  handler: async ({ auth }) => service.list(auth.userId),
})

sessionKeysRouter.delete({
  path: '/:id',
  summary: 'Revoke a session key',
  description:
    'Immediately stops relaying for the key and returns a `revoke_session_key` invocation for on-chain removal.',
  tags: ['Session Keys'],
  auth: 'user',
  sensitive: true,
  params: z.object({ id: z.string().uuid() }),
  response: z.object({ sessionKey: SessionKeySchema, invocation: PreparedInvocationSchema.nullable() }),
  errors: { 404: 'Session key not found' },
  handler: async ({ auth, params }) => service.revoke(auth.userId, params.id),
})

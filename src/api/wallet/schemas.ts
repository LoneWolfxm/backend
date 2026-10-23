import { z } from '../../lib/zod'
import { AuthenticationResponseSchema } from '../core/schemas'

export const PreparedInvocationSchema = z
  .object({
    invocationId: z.string().uuid(),
    kind: z.string(),
    contractId: z.string(),
    method: z.string(),
    signer: z.enum(['passkey', 'session_key', 'none']),
    authPayload: z
      .object({ hex: z.string(), base64url: z.string() })
      .nullable()
      .openapi({ description: 'sha256(HashIdPreimageSorobanAuthorization) — the bytes the wallet signer must sign' }),
    authEntryXdr: z.string().nullable().openapi({ description: 'Unsigned SorobanAuthorizationEntry (base64 XDR)' }),
    validUntilLedger: z.number().int().nullable(),
    webauthnOptions: z
      .record(z.unknown())
      .nullable()
      .openapi({ description: 'Pass to startAuthentication(); its challenge is the auth payload' }),
    minResourceFee: z.string(),
    expiresAt: z.string(),
  })
  .openapi('PreparedInvocation')

export const InvocationResultSchema = z
  .object({
    invocationId: z.string().uuid(),
    status: z.string(),
    txHash: z.string().nullable(),
    ledger: z.number().int().optional(),
    returnValue: z.unknown().optional(),
  })
  .openapi('InvocationResult')

export const SubmitInvocationSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('passkey'), assertion: AuthenticationResponseSchema }),
    z.object({
      type: z.literal('session_key'),
      signature: z
        .string()
        .regex(/^[0-9a-fA-F]{128}$/, 'must be a 64-byte hex Ed25519 signature')
        .openapi({ description: 'Ed25519 signature over authPayload (hex)' }),
    }),
  ])
  .openapi('SubmitInvocation')

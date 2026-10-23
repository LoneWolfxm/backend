import { z } from '../../lib/zod'
import { ApiRouter } from '../core/router'
import {
  AuthenticationResponseSchema,
  emailSchema,
  RegistrationResponseSchema,
  UserSchema,
  WebAuthnOptionsSchema,
} from '../core/schemas'
import { AuthService } from './service'

const service = new AuthService()
export const authRouter = new ApiRouter('/v1/auth')

const SessionSchema = z.object({ token: z.string(), user: UserSchema }).openapi('Session')

authRouter.post({
  path: '/passkey/register/options',
  summary: 'Start passkey enrollment',
  description: 'Returns WebAuthn creation options (ES256 only, user verification required).',
  tags: ['Auth'],
  auth: 'none',
  sensitive: true,
  body: z.object({ email: emailSchema }),
  response: WebAuthnOptionsSchema,
  errors: { 409: 'Account already has a passkey' },
  handler: async ({ body }) => service.registrationOptions(body.email) as unknown as Record<string, unknown>,
})

authRouter.post({
  path: '/passkey/register/verify',
  summary: 'Complete passkey enrollment',
  description:
    'Verifies the attestation, stores the P-256 public key and returns a session token. ' +
    'Call POST /v1/wallet/deploy next to create the on-chain smart wallet.',
  tags: ['Auth'],
  auth: 'none',
  sensitive: true,
  status: 201,
  body: z.object({ email: emailSchema, label: z.string().max(64).optional(), response: RegistrationResponseSchema }),
  response: SessionSchema,
  errors: { 409: 'Account already has a passkey' },
  handler: async ({ body }) => service.register(body.email, body.response, body.label),
})

authRouter.post({
  path: '/passkey/login/options',
  summary: 'Start passkey login',
  tags: ['Auth'],
  auth: 'none',
  sensitive: true,
  body: z.object({ email: emailSchema }),
  response: WebAuthnOptionsSchema,
  handler: async ({ body }) => service.loginOptions(body.email) as unknown as Record<string, unknown>,
})

authRouter.post({
  path: '/passkey/login/verify',
  summary: 'Complete passkey login',
  tags: ['Auth'],
  auth: 'none',
  sensitive: true,
  body: z.object({ email: emailSchema, response: AuthenticationResponseSchema }),
  response: SessionSchema,
  handler: async ({ body }) => service.login(body.email, body.response),
})

authRouter.get({
  path: '/me',
  summary: 'Current user',
  tags: ['Auth'],
  auth: 'user',
  response: UserSchema,
  handler: async ({ auth }) => service.me(auth.userId),
})

import { z } from '../../lib/zod'
import { ApiRouter } from '../core/router'
import { AuthenticationResponseSchema, emailSchema, RegistrationResponseSchema, UserSchema, WebAuthnOptionsSchema } from '../core/schemas'
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

authRouter.post({
  path: '/passkey/add/options',
  summary: 'Start adding an additional passkey',
  description:
    'Returns WebAuthn creation options for registering another passkey on the current account. ' +
    'Existing passkeys are excluded so the same device is not re-registered.',
  tags: ['Auth'],
  auth: 'user',
  sensitive: true,
  response: WebAuthnOptionsSchema,
  handler: async ({ auth }) => service.addPasskeyOptions(auth.userId) as unknown as Record<string, unknown>,
})

authRouter.post({
  path: '/passkey/add/verify',
  summary: 'Complete adding an additional passkey',
  description: 'Verifies the attestation and stores the new passkey on the current account.',
  tags: ['Auth'],
  auth: 'user',
  sensitive: true,
  status: 201,
  body: z.object({ label: z.string().max(64).optional(), response: RegistrationResponseSchema }),
  response: UserSchema,
  handler: async ({ auth, body }) => service.addPasskey(auth.userId, body.response, body.label),
})

authRouter.delete({
  path: '/passkeys/:credentialId',
  summary: 'Remove a passkey',
  description: 'Removes a passkey from the current account. The last remaining passkey cannot be removed.',
  tags: ['Auth'],
  auth: 'user',
  sensitive: true,
  params: z.object({ credentialId: z.string().min(1) }),
  response: UserSchema,
  errors: { 404: 'Passkey not found', 409: 'Cannot remove the last remaining passkey' },
  handler: async ({ auth, params }) => service.removePasskey(auth.userId, params.credentialId),
})

authRouter.get({
  path: '/me',
  summary: 'Current user',
  tags: ['Auth'],
  auth: 'user',
  response: UserSchema,
  handler: async ({ auth }) => service.me(auth.userId),
})

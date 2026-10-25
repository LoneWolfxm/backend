import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'

import { z } from '../../lib/zod'

const base64url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/, 'must be base64url')

export const RegistrationResponseSchema = z
  .object({
    id: base64url,
    rawId: base64url,
    type: z.literal('public-key'),
    response: z
      .object({
        clientDataJSON: base64url,
        attestationObject: base64url,
        transports: z.array(z.string()).optional(),
      })
      .passthrough(),
    clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
    authenticatorAttachment: z.string().optional(),
  })
  .passthrough()
  .transform(value => value as unknown as RegistrationResponseJSON)
  .openapi('RegistrationResponseJSON', { description: 'Output of navigator.credentials.create() as JSON' })

export const AuthenticationResponseSchema = z
  .object({
    id: base64url,
    rawId: base64url,
    type: z.literal('public-key'),
    response: z
      .object({
        clientDataJSON: base64url,
        authenticatorData: base64url,
        signature: base64url,
        userHandle: base64url.optional(),
      })
      .passthrough(),
    clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
    authenticatorAttachment: z.string().optional(),
  })
  .passthrough()
  .transform(value => value as unknown as AuthenticationResponseJSON)
  .openapi('AuthenticationResponseJSON', { description: 'Output of navigator.credentials.get() as JSON' })

export const WebAuthnOptionsSchema = z
  .record(z.string(), z.unknown())
  .openapi('WebAuthnOptions', { description: 'PublicKeyCredential creation/request options (JSON) for @simplewebauthn/browser' })

export const UserSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string().email(),
    contractAddress: z.string().nullable(),
    passkeys: z.array(z.object({ credentialId: z.string(), label: z.string().nullable(), createdAt: z.string() })),
  })
  .openapi('User')

export const emailSchema = z
  .string()
  .email()
  .max(254)
  .transform(value => value.trim().toLowerCase())
  .openapi({ example: 'ada@example.com' })

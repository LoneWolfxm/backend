import { OpenApiGeneratorV31, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'

import { env } from '../../config/env'
import { z } from '../../lib/zod'

export const registry = new OpenAPIRegistry()

registry.registerComponent('securitySchemes', 'BearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description: 'RemitPulse session JWT returned by the passkey login/registration endpoints',
})
registry.registerComponent('securitySchemes', 'ApiKey', {
  type: 'apiKey',
  in: 'header',
  name: 'x-api-key',
  description: 'Admin API key (ADMIN_API_KEYS)',
})

export const ErrorResponseSchema = registry.register(
  'ErrorResponse',
  z.object({
    error: z.object({
      code: z.string().openapi({ example: 'VALIDATION_ERROR' }),
      message: z.string(),
      details: z.any().optional(),
    }),
  })
)

let cached: ReturnType<OpenApiGeneratorV31['generateDocument']> | undefined

export function buildOpenApiDocument(): ReturnType<OpenApiGeneratorV31['generateDocument']> {
  cached ??= new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'RemitPulse Backend API',
      version: '0.1.0',
      description:
        'Passkey smart wallets, sponsored Soroban relay, SEP-10/SEP-24 remittance corridors and FX quoting on Stellar.\n\n' +
        'Based on backend architecture from: https://github.com/stellar/smart-wallet-demo-app',
    },
    servers: [{ url: env.PUBLIC_BASE_URL }],
    tags: [
      { name: 'Health' },
      { name: 'Auth', description: 'Passkey (WebAuthn) enrollment and login' },
      { name: 'Wallet', description: 'Smart wallet deployment, contract authorization payloads and relay' },
      { name: 'Session Keys', description: 'Scoped Ed25519 signers for low-value payments' },
      { name: 'Paymaster', description: 'Fee-bump sponsorship of user transactions' },
      { name: 'Corridors', description: 'Remittance corridors and anchors' },
      { name: 'Anchors', description: 'SEP-10 WebAuth and SEP-24 interactive flows' },
      { name: 'Remittances', description: 'Remittance lifecycle tracking' },
      { name: 'FX', description: 'Exchange rates and fee quotes' },
      { name: 'Admin' },
    ],
  })
  return cached
}

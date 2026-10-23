import { Keypair, StrKey } from '@stellar/stellar-sdk'

process.env.NODE_ENV ??= 'test'
process.env.PORT ??= '8080'
process.env.PUBLIC_BASE_URL ??= 'http://localhost:8080'
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/remitpulse_test'

process.env.JWT_SECRET ??= 'test-jwt-secret-at-least-32-characters-long'
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-32-bytes-min'
process.env.ANCHOR_CUSTODY_SEED ??= 'test-anchor-custody-seed-32-bytes-min'

process.env.STELLAR_NETWORK_PASSPHRASE ??= 'Test SDF Network ; September 2015'
process.env.STELLAR_RPC_URL ??= 'https://soroban-testnet.stellar.org'
process.env.STELLAR_HORIZON_URL ??= 'https://horizon-testnet.stellar.org'

process.env.ACCOUNT_CONTRACT_ID ??= StrKey.encodeContract(Buffer.alloc(32, 0))
process.env.SUBSIDY_CONTRACT_ID ??= StrKey.encodeContract(Buffer.alloc(32, 1))

process.env.RELAYER_SECRET_KEY ??= Keypair.random().secret()
process.env.PAYMASTER_SECRET_KEY ??= Keypair.random().secret()

process.env.WEBAUTHN_RP_ID ??= 'localhost'
process.env.WEBAUTHN_ORIGINS ??= 'http://localhost:5173'

process.env.ADMIN_API_KEYS ??= 'test-admin-key'

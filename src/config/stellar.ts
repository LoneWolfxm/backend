import { Keypair } from '@stellar/stellar-sdk'

import { env } from './env'

export const STELLAR = {
  networkPassphrase: env.STELLAR_NETWORK_PASSPHRASE,
  rpcUrl: env.STELLAR_RPC_URL,
  horizonUrl: env.STELLAR_HORIZON_URL,
  rpcHeaders:
    env.STELLAR_RPC_AUTH_HEADER_NAME && env.STELLAR_RPC_AUTH_HEADER_VALUE
      ? { [env.STELLAR_RPC_AUTH_HEADER_NAME]: env.STELLAR_RPC_AUTH_HEADER_VALUE }
      : {},
  txTimeoutSeconds: env.STELLAR_TX_TIMEOUT_SECONDS,
  baseFee: env.STELLAR_BASE_FEE,
  // Source account for relayed Soroban invocations
  relayer: Keypair.fromSecret(env.RELAYER_SECRET_KEY),
  // Fee-bump sponsor
  paymaster: Keypair.fromSecret(env.PAYMASTER_SECRET_KEY),
  contracts: {
    account: env.ACCOUNT_CONTRACT_ID,
    subsidy: env.SUBSIDY_CONTRACT_ID,
  },
  // Token amounts on Stellar use 7 decimal places
  decimals: 7,
} as const

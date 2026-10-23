import { createHmac } from 'node:crypto'

import type { Asset } from '@stellar/stellar-sdk'
import { BASE_FEE, Horizon, Keypair, NotFoundError as HorizonNotFoundError, Operation, TransactionBuilder } from '@stellar/stellar-sdk'

import { env } from '../../config/env'
import { logger } from '../../config/logger'
import { STELLAR } from '../../config/stellar'
import { UpstreamError } from '../../errors'
import { retry } from '../../lib/retry'

const horizon = new Horizon.Server(STELLAR.horizonUrl, { allowHttp: STELLAR.horizonUrl.startsWith('http://') })

/**
 * Deterministically derives a per-user Ed25519 "anchor custody" keypair, distinct from both
 * RELAYER_SECRET_KEY and the user's smart wallet. Classic SEP-10/SEP-24 anchors transact with
 * plain Stellar (G...) accounts; this account is the bridge RemitPulse controls on the user's
 * behalf for that leg, derived on demand so no extra secret material is stored in the database.
 */
export function deriveAnchorKeypair(userId: string): Keypair {
  const seed = createHmac('sha256', env.ANCHOR_CUSTODY_SEED).update(`anchor-custody:${userId}`).digest()
  return Keypair.fromRawEd25519Seed(seed)
}

async function loadAccount(accountId: string): Promise<Horizon.AccountResponse | undefined> {
  try {
    return await horizon.loadAccount(accountId)
  } catch (error) {
    if (error instanceof HorizonNotFoundError) return undefined
    throw new UpstreamError('horizon', `failed to load account ${accountId}`, { cause: (error as Error).message })
  }
}

async function submit(tx: Parameters<Horizon.Server['submitTransaction']>[0]): Promise<void> {
  try {
    await retry(() => horizon.submitTransaction(tx), { attempts: 2 })
  } catch (error) {
    const extras = (error as { response?: { data?: { extras?: unknown } } }).response?.data?.extras
    throw new UpstreamError('horizon', 'transaction rejected', { extras })
  }
}

/**
 * Ensures the given custody account exists (funded by the relayer, which sponsors its base
 * reserve) and, if `asset` is given, holds a trustline for it. No-op for whatever already
 * exists. Required before an anchor can send funds to, or accept funds from, this account.
 */
export async function ensureAnchorAccount(keypair: Keypair, asset?: Asset): Promise<void> {
  const existing = await loadAccount(keypair.publicKey())

  if (!existing) {
    const sponsor = await loadAccount(STELLAR.relayer.publicKey())
    if (!sponsor) throw new UpstreamError('horizon', 'relayer account is not funded on this network')

    const builder = new TransactionBuilder(sponsor, { fee: BASE_FEE, networkPassphrase: STELLAR.networkPassphrase })
      .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: keypair.publicKey() }))
      .addOperation(Operation.createAccount({ destination: keypair.publicKey(), startingBalance: '0' }))

    if (asset) builder.addOperation(Operation.changeTrust({ asset, source: keypair.publicKey() }))
    builder.addOperation(Operation.endSponsoringFutureReserves({ source: keypair.publicKey() })).setTimeout(STELLAR.txTimeoutSeconds)

    const tx = builder.build()
    tx.sign(STELLAR.relayer, keypair)
    await submit(tx)
    logger.info({ account: keypair.publicKey(), asset: asset?.code }, 'custody | account created and sponsored')
    return
  }

  if (!asset) return
  const hasTrustline = existing.balances.some(
    balance => 'asset_code' in balance && balance.asset_code === asset.code && balance.asset_issuer === asset.issuer
  )
  if (hasTrustline) return

  const sponsor = await loadAccount(STELLAR.relayer.publicKey())
  if (!sponsor) throw new UpstreamError('horizon', 'relayer account is not funded on this network')

  const tx = new TransactionBuilder(sponsor, { fee: BASE_FEE, networkPassphrase: STELLAR.networkPassphrase })
    .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: keypair.publicKey() }))
    .addOperation(Operation.changeTrust({ asset, source: keypair.publicKey() }))
    .addOperation(Operation.endSponsoringFutureReserves({ source: keypair.publicKey() }))
    .setTimeout(STELLAR.txTimeoutSeconds)
    .build()
  tx.sign(STELLAR.relayer, keypair)
  await submit(tx)
  logger.info({ account: keypair.publicKey(), asset: asset.code }, 'custody | trustline established')
}

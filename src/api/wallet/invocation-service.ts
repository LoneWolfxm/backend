import { Prisma, PendingInvocation, InvocationKind } from '@prisma/client'
import type { AuthenticationResponseJSON } from '@simplewebauthn/server'
import { Keypair, scValToNative, StrKey, xdr } from '@stellar/stellar-sdk'

import { prisma } from '../../config/database'
import { env } from '../../config/env'
import { logger } from '../../config/logger'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from '../../errors'
import { relayAllowedContracts, WalletSignature } from '../../interfaces/contracts/bindings'
import { Paymaster, SponsorResult } from '../../interfaces/paymaster'
import { InvocationInput, SorobanService } from '../../interfaces/soroban'
import { WebAuthnService } from '../../interfaces/webauthn'
import { corridorTokenContracts } from '../corridors/service'

export type SignerKind = 'passkey' | 'session_key' | 'none'

export type PrepareInput = {
  userId: string
  kind: InvocationKind
  invocation: InvocationInput
  signer: SignerKind
  sessionKeyId?: string
  metadata?: Prisma.InputJsonObject
}

export type SubmitInput =
  | { type: 'passkey'; assertion: AuthenticationResponseJSON }
  | { type: 'session_key'; signature: Buffer }
  | { type: 'none' }

export type SubmitHooks = {
  /** Runs after the invocation is claimed; returns a compensating action used if submission fails. */
  reserve?: () => Promise<() => Promise<void>>
  /** Runs after the transaction is applied on-chain. */
  onSuccess?: (txHash: string) => Promise<void>
}

export type InvocationResult = {
  invocationId: string
  status: string
  txHash: string | null
  ledger?: number
  returnValue?: unknown
}

/** Converts scValToNative output into JSON-safe values (bigints → strings, bytes → hex). */
export function toJsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString('hex')
  if (Array.isArray(value)) return value.map(toJsonSafe)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, toJsonSafe(inner)]))
  }
  return value
}

/**
 * Two-phase relay for smart-wallet invocations:
 *
 *  1. prepare: simulate the call with the relayer as source, extract the auth
 *     entry the user's wallet must sign and derive its signature payload.
 *  2. submit:  attach the passkey / session-key signature, rebuild the tx with a
 *     fresh relayer sequence, re-simulate, sign, fee-bump via the paymaster and send.
 */
export class InvocationService {
  private static instance?: InvocationService

  constructor(
    private readonly soroban = SorobanService.getInstance(),
    private readonly paymaster = Paymaster.getInstance(),
    private readonly webauthn = WebAuthnService.getInstance()
  ) {}

  static getInstance(): InvocationService {
    InvocationService.instance ??= new InvocationService()
    return InvocationService.instance
  }

  async allowedContracts(wallet?: string | null): Promise<Set<string>> {
    const allowed = relayAllowedContracts(env.RELAY_ALLOWED_CONTRACTS)
    for (const token of await corridorTokenContracts()) allowed.add(token)
    if (wallet) allowed.add(wallet)
    return allowed
  }

  async prepare(input: PrepareInput) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: input.userId }, include: { passkeys: true } })
    const wallet = user.contractAddress
    if (input.signer !== 'none' && !wallet) {
      throw new BadRequestError('Smart wallet not deployed yet; call POST /v1/wallet/deploy', undefined, 'WALLET_NOT_DEPLOYED')
    }

    const allowed = await this.allowedContracts(wallet)
    if (!allowed.has(input.invocation.contractId)) {
      throw new ForbiddenError(`Contract ${input.invocation.contractId} is not allowed through the relay`, undefined, 'CONTRACT_NOT_ALLOWED')
    }

    const operation = this.soroban.buildOperation(input.invocation)
    const { simulation } = await this.soroban.simulateOperation(operation)

    // Only the user's own wallet can be authorised through this flow
    const required = this.soroban.requiredSigners(simulation)
    const foreign = required.filter(address => address !== wallet)
    if (foreign.length) {
      throw new BadRequestError('Invocation requires authorization from other accounts', { signers: foreign }, 'UNSUPPORTED_AUTH')
    }

    let authEntryXdr: string | undefined
    let authPayload: Buffer | undefined
    let validUntilLedger: number | undefined

    if (input.signer === 'none') {
      if (required.length) throw new BadRequestError('Invocation requires a wallet signature', undefined, 'SIGNATURE_REQUIRED')
    } else {
      const entry = this.soroban.findAuthEntry(simulation, wallet!)
      if (!entry) throw new BadRequestError('Invocation does not require wallet authorization', undefined, 'NO_AUTH_REQUIRED')
      validUntilLedger = await this.soroban.validUntilLedger(env.WEBAUTHN_CHALLENGE_TTL_SECONDS)
      authPayload = this.soroban.authPayload(entry, validUntilLedger)
      authEntryXdr = entry.toXDR('base64')
    }

    const pending = await prisma.pendingInvocation.create({
      data: {
        userId: user.id,
        kind: input.kind,
        contractId: input.invocation.contractId,
        method: input.invocation.method,
        // Keep every simulated auth entry (incl. source-account ones); the wallet's is swapped at submit
        txXdr: this.soroban.buildOperation(input.invocation, simulation.result?.auth ?? []).toXDR('base64'),
        authEntryXdr,
        validUntilLedger,
        authPayload: authPayload?.toString('base64url'),
        signer: input.signer,
        sessionKeyId: input.sessionKeyId,
        metadata: input.metadata,
        expiresAt: new Date(Date.now() + env.WEBAUTHN_CHALLENGE_TTL_SECONDS * 1000),
      },
    })

    const webauthnOptions =
      input.signer === 'passkey' && authPayload
        ? await this.webauthn.contractSigningOptions(user.passkeys, authPayload)
        : undefined

    return {
      invocationId: pending.id,
      kind: pending.kind,
      contractId: pending.contractId,
      method: pending.method,
      signer: input.signer,
      // Exact 32 bytes the wallet's __check_auth will verify
      authPayload: authPayload ? { hex: authPayload.toString('hex'), base64url: authPayload.toString('base64url') } : null,
      authEntryXdr: authEntryXdr ?? null,
      validUntilLedger: validUntilLedger ?? null,
      webauthnOptions: (webauthnOptions as unknown as Record<string, unknown>) ?? null,
      minResourceFee: simulation.minResourceFee,
      expiresAt: pending.expiresAt.toISOString(),
    }
  }

  async get(userId: string, id: string): Promise<PendingInvocation> {
    const pending = await prisma.pendingInvocation.findUnique({ where: { id } })
    if (!pending || pending.userId !== userId) throw new NotFoundError('Invocation')
    return pending
  }

  async submit(userId: string, id: string, input: SubmitInput, hooks: SubmitHooks = {}): Promise<InvocationResult> {
    const pending = await this.get(userId, id)
    if (pending.status !== 'awaiting_signature') throw new ConflictError(`Invocation is already ${pending.status}`)
    if (pending.expiresAt < new Date()) {
      await prisma.pendingInvocation.update({ where: { id }, data: { status: 'expired' } })
      throw new BadRequestError('Invocation expired; prepare it again', undefined, 'INVOCATION_EXPIRED')
    }
    if (input.type !== pending.signer) {
      throw new BadRequestError(`Invocation expects a ${pending.signer} signature`, undefined, 'WRONG_SIGNER')
    }

    const signedEntry = await this.buildSignedAuth(userId, pending, input)

    // Claim the invocation so concurrent submits cannot double-spend it
    const claimed = await prisma.pendingInvocation.updateMany({
      where: { id, status: 'awaiting_signature' },
      data: { status: 'submitted' },
    })
    if (claimed.count === 0) throw new ConflictError('Invocation is already being submitted')

    let release: (() => Promise<void>) | undefined
    let submitted: SponsorResult
    try {
      release = await hooks.reserve?.()
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
      const operation = this.attachWalletAuth(xdr.Operation.fromXDR(pending.txXdr, 'base64'), user.contractAddress, signedEntry)
      const allowed = await this.allowedContracts(user.contractAddress)

      const result = await this.soroban.withRelayer(async () => {
        const { tx } = await this.soroban.prepareSigned(operation)
        return this.paymaster.sponsor(tx, { userId, beneficiary: user.contractAddress ?? undefined, allowedContracts: allowed })
      })

      submitted = result
    } catch (error) {
      logger.warn({ invocationId: id, err: error }, 'InvocationService | submit | failed')
      await release?.()
      await prisma.pendingInvocation.update({ where: { id }, data: { status: 'failed', error: (error as Error).message } })
      throw error
    }

    // The transaction is final on-chain from here: bookkeeping errors must not mark it failed
    await prisma.pendingInvocation.update({ where: { id }, data: { status: 'succeeded', txHash: submitted.hash } })
    await hooks.onSuccess?.(submitted.hash)
    return {
      invocationId: id,
      status: 'succeeded',
      txHash: submitted.hash,
      ledger: submitted.ledger,
      returnValue: submitted.returnValue ? toJsonSafe(scValToNative(submitted.returnValue)) : undefined,
    }
  }

  private attachWalletAuth(
    operation: xdr.Operation,
    wallet: string | null,
    signed: xdr.SorobanAuthorizationEntry | null
  ): xdr.Operation {
    if (!signed || !wallet) return operation
    const auth = operation.body().invokeHostFunctionOp().auth()
    return this.soroban.withAuth(
      operation,
      auth.map(entry => (this.soroban.isAddressEntry(entry, wallet) ? signed : entry))
    )
  }

  private async buildSignedAuth(userId: string, pending: PendingInvocation, input: SubmitInput): Promise<xdr.SorobanAuthorizationEntry | null> {
    if (input.type === 'none') return null
    if (!pending.authEntryXdr || !pending.authPayload || !pending.validUntilLedger) {
      throw new BadRequestError('Invocation has no auth entry to sign')
    }

    const entry = xdr.SorobanAuthorizationEntry.fromXDR(pending.authEntryXdr, 'base64')
    const payload = Buffer.from(pending.authPayload, 'base64url')

    if (pending.validUntilLedger <= (await this.soroban.latestLedger())) {
      throw new BadRequestError('Signature window has passed; prepare the invocation again', undefined, 'INVOCATION_EXPIRED')
    }

    let signature: xdr.ScVal
    if (input.type === 'passkey') {
      const passkey = await prisma.passkey.findFirst({ where: { userId, credentialId: input.assertion.id } })
      if (!passkey) throw new UnauthorizedError('Unknown passkey')
      const assertion = await this.webauthn.verifyContractAssertion(passkey, input.assertion, payload)
      signature = WalletSignature.passkey(assertion)
    } else {
      const sessionKey = pending.sessionKeyId ? await prisma.sessionKey.findUnique({ where: { id: pending.sessionKeyId } }) : null
      if (!sessionKey || sessionKey.userId !== userId) throw new UnauthorizedError('Unknown session key')
      if (sessionKey.status !== 'active' || sessionKey.expiresAt < new Date()) {
        throw new ForbiddenError('Session key is not active', { status: sessionKey.status }, 'SESSION_KEY_INACTIVE')
      }
      if (input.signature.length !== 64) throw new BadRequestError('Ed25519 signature must be 64 bytes')
      if (!Keypair.fromPublicKey(sessionKey.publicKey).verify(payload, input.signature)) {
        throw new UnauthorizedError('Session key signature is invalid')
      }
      signature = WalletSignature.sessionKey({
        publicKey: StrKey.decodeEd25519PublicKey(sessionKey.publicKey),
        signature: input.signature,
      })
    }

    return this.soroban.attachSignature(entry, pending.validUntilLedger, signature)
  }
}

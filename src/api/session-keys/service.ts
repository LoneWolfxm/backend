import { SessionKey } from '@prisma/client'

import { prisma } from '../../config/database'
import { env } from '../../config/env'
import { BadRequestError, ConflictError, NotFoundError } from '../../errors'
import { SmartWallet } from '../../interfaces/contracts/bindings'
import { SorobanService } from '../../interfaces/soroban'
import { Big, fromBaseUnits, toBaseUnits } from '../../lib/money'
import { InvocationService } from '../wallet/invocation-service'

export function serializeSessionKey(key: SessionKey) {
  const expired = key.status === 'active' && key.expiresAt < new Date()
  return {
    id: key.id,
    publicKey: key.publicKey,
    tokenContract: key.tokenContract,
    perTxLimit: fromBaseUnits(key.perTxLimit.toFixed(0)),
    totalLimit: fromBaseUnits(key.totalLimit.toFixed(0)),
    spent: fromBaseUnits(key.spent.toFixed(0)),
    expiresAt: key.expiresAt.toISOString(),
    expiresAtLedger: key.expiresAtLedger,
    status: expired ? 'expired' : key.status,
    registerTxHash: key.registerTxHash,
  }
}

/**
 * Scoped Ed25519 session keys: the client generates a keypair, the user authorises
 * `add_session_key` on their wallet with their passkey once, after which the
 * session key can sign low-value transfers of a single token within limits.
 */
export class SessionKeyService {
  constructor(
    private readonly invocations = InvocationService.getInstance(),
    private readonly soroban = SorobanService.getInstance()
  ) {}

  async issue(
    userId: string,
    input: { publicKey: string; tokenContract: string; perTxLimit: string; totalLimit: string; ttlSeconds: number }
  ) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    if (!user.contractAddress) throw new BadRequestError('Smart wallet not deployed yet', undefined, 'WALLET_NOT_DEPLOYED')

    if (new Big(input.perTxLimit).gt(env.SESSION_KEY_MAX_PER_TX)) {
      throw new BadRequestError(`perTxLimit cannot exceed ${env.SESSION_KEY_MAX_PER_TX}`, undefined, 'SESSION_KEY_LIMIT')
    }
    if (new Big(input.totalLimit).gt(env.SESSION_KEY_MAX_TOTAL)) {
      throw new BadRequestError(`totalLimit cannot exceed ${env.SESSION_KEY_MAX_TOTAL}`, undefined, 'SESSION_KEY_LIMIT')
    }
    if (new Big(input.perTxLimit).gt(input.totalLimit)) throw new BadRequestError('perTxLimit cannot exceed totalLimit')
    if (input.ttlSeconds > env.SESSION_KEY_MAX_TTL_SECONDS) {
      throw new BadRequestError(`ttlSeconds cannot exceed ${env.SESSION_KEY_MAX_TTL_SECONDS}`, undefined, 'SESSION_KEY_LIMIT')
    }
    const allowed = await this.invocations.allowedContracts()
    if (!allowed.has(input.tokenContract)) throw new BadRequestError('Token is not supported for session keys')
    if (await prisma.sessionKey.findUnique({ where: { publicKey: input.publicKey } })) {
      throw new ConflictError('Session key already registered')
    }

    const perTxLimit = toBaseUnits(input.perTxLimit)
    const totalLimit = toBaseUnits(input.totalLimit)
    const expiresAtLedger = await this.soroban.validUntilLedger(input.ttlSeconds)

    const key = await prisma.sessionKey.create({
      data: {
        userId,
        publicKey: input.publicKey,
        tokenContract: input.tokenContract,
        perTxLimit: perTxLimit.toString(),
        totalLimit: totalLimit.toString(),
        expiresAtLedger,
        expiresAt: new Date(Date.now() + input.ttlSeconds * 1000),
      },
    })

    const invocation = await this.invocations.prepare({
      userId,
      kind: 'session_key_register',
      signer: 'passkey',
      sessionKeyId: key.id,
      invocation: SmartWallet.addSessionKey(user.contractAddress, {
        publicKey: input.publicKey,
        token: input.tokenContract,
        perTxLimit,
        totalLimit,
        expiresAtLedger,
      }),
    })
    return { sessionKey: serializeSessionKey(key), invocation }
  }

  async list(userId: string) {
    const keys = await prisma.sessionKey.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } })
    return keys.map(serializeSessionKey)
  }

  /**
   * Stops the backend relaying for this key immediately and prepares the on-chain
   * `revoke_session_key` call for the user to sign with their passkey.
   */
  async revoke(userId: string, id: string) {
    const key = await prisma.sessionKey.findUnique({ where: { id } })
    if (!key || key.userId !== userId) throw new NotFoundError('Session key')
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    const wasRegistered = key.status === 'active'
    const updated = await prisma.sessionKey.update({ where: { id }, data: { status: 'revoked' } })

    const invocation =
      wasRegistered && user.contractAddress
        ? await this.invocations.prepare({
            userId,
            kind: 'session_key_revoke',
            signer: 'passkey',
            sessionKeyId: key.id,
            invocation: SmartWallet.revokeSessionKey(user.contractAddress, key.publicKey),
          })
        : null
    return { sessionKey: serializeSessionKey(updated), invocation }
  }
}

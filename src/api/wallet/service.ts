import { createHash } from 'node:crypto'

import { Prisma } from '@prisma/client'
import { Address, nativeToScVal, StrKey, xdr } from '@stellar/stellar-sdk'

import { prisma } from '../../config/database'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../errors'
import { AccountFactory, Token } from '../../interfaces/contracts/bindings'
import { Big, fromBaseUnits, toBaseUnits } from '../../lib/money'
import type { InvocationResult, SubmitInput } from './invocation-service'
import { InvocationService } from './invocation-service'

export type TypedArg =
  | { type: 'address'; value: string }
  | { type: 'i128' | 'u128' | 'i64' | 'u64'; value: string }
  | { type: 'u32' | 'i32'; value: number }
  | { type: 'bool'; value: boolean }
  | { type: 'symbol' | 'string'; value: string }
  | { type: 'bytes'; value: string }

export function toScVal(arg: TypedArg): xdr.ScVal {
  switch (arg.type) {
    case 'address':
      return new Address(arg.value).toScVal()
    case 'i128':
    case 'u128':
    case 'i64':
    case 'u64':
      return nativeToScVal(BigInt(arg.value), { type: arg.type })
    case 'u32':
      return xdr.ScVal.scvU32(arg.value)
    case 'i32':
      return xdr.ScVal.scvI32(arg.value)
    case 'bool':
      return xdr.ScVal.scvBool(arg.value)
    case 'symbol':
      return xdr.ScVal.scvSymbol(arg.value)
    case 'string':
      return xdr.ScVal.scvString(arg.value)
    case 'bytes':
      return xdr.ScVal.scvBytes(Buffer.from(arg.value, 'hex'))
  }
}

export class WalletService {
  constructor(private readonly invocations = InvocationService.getInstance()) {}

  /** Deterministic factory salt per user, so redeploys resolve to the same address. */
  static walletSalt(userId: string): Buffer {
    return createHash('sha256').update(`remitpulse-wallet:${userId}`).digest()
  }

  /**
   * Deploys the user's smart wallet through the ACCOUNT_CONTRACT_ID factory, binding
   * it to their passkey's P-256 public key. Fees are covered by the paymaster.
   */
  async deploy(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { passkeys: true } })
    if (user.contractAddress) return { contractAddress: user.contractAddress, txHash: null, alreadyDeployed: true }
    const passkey = user.passkeys[0]
    if (!passkey) throw new BadRequestError('Enroll a passkey before deploying a wallet', undefined, 'PASSKEY_REQUIRED')

    const prepared = await this.invocations.prepare({
      userId,
      kind: 'wallet_deploy',
      signer: 'none',
      invocation: AccountFactory.deploy(
        WalletService.walletSalt(userId),
        Buffer.from(passkey.credentialId, 'base64url'),
        Buffer.from(passkey.hexPublicKey, 'hex')
      ),
    })
    const result = await this.invocations.submit(userId, prepared.invocationId, { type: 'none' })
    const contractAddress = typeof result.returnValue === 'string' ? result.returnValue : null
    if (!contractAddress || !StrKey.isValidContract(contractAddress)) {
      throw new BadRequestError('Factory did not return a wallet address', { returnValue: result.returnValue })
    }

    try {
      await prisma.user.update({ where: { id: userId }, data: { contractAddress } })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Wallet address already bound to another user')
      }
      throw error
    }
    return { contractAddress, txHash: result.txHash, alreadyDeployed: false }
  }

  async prepareContractCall(userId: string, input: { contractId: string; method: string; args: TypedArg[] }) {
    return this.invocations.prepare({
      userId,
      kind: 'contract_call',
      signer: 'passkey',
      invocation: { contractId: input.contractId, method: input.method, args: input.args.map(toScVal) },
    })
  }

  /** Prepares a SEP-41 token transfer from the user's wallet, signed by passkey or a session key. */
  async preparePayment(
    userId: string,
    input: { token: string; to: string; amount: string; signer: 'passkey' | 'session_key'; sessionKeyId?: string }
  ) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    if (!user.contractAddress) throw new BadRequestError('Smart wallet not deployed yet', undefined, 'WALLET_NOT_DEPLOYED')
    const amount = toBaseUnits(input.amount)
    if (amount <= 0n) throw new BadRequestError('Amount must be greater than zero')

    if (input.signer === 'session_key') {
      if (!input.sessionKeyId) throw new BadRequestError('sessionKeyId is required for session-key payments')
      const key = await prisma.sessionKey.findUnique({ where: { id: input.sessionKeyId } })
      if (!key || key.userId !== userId) throw new NotFoundError('Session key')
      if (key.status !== 'active' || key.expiresAt < new Date()) {
        throw new ForbiddenError('Session key is not active', { status: key.status }, 'SESSION_KEY_INACTIVE')
      }
      if (key.tokenContract !== input.token)
        throw new ForbiddenError('Session key is not scoped to this token', undefined, 'SESSION_KEY_SCOPE')
      if (new Big(amount.toString()).gt(key.perTxLimit.toString())) {
        throw new ForbiddenError(
          'Amount exceeds session key per-transaction limit',
          { perTxLimit: fromBaseUnits(key.perTxLimit.toFixed(0)) },
          'SESSION_KEY_LIMIT'
        )
      }
      if (new Big(key.spent.toString()).plus(amount.toString()).gt(key.totalLimit.toString())) {
        throw new ForbiddenError('Amount exceeds session key remaining allowance', undefined, 'SESSION_KEY_LIMIT')
      }
    }

    return this.invocations.prepare({
      userId,
      kind: 'payment',
      signer: input.signer,
      sessionKeyId: input.sessionKeyId,
      invocation: Token.transfer(input.token, user.contractAddress, input.to, amount),
      metadata: { token: input.token, to: input.to, amount: amount.toString() },
    })
  }

  /** Submits any prepared invocation, applying kind-specific bookkeeping. */
  async submit(userId: string, invocationId: string, input: SubmitInput): Promise<InvocationResult> {
    const pending = await this.invocations.get(userId, invocationId)
    const metadata = (pending.metadata ?? {}) as Record<string, string>

    switch (pending.kind) {
      case 'session_key_register':
        return this.invocations.submit(userId, invocationId, input, {
          onSuccess: async txHash => {
            await prisma.sessionKey.update({ where: { id: pending.sessionKeyId! }, data: { status: 'active', registerTxHash: txHash } })
          },
        })
      case 'payment':
        if (pending.signer !== 'session_key') return this.invocations.submit(userId, invocationId, input)
        return this.invocations.submit(userId, invocationId, input, {
          reserve: () => reserveSessionSpend(pending.sessionKeyId!, BigInt(metadata.amount)),
        })
      case 'wallet_deploy':
        throw new BadRequestError('Wallet deployment is submitted by POST /v1/wallet/deploy')
      default:
        return this.invocations.submit(userId, invocationId, input)
    }
  }
}

/**
 * Atomically reserves `amount` against the session key's total allowance.
 * Returns a compensating action that releases the reservation.
 */
export async function reserveSessionSpend(sessionKeyId: string, amount: bigint): Promise<() => Promise<void>> {
  const updated = await prisma.$executeRaw`
    UPDATE session_keys
       SET spent = spent + ${amount.toString()}::numeric, updated_at = now()
     WHERE id = ${sessionKeyId}::uuid
       AND status = 'active'
       AND expires_at > now()
       AND spent + ${amount.toString()}::numeric <= total_limit
       AND ${amount.toString()}::numeric <= per_tx_limit`
  if (updated === 0) throw new ForbiddenError('Session key allowance exceeded or key inactive', undefined, 'SESSION_KEY_LIMIT')
  return async () => {
    await prisma.$executeRaw`
      UPDATE session_keys SET spent = spent - ${amount.toString()}::numeric, updated_at = now()
       WHERE id = ${sessionKeyId}::uuid`
  }
}

import type { Operation, Transaction } from '@stellar/stellar-sdk'
import { Address, FeeBumpTransaction, scValToBigInt, TransactionBuilder, xdr } from '@stellar/stellar-sdk'

import { prisma } from '../../config/database'
import { env } from '../../config/env'
import { logger } from '../../config/logger'
import { STELLAR } from '../../config/stellar'
import { BadRequestError, ForbiddenError, TooManyRequestsError } from '../../errors'
import { Subsidy } from '../contracts/bindings'
import type { SubmittedTransaction } from '../soroban'
import { SorobanService } from '../soroban'

export type SponsorContext = {
  userId?: string
  /** Smart wallet / account that benefits from the sponsorship (checked against the subsidy contract). */
  beneficiary?: string
  /** Contracts the inner transaction may invoke. */
  allowedContracts: Set<string>
}

export type SponsorResult = SubmittedTransaction & {
  innerHash: string
  feeBumpHash: string
  maxFee: string
}

const DAY_MS = 24 * 3600 * 1000

/**
 * Paymaster: wraps user (or relayer) transactions in a fee-bump envelope signed by
 * the PAYMASTER key so end users never need XLM.
 *
 * Every sponsorship is checked against a policy before signing:
 *   - single InvokeHostFunction operation targeting an allow-listed contract
 *   - inner fee and fee-bump max fee below PAYMASTER_MAX_FEE_STROOPS
 *   - the paymaster account is never the inner source or an operation source
 *   - per-user rolling 24h budget (PAYMASTER_DAILY_BUDGET_STROOPS)
 *   - optionally, an on-chain allowance in SUBSIDY_CONTRACT_ID
 */
export class Paymaster {
  private static instance?: Paymaster

  constructor(private readonly soroban: SorobanService = SorobanService.getInstance()) {}

  static getInstance(): Paymaster {
    Paymaster.instance ??= new Paymaster()
    return Paymaster.instance
  }

  get publicKey(): string {
    return STELLAR.paymaster.publicKey()
  }

  /** Validates the inner transaction against the sponsorship policy. Throws on violation. */
  assertSponsorable(inner: Transaction | FeeBumpTransaction, allowedContracts: Set<string>): asserts inner is Transaction {
    if (inner instanceof FeeBumpTransaction) {
      throw new BadRequestError('Transaction is already fee-bumped', undefined, 'POLICY_VIOLATION')
    }
    if (inner.networkPassphrase !== STELLAR.networkPassphrase) {
      throw new BadRequestError('Transaction is for a different network', undefined, 'POLICY_VIOLATION')
    }
    if (inner.source === this.publicKey) {
      throw new ForbiddenError('Paymaster cannot be the inner transaction source', undefined, 'POLICY_VIOLATION')
    }
    if (inner.operations.length !== 1 || inner.operations[0].type !== 'invokeHostFunction') {
      throw new BadRequestError('Only single InvokeHostFunction transactions are sponsored', undefined, 'POLICY_VIOLATION')
    }

    const op = inner.operations[0] as Operation.InvokeHostFunction
    if (op.source && op.source === this.publicKey) {
      throw new ForbiddenError('Paymaster cannot be an operation source', undefined, 'POLICY_VIOLATION')
    }
    if (op.func.switch().value !== xdr.HostFunctionType.hostFunctionTypeInvokeContract().value) {
      throw new BadRequestError('Only contract invocations are sponsored', undefined, 'POLICY_VIOLATION')
    }
    const target = Address.fromScAddress(op.func.invokeContract().contractAddress()).toString()
    if (!allowedContracts.has(target)) {
      throw new ForbiddenError(`Contract ${target} is not eligible for sponsorship`, { contractId: target }, 'POLICY_VIOLATION')
    }
    if (BigInt(inner.fee) > BigInt(env.PAYMASTER_MAX_FEE_STROOPS)) {
      throw new BadRequestError(
        'Inner transaction fee exceeds sponsorship cap',
        {
          fee: inner.fee,
          cap: env.PAYMASTER_MAX_FEE_STROOPS,
        },
        'POLICY_VIOLATION'
      )
    }
    if (inner.signatures.length === 0) {
      throw new BadRequestError('Inner transaction must be signed by its source', undefined, 'POLICY_VIOLATION')
    }
  }

  /** Wraps `inner` in a fee-bump signed by the paymaster. */
  wrap(inner: Transaction): FeeBumpTransaction {
    // Fee-bump total = baseFee * (ops + 1); use the inner fee as the per-op bid so the
    // envelope always covers the inner resource fee. The network only charges what is used.
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(STELLAR.paymaster, inner.fee, inner, STELLAR.networkPassphrase)
    if (BigInt(feeBump.fee) > BigInt(env.PAYMASTER_MAX_FEE_STROOPS) * 2n) {
      throw new BadRequestError('Fee-bump fee exceeds sponsorship cap', { fee: feeBump.fee }, 'POLICY_VIOLATION')
    }
    feeBump.sign(STELLAR.paymaster)
    return feeBump
  }

  /** Applies policy, budget and subsidy checks, then fee-bumps and submits `inner`. */
  async sponsor(inner: Transaction | FeeBumpTransaction, ctx: SponsorContext): Promise<SponsorResult> {
    this.assertSponsorable(inner, ctx.allowedContracts)
    await this.assertBudget(ctx.userId, BigInt(inner.fee))
    if (env.PAYMASTER_ENFORCE_SUBSIDY && ctx.beneficiary) await this.assertSubsidy(ctx.beneficiary, BigInt(inner.fee))

    const feeBump = this.wrap(inner)
    const innerHash = inner.hash().toString('hex')
    const feeBumpHash = feeBump.hash().toString('hex')
    const op = inner.operations[0] as Operation.InvokeHostFunction
    const invoke = op.func.invokeContract()

    const record = await prisma.sponsoredTransaction.create({
      data: {
        userId: ctx.userId,
        innerHash,
        feeBumpHash,
        maxFee: BigInt(feeBump.fee),
        contractId: Address.fromScAddress(invoke.contractAddress()).toString(),
        method: invoke.functionName().toString(),
      },
    })

    try {
      const result = await this.soroban.send(feeBump)
      await prisma.sponsoredTransaction.update({
        where: { id: record.id },
        data: { status: 'succeeded', feeCharged: result.feeCharged },
      })
      logger.info({ feeBumpHash, feeCharged: result.feeCharged?.toString() }, 'Paymaster | sponsored transaction applied')
      return { ...result, innerHash, feeBumpHash, maxFee: feeBump.fee }
    } catch (error) {
      await prisma.sponsoredTransaction.update({
        where: { id: record.id },
        data: { status: 'failed', error: (error as Error).message },
      })
      throw error
    }
  }

  /** Rolling 24h spend per user: actual fee when known, otherwise the authorised max. */
  async spentLast24h(userId: string): Promise<bigint> {
    const rows = await prisma.sponsoredTransaction.findMany({
      where: { userId, createdAt: { gte: new Date(Date.now() - DAY_MS) }, status: { not: 'failed' } },
      select: { feeCharged: true, maxFee: true },
    })
    return rows.reduce((total, row) => total + (row.feeCharged ?? row.maxFee), 0n)
  }

  private async assertBudget(userId: string | undefined, fee: bigint): Promise<void> {
    if (!userId) return
    const spent = await this.spentLast24h(userId)
    const budget = BigInt(env.PAYMASTER_DAILY_BUDGET_STROOPS)
    if (spent + fee * 2n > budget) {
      throw new TooManyRequestsError('Daily sponsorship budget exhausted', {
        spent: spent.toString(),
        budget: budget.toString(),
      })
    }
  }

  private async assertSubsidy(account: string, fee: bigint): Promise<void> {
    const allowance = scValToBigInt(await this.soroban.read(Subsidy.allowance(account)))
    if (allowance < fee) {
      throw new ForbiddenError(
        'Insufficient fee subsidy allowance',
        {
          allowance: allowance.toString(),
          required: fee.toString(),
        },
        'SUBSIDY_EXHAUSTED'
      )
    }
  }
}

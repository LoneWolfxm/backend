import { prisma } from '../../config/database'
import { env } from '../../config/env'
import { Paymaster } from '../../interfaces/paymaster'
import { SorobanService } from '../../interfaces/soroban'
import { z } from '../../lib/zod'
import { ApiRouter } from '../core/router'
import { InvocationService } from '../wallet/invocation-service'

export const paymasterRouter = new ApiRouter('/v1/paymaster')

paymasterRouter.get({
  path: '/status',
  summary: 'Sponsorship policy and remaining budget',
  tags: ['Paymaster'],
  auth: 'user',
  response: z.object({
    sponsor: z.string(),
    maxFeePerTx: z.string(),
    dailyBudget: z.string(),
    spentLast24h: z.string(),
    remaining: z.string(),
    subsidyEnforced: z.boolean(),
  }),
  handler: async ({ auth }) => {
    const spent = await Paymaster.getInstance().spentLast24h(auth.userId)
    const budget = BigInt(env.PAYMASTER_DAILY_BUDGET_STROOPS)
    return {
      sponsor: Paymaster.getInstance().publicKey,
      maxFeePerTx: String(env.PAYMASTER_MAX_FEE_STROOPS),
      dailyBudget: budget.toString(),
      spentLast24h: spent.toString(),
      remaining: (budget > spent ? budget - spent : 0n).toString(),
      subsidyEnforced: env.PAYMASTER_ENFORCE_SUBSIDY,
    }
  },
})

paymasterRouter.post({
  path: '/fee-bump',
  summary: 'Sponsor a client-signed transaction',
  description:
    'Accepts a fully signed inner transaction (e.g. built and signed by a session-key G-account or another ' +
    'client), validates it against the sponsorship policy, wraps it in a fee-bump signed by the paymaster ' +
    'and submits it. Only single InvokeHostFunction operations on allow-listed contracts are accepted.',
  tags: ['Paymaster'],
  auth: 'user',
  sensitive: true,
  body: z.object({ transactionXdr: z.string().min(1).max(100_000).openapi({ description: 'Signed inner transaction, base64 XDR' }) }),
  response: z.object({
    innerHash: z.string(),
    feeBumpHash: z.string(),
    maxFee: z.string(),
    feeCharged: z.string().nullable(),
    ledger: z.number().int(),
  }),
  errors: { 403: 'Policy violation', 429: 'Daily sponsorship budget exhausted', 502: 'Network rejected the transaction' },
  handler: async ({ auth, body }) => {
    const inner = SorobanService.getInstance().parseTransaction(body.transactionXdr)
    const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.userId } })
    const allowed = await InvocationService.getInstance().allowedContracts(user.contractAddress)
    const result = await Paymaster.getInstance().sponsor(inner, {
      userId: auth.userId,
      beneficiary: user.contractAddress ?? undefined,
      allowedContracts: allowed,
    })
    return {
      innerHash: result.innerHash,
      feeBumpHash: result.feeBumpHash,
      maxFee: result.maxFee,
      feeCharged: result.feeCharged?.toString() ?? null,
      ledger: result.ledger,
    }
  },
})

import type { Corridor } from '@prisma/client'
import { Asset } from '@stellar/stellar-sdk'

import { prisma } from '../../config/database'
import { STELLAR } from '../../config/stellar'
import { NotFoundError } from '../../errors'

let tokenCache: { at: number; contracts: string[] } | undefined
const TOKEN_CACHE_MS = 60_000

/** Stellar Asset Contract address of the corridor asset. */
export function corridorTokenContract(corridor: Pick<Corridor, 'assetCode' | 'assetIssuer'>): string {
  return new Asset(corridor.assetCode, corridor.assetIssuer).contractId(STELLAR.networkPassphrase)
}

/** SAC addresses of every active corridor asset (cached), used for relay/paymaster allow-lists. */
export async function corridorTokenContracts(): Promise<string[]> {
  if (tokenCache && Date.now() - tokenCache.at < TOKEN_CACHE_MS) return tokenCache.contracts
  const corridors = await prisma.corridor.findMany({ where: { isActive: true } })
  tokenCache = { at: Date.now(), contracts: corridors.map(corridorTokenContract) }
  return tokenCache.contracts
}

export function invalidateCorridorCache(): void {
  tokenCache = undefined
}

export async function getCorridor(code: string, { activeOnly = true } = {}): Promise<Corridor> {
  const corridor = await prisma.corridor.findUnique({ where: { code: code.toUpperCase() } })
  if (!corridor || (activeOnly && !corridor.isActive)) throw new NotFoundError(`Corridor ${code}`)
  return corridor
}

export function serializeCorridor(corridor: Corridor) {
  return {
    code: corridor.code,
    name: corridor.name,
    asset: { code: corridor.assetCode, issuer: corridor.assetIssuer, contractId: corridorTokenContract(corridor) },
    fiatCurrency: corridor.fiatCurrency,
    anchorDomain: corridor.anchorDomain,
    markupBps: corridor.markupBps,
    fixedFee: corridor.fixedFee.toFixed(7),
    minAmount: corridor.minAmount.toFixed(7),
    maxAmount: corridor.maxAmount?.toFixed(7) ?? null,
    isActive: corridor.isActive,
  }
}

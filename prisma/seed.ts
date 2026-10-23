import { Keypair } from '@stellar/stellar-sdk'

import { prisma } from '../src/config/database'

/**
 * Seeds the four regional remittance corridors. `assetIssuer` here is a randomly generated,
 * unfunded placeholder — replace it (via PATCH /v1/admin/corridors/:code or by editing this
 * file) with the real anchor-issued asset issuer before connecting to a live anchor.
 */
const CORRIDORS = [
  { code: 'USDC', name: 'US Dollar (USDC)', assetCode: 'USDC', fiatCurrency: 'USD', anchorDomain: 'testanchor.stellar.org', markupBps: 25, fixedFee: '0.50' },
  { code: 'EURC', name: 'Euro (EURC)', assetCode: 'EURC', fiatCurrency: 'EUR', anchorDomain: 'testanchor.stellar.org', markupBps: 30, fixedFee: '0.50' },
  { code: 'ARST', name: 'Argentine Peso (ARST)', assetCode: 'ARST', fiatCurrency: 'ARS', anchorDomain: 'testanchor.stellar.org', markupBps: 75, fixedFee: '50' },
  { code: 'BRLA', name: 'Brazilian Real (BRLA)', assetCode: 'BRLA', fiatCurrency: 'BRL', anchorDomain: 'testanchor.stellar.org', markupBps: 60, fixedFee: '2.00' },
]

async function main() {
  for (const corridor of CORRIDORS) {
    await prisma.corridor.upsert({
      where: { code: corridor.code },
      create: { ...corridor, assetIssuer: Keypair.random().publicKey() },
      update: { name: corridor.name, fiatCurrency: corridor.fiatCurrency, anchorDomain: corridor.anchorDomain },
    })
    console.log(`Seeded corridor ${corridor.code}`)
  }
  console.log('\nPlaceholder asset issuers were generated for each corridor. Replace them with your real anchor-issued ' +
    'asset issuer via PATCH /v1/admin/corridors/:code before going live.')
}

main()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

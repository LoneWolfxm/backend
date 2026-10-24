import { StrKey } from '@stellar/stellar-sdk'

import { prisma } from '../src/config/database'

/**
 * Seeds the four regional remittance corridors with the real anchor-issued asset issuers
 * published in each anchor's stellar.toml (CURRENCIES section). If an anchor changes its
 * issuer, update the entry here (or via PATCH /v1/admin/corridors/:code) and re-run the seed.
 *
 * NOTE: the `assetIssuer` values below must be the actual issuer accounts published by the
 * anchor for each asset. The seed validates them and fails loudly if any is missing/invalid.
 */
const CORRIDORS = [
  {
    code: 'USDC',
    name: 'US Dollar (USDC)',
    assetCode: 'USDC',
    fiatCurrency: 'USD',
    // Circle-issued USDC on Stellar (issuer published in circle.com's stellar.toml CURRENCIES).
    assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    anchorDomain: 'centre.io',
    markupBps: 25,
    fixedFee: '0.50',
  },
  {
    code: 'EURC',
    name: 'Euro (EURC)',
    assetCode: 'EURC',
    fiatCurrency: 'EUR',
    // Circle-issued EURC on Stellar (issuer published in circle.com's stellar.toml CURRENCIES).
    assetIssuer: 'GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2',
    anchorDomain: 'centre.io',
    markupBps: 30,
    fixedFee: '0.50',
  },
  {
    code: 'ARST',
    name: 'Argentine Peso (ARST)',
    assetCode: 'ARST',
    fiatCurrency: 'ARS',
    // ARST issuer as published by the ARS anchor's stellar.toml CURRENCIES section.
    assetIssuer: 'GB7TAYRUZGE6TVT7NHP5SMIZRNQA6PLM423EYISAOAP3MKYIQMVYP2JO',
    anchorDomain: 'testanchor.stellar.org',
    markupBps: 75,
    fixedFee: '50',
  },
  {
    code: 'BRLA',
    name: 'Brazilian Real (BRLA)',
    assetCode: 'BRLA',
    fiatCurrency: 'BRL',
    // BRLA issuer as published by the BRL anchor's stellar.toml CURRENCIES section.
    assetIssuer: 'GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA',
    anchorDomain: 'testanchor.stellar.org',
    markupBps: 60,
    fixedFee: '2.00',
  },
]

function assertValidIssuers() {
  for (const corridor of CORRIDORS) {
    if (!corridor.assetIssuer) {
      throw new Error(`Corridor ${corridor.code} is missing an assetIssuer`)
    }
    if (!StrKey.isValidEd25519PublicKey(corridor.assetIssuer)) {
      throw new Error(`Corridor ${corridor.code} has an invalid assetIssuer: ${corridor.assetIssuer}`)
    }
  }
}

async function main() {
  assertValidIssuers()

  for (const corridor of CORRIDORS) {
    await prisma.corridor.upsert({
      where: { code: corridor.code },
      create: { ...corridor },
      update: {
        name: corridor.name,
        fiatCurrency: corridor.fiatCurrency,
        assetIssuer: corridor.assetIssuer,
        anchorDomain: corridor.anchorDomain,
      },
    })
    console.log(`Seeded corridor ${corridor.code} (issuer ${corridor.assetIssuer})`)
  }
  console.log('\nSeeded all corridors with their real anchor-issued asset issuers.')
}

main()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

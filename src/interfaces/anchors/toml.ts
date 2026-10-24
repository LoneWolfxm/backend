import { env } from '../../config/env'
import { UpstreamError } from '../../errors'

export type AnchorCurrency = {
  code: string
  issuer: string
  status?: string
  display?: string
}

export type AnchorToml = {
  signingKey?: string
  webAuthEndpoint?: string
  /** SEP-45: contract account web auth endpoint (distinct from the classic SEP-10 endpoint). */
  webAuthContractEndpoint?: string
  /** SEP-45: the contract ID the anchor's web auth server accepts authorization entries for. */
  webAuthContractId?: string
  transferServerSep24?: string
  quoteServer?: string
  currencies: AnchorCurrency[]
}

let cache = new Map<string, { at: number; toml: AnchorToml }>()
const TOML_CACHE_MS = 5 * 60_000

/**
 * Minimal SEP-1 (stellar.toml) reader: extracts the handful of top-level `KEY = "value"`
 * fields the anchor integration needs, plus the `[[CURRENCIES]]` array entries.
 * Intentionally not a general TOML parser.
 */
function parseToml(text: string): AnchorToml {
  const get = (key: string): string | undefined => {
    const match = text.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm'))
    return match?.[1]
  }
  return {
    signingKey: get('SIGNING_KEY'),
    webAuthEndpoint: get('WEB_AUTH_ENDPOINT'),
    webAuthContractEndpoint: get('WEB_AUTH_CONTRACT_ENDPOINT'),
    webAuthContractId: get('WEB_AUTH_CONTRACT_ID'),
    transferServerSep24: get('TRANSFER_SERVER_SEP0024'),
    quoteServer: get('ANCHOR_QUOTE_SERVER'),
    currencies: parseCurrencies(text),
  }
}

/**
 * Parses the `[[CURRENCIES]]` array-of-tables blocks, returning each entry's `code` and
 * `issuer` (plus `status`/`display` when present). Entries missing a code or issuer are skipped.
 */
function parseCurrencies(text: string): AnchorCurrency[] {
  const currencies: AnchorCurrency[] = []
  const blocks = text.split(/^\s*\[\[CURRENCIES\]\]\s*$/m).slice(1)
  for (const block of blocks) {
    // Only consider lines up to the next table header so we don't bleed into following sections.
    const body = block.split(/^\s*\[/m)[0] ?? ''
    const field = (key: string): string | undefined => {
      const match = body.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm'))
      return match?.[1]
    }
    const code = field('code')
    const issuer = field('issuer')
    if (!code || !issuer) continue
    const currency: AnchorCurrency = { code, issuer }
    const status = field('status')
    if (status) currency.status = status
    const display = field('display')
    if (display) currency.display = display
    currencies.push(currency)
  }
  return currencies
}

/** Fetches and caches `https://{domain}/.well-known/stellar.toml` (SEP-1). */
export async function getAnchorToml(domain: string): Promise<AnchorToml> {
  const cached = cache.get(domain)
  if (cached && Date.now() - cached.at < TOML_CACHE_MS) return cached.toml

  const protocol = env.ANCHOR_ALLOW_HTTP ? 'http' : 'https'
  const url = `${protocol}://${domain}/.well-known/stellar.toml`
  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(env.ANCHOR_REQUEST_TIMEOUT_MS) })
  } catch (error) {
    throw new UpstreamError('anchor', `failed to fetch stellar.toml from ${domain}`, { cause: (error as Error).message })
  }
  if (!response.ok) throw new UpstreamError('anchor', `stellar.toml from ${domain} returned HTTP ${response.status}`)

  const toml = parseToml(await response.text())
  cache.set(domain, { at: Date.now(), toml })
  return toml
}

export function invalidateAnchorTomlCache(): void {
  cache = new Map()
}

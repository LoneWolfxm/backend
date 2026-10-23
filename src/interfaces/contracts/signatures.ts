/**
 * secp256r1 (P-256) helpers for turning WebAuthn assertions into the compact
 * signatures Soroban's `secp256r1_verify` host function expects.
 */

const P256_N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551')
const P256_HALF_N = P256_N / 2n

function readDerInteger(der: Buffer, offset: number): { value: Buffer; next: number } {
  if (der[offset] !== 0x02) throw new Error('invalid DER signature: expected INTEGER')
  const length = der[offset + 1]
  const start = offset + 2
  return { value: der.subarray(start, start + length), next: start + length }
}

function toFixed32(value: bigint): Buffer {
  const hex = value.toString(16).padStart(64, '0')
  if (hex.length > 64) throw new Error('signature component exceeds 32 bytes')
  return Buffer.from(hex, 'hex')
}

/**
 * Converts an ASN.1 DER ECDSA signature (what WebAuthn returns) into 64-byte r||s,
 * normalising s to the low half of the curve order as required by Soroban.
 */
export function derToCompactP256(der: Buffer): Buffer {
  if (der.length === 64) return normaliseCompact(der)
  if (der[0] !== 0x30) throw new Error('invalid DER signature: expected SEQUENCE')
  // Skip SEQUENCE header (short-form length; P-256 signatures are always < 128 bytes)
  const r = readDerInteger(der, 2)
  const s = readDerInteger(der, r.next)
  return normaliseCompact(
    Buffer.concat([toFixed32(BigInt(`0x${r.value.toString('hex')}`)), toFixed32(BigInt(`0x${s.value.toString('hex')}`))])
  )
}

function normaliseCompact(compact: Buffer): Buffer {
  const r = compact.subarray(0, 32)
  let s = BigInt(`0x${compact.subarray(32).toString('hex')}`)
  if (s > P256_HALF_N) s = P256_N - s
  return Buffer.concat([r, toFixed32(s)])
}

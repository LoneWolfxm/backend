import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
import { StrKey } from '@stellar/stellar-sdk'
import { z } from 'zod'

import { DecimalString } from './money'

extendZodWithOpenApi(z)

export { z }

export const zAccountId = z
  .string()
  .refine(StrKey.isValidEd25519PublicKey, 'must be a Stellar account (G...)')
  .openapi({ example: 'GCUZ37M45SEMGYFYYZE7IBTS3ISKGPDLFRNHS73ORSTMNYM64NLEQO76' })

export const zContractId = z
  .string()
  .refine(StrKey.isValidContract, 'must be a contract address (C...)')
  .openapi({ example: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC' })

export const zAddress = z
  .string()
  .refine(v => StrKey.isValidEd25519PublicKey(v) || StrKey.isValidContract(v), 'must be a G... or C... address')

export const zAmount = z
  .string()
  .regex(DecimalString, 'must be a positive decimal with at most 7 decimal places')
  .openapi({ example: '100.00' })

export const zUuid = z.uuid()
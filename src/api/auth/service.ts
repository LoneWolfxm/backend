import type { Passkey, User } from '@prisma/client'
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'

import { prisma } from '../../config/database'
import { ConflictError, NotFoundError, UnauthorizedError } from '../../errors'
import { WebAuthnService } from '../../interfaces/webauthn'
import { signUserToken } from '../core/middlewares/authentication'

export type UserWithPasskeys = User & { passkeys: Passkey[] }

export function serializeUser(user: UserWithPasskeys) {
  return {
    id: user.id,
    email: user.email,
    contractAddress: user.contractAddress,
    passkeys: user.passkeys.map(passkey => ({
      credentialId: passkey.credentialId,
      label: passkey.label,
      createdAt: passkey.createdAt.toISOString(),
    })),
  }
}

export class AuthService {
  constructor(private readonly webauthn = WebAuthnService.getInstance()) {}

  async registrationOptions(email: string) {
    const existing = await prisma.user.findUnique({ where: { email }, include: { passkeys: true } })
    if (existing?.passkeys.length) throw new ConflictError('An account with this email already has a passkey; log in instead')
    return this.webauthn.registrationOptions(email)
  }

  async register(email: string, response: RegistrationResponseJSON, label?: string) {
    const credential = await this.webauthn.verifyRegistration(email, response)

    const user = await prisma.$transaction(async tx => {
      const existing = await tx.user.findUnique({ where: { email }, include: { passkeys: true } })
      if (existing?.passkeys.length) throw new ConflictError('An account with this email already has a passkey')
      const owner = existing ?? (await tx.user.create({ data: { email } }))
      await tx.passkey.create({
        data: {
          userId: owner.id,
          credentialId: credential.credentialId,
          credentialPublicKey: Buffer.from(credential.credentialPublicKey),
          hexPublicKey: credential.hexPublicKey,
          counter: BigInt(credential.counter),
          transports: credential.transports,
          deviceType: credential.deviceType,
          backedUp: credential.backedUp,
          label: label ?? null,
        },
      })
      return tx.user.findUniqueOrThrow({ where: { id: owner.id }, include: { passkeys: true } })
    })

    return { token: signUserToken({ userId: user.id, email: user.email }), user: serializeUser(user) }
  }

  async loginOptions(email: string) {
    const user = await prisma.user.findUnique({ where: { email }, include: { passkeys: true } })
    // Do not reveal whether the account exists: issue options with no allowCredentials
    return this.webauthn.authenticationOptions(email, user?.passkeys ?? [])
  }

  async login(email: string, response: AuthenticationResponseJSON) {
    const user = await prisma.user.findUnique({ where: { email }, include: { passkeys: true } })
    const passkey = user?.passkeys.find(candidate => candidate.credentialId === response.id)
    if (!user || !passkey) throw new UnauthorizedError('Unknown passkey')
    await this.webauthn.verifyLogin(email, passkey, response)
    return { token: signUserToken({ userId: user.id, email: user.email }), user: serializeUser(user) }
  }

  async me(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { passkeys: true } })
    if (!user) throw new NotFoundError('User')
    return serializeUser(user)
  }
}

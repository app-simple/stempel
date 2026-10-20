import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { Clock } from '../common/clock';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { canLogIn } from './login-eligibility';
import { CHALLENGE_TTL_MS } from './session-cookie';
import { SessionService } from './session.service';

export const PASSKEY_LOGIN_FAILED = 'Anmeldung mit Passkey fehlgeschlagen.';

export interface PasskeyView {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  backedUp: boolean;
}

/** Passkeys nach Konzept 5.1: Registrierung nur angemeldet, Anmeldung ohne Eingabe der E-Mail. */
@Injectable()
export class PasskeyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private expiresAt(): Date {
    return new Date(this.clock.now().getTime() + CHALLENGE_TTL_MS);
  }

  async registrationOptions(user: AuthUser): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const employee = await this.prisma.employee.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        id: true,
        name: true,
        loginEmail: true,
        passkeys: { select: { credentialId: true, transports: true } },
      },
    });
    const options = await generateRegistrationOptions({
      rpName: this.config.webauthn.rpName,
      rpID: this.config.webauthn.rpId,
      userID: new TextEncoder().encode(employee.id),
      userName: employee.loginEmail,
      userDisplayName: employee.name,
      attestationType: 'none',
      excludeCredentials: employee.passkeys.map((p) => ({
        id: p.credentialId,
        transports: p.transports,
      })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    await this.prisma.$transaction([
      this.prisma.authChallenge.deleteMany({
        where: { employeeId: user.id, purpose: 'PASSKEY_REGISTRATION' },
      }),
      this.prisma.authChallenge.create({
        data: {
          challenge: options.challenge,
          purpose: 'PASSKEY_REGISTRATION',
          employeeId: user.id,
          expiresAt: this.expiresAt(),
        },
      }),
    ]);
    return options;
  }

  async verifyRegistration(
    user: AuthUser,
    response: RegistrationResponseJSON,
    name: string,
  ): Promise<PasskeyView> {
    const challenge = await this.prisma.authChallenge.findFirst({
      where: { employeeId: user.id, purpose: 'PASSKEY_REGISTRATION' },
      orderBy: { expiresAt: 'desc' },
    });
    // Atomar beanspruchen: Nur die Anfrage, die die Challenge tatsächlich löscht, darf weiterprüfen.
    const claimed = challenge
      ? await this.prisma.authChallenge.deleteMany({ where: { id: challenge.id } })
      : { count: 0 };
    if (!challenge || claimed.count !== 1 || challenge.expiresAt <= this.clock.now()) {
      throw new BadRequestException('Die Anfrage ist abgelaufen. Bitte erneut versuchen.');
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: this.config.webauthn.origin,
        expectedRPID: this.config.webauthn.rpId,
        requireUserVerification: false,
      });
    } catch {
      throw new BadRequestException('Der Passkey konnte nicht geprüft werden.');
    }
    if (!verification.verified)
      throw new BadRequestException('Der Passkey konnte nicht geprüft werden.');

    const info = verification.registrationInfo;
    const passkey = await this.prisma.passkey
      .create({
        data: {
          employeeId: user.id,
          credentialId: info.credential.id,
          publicKey: Buffer.from(info.credential.publicKey),
          counter: BigInt(info.credential.counter),
          transports: info.credential.transports ?? [],
          deviceType: info.credentialDeviceType,
          backedUp: info.credentialBackedUp,
          name,
        },
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('Dieser Passkey ist bereits registriert.');
        }
        throw error;
      });
    await this.audit.record({
      action: 'passkey.create',
      actorId: user.id,
      entityType: 'Passkey',
      entityId: passkey.id,
    });
    return toView(passkey);
  }

  /** Optionen ohne allowCredentials: der Browser bietet alle Passkeys für diese Seite an. */
  async loginOptions(): Promise<{
    challengeId: string;
    options: PublicKeyCredentialRequestOptionsJSON;
  }> {
    const options = await generateAuthenticationOptions({
      rpID: this.config.webauthn.rpId,
      userVerification: 'preferred',
    });
    const challenge = await this.prisma.authChallenge.create({
      data: { challenge: options.challenge, purpose: 'PASSKEY_LOGIN', expiresAt: this.expiresAt() },
    });
    return { challengeId: challenge.id, options };
  }

  async verifyLogin(
    challengeId: string | undefined,
    response: AuthenticationResponseJSON,
  ): Promise<string> {
    const fail = (): never => {
      throw new UnauthorizedException(PASSKEY_LOGIN_FAILED);
    };
    if (!challengeId || !/^[0-9a-f-]{36}$/.test(challengeId)) return fail();

    // Challenge atomar beanspruchen: einmal verwendbar, auch bei parallelen Anfragen.
    const challenge = await this.prisma.authChallenge.findFirst({
      where: { id: challengeId, purpose: 'PASSKEY_LOGIN' },
    });
    if (!challenge) return fail();
    const claimed = await this.prisma.authChallenge.deleteMany({ where: { id: challenge.id } });
    if (claimed.count !== 1 || challenge.expiresAt <= this.clock.now()) return fail();

    const passkey = await this.prisma.passkey.findUnique({
      where: { credentialId: response.id },
      include: { employee: { select: { id: true, lockedAt: true, exitDate: true } } },
    });
    if (!passkey || !canLogIn(passkey.employee, this.clock.today())) return fail();

    // Anmeldung ohne vorher bekannte Person: userHandle ist Pflicht und muss zum Passkey gehören
    // (WebAuthn Level 3, § 7.2).
    const userHandle = response.response.userHandle;
    if (!userHandle || !/^[A-Za-z0-9_-]+$/.test(userHandle)) return fail();
    if (Buffer.from(userHandle, 'base64url').toString('utf8') !== passkey.employeeId) return fail();

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: this.config.webauthn.origin,
        expectedRPID: this.config.webauthn.rpId,
        credential: {
          id: passkey.credentialId,
          publicKey: new Uint8Array(passkey.publicKey),
          counter: Number(passkey.counter),
          transports: passkey.transports as AuthenticatorTransport[],
        },
        requireUserVerification: false,
      });
    } catch {
      return fail();
    }
    if (!verification.verified) return fail();

    // Zähler nur fortschreiben, wenn ihn keine parallele Anmeldung inzwischen verändert hat.
    const updated = await this.prisma.passkey.updateMany({
      where: { id: passkey.id, counter: passkey.counter },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter),
        lastUsedAt: this.clock.now(),
      },
    });
    if (updated.count !== 1) return fail();
    return this.sessions.create(passkey.employeeId, 'PASSKEY');
  }

  async list(user: AuthUser): Promise<PasskeyView[]> {
    const passkeys = await this.prisma.passkey.findMany({
      where: { employeeId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    return passkeys.map(toView);
  }

  /** Nur eigene Passkeys; fremde ergeben 404. */
  async rename(user: AuthUser, id: string, name: string): Promise<PasskeyView> {
    const { count } = await this.prisma.passkey.updateMany({
      where: { id, employeeId: user.id },
      data: { name },
    });
    if (count !== 1) throw new NotFoundException('Passkey nicht gefunden.');
    await this.audit.record({
      action: 'passkey.rename',
      actorId: user.id,
      entityType: 'Passkey',
      entityId: id,
    });
    return toView(await this.prisma.passkey.findUniqueOrThrow({ where: { id } }));
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    const { count } = await this.prisma.passkey.deleteMany({ where: { id, employeeId: user.id } });
    if (count !== 1) throw new NotFoundException('Passkey nicht gefunden.');
    await this.audit.record({
      action: 'passkey.delete',
      actorId: user.id,
      entityType: 'Passkey',
      entityId: id,
    });
  }
}

function toView(p: {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  backedUp: boolean;
}): PasskeyView {
  return {
    id: p.id,
    name: p.name,
    createdAt: p.createdAt.toISOString(),
    lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
    backedUp: p.backedUp,
  };
}

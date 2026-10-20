import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

interface StoredCredential {
  id: Buffer;
  privateKey: KeyObject;
  userHandle: string;
  counter: number;
}

const b64url = (data: Buffer | Uint8Array): string => Buffer.from(data).toString('base64url');
const sha256 = (data: Buffer | string): Buffer => createHash('sha256').update(data).digest();

/**
 * Software-Authenticator für Tests: erzeugt echte, signierte WebAuthn-Antworten (ES256, Attestation „none“)
 * mit auffindbaren Zugangsdaten, wie ein Plattform-Authenticator.
 */
export class SoftAuthenticator {
  readonly credentials: StoredCredential[] = [];

  constructor(
    private readonly rpId: string,
    private readonly origin: string,
  ) {}

  private authData(flags: number, counter: number, attested?: Buffer, rpId = this.rpId): Buffer {
    const header = Buffer.alloc(37);
    sha256(rpId).copy(header, 0);
    header.writeUInt8(flags, 32);
    header.writeUInt32BE(counter, 33);
    return attested ? Buffer.concat([header, attested]) : header;
  }

  register(
    options: PublicKeyCredentialCreationOptionsJSON,
    origin = this.origin,
  ): RegistrationResponseJSON {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const cose = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x ?? '', 'base64url')],
        [-3, Buffer.from(jwk.y ?? '', 'base64url')],
      ]),
    );
    const id = randomBytes(16);
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(id.length);
    const attested = Buffer.concat([Buffer.alloc(16), idLength, id, Buffer.from(cose)]);
    // UP | UV | AT
    const authData = this.authData(0x01 | 0x04 | 0x40, 0, attested);
    const attestationObject = isoCBOR.encode(
      new Map<string, string | Map<string, string> | Uint8Array>([
        ['fmt', 'none'],
        ['attStmt', new Map<string, string>()],
        ['authData', authData],
      ]),
    );
    const clientDataJSON = JSON.stringify({
      type: 'webauthn.create',
      challenge: options.challenge,
      origin,
      crossOrigin: false,
    });
    this.credentials.push({ id, privateKey, userHandle: options.user.id, counter: 0 });

    return {
      id: b64url(id),
      rawId: b64url(id),
      type: 'public-key',
      response: {
        clientDataJSON: b64url(Buffer.from(clientDataJSON)),
        attestationObject: b64url(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  /** Sendet einen bereits registrierten Passkey erneut zur Registrierung (Doppelregistrierung). */
  reRegister(
    options: PublicKeyCredentialCreationOptionsJSON,
    previous: RegistrationResponseJSON,
  ): RegistrationResponseJSON {
    const clientDataJSON = JSON.stringify({
      type: 'webauthn.create',
      challenge: options.challenge,
      origin: this.origin,
      crossOrigin: false,
    });
    return {
      ...previous,
      response: { ...previous.response, clientDataJSON: b64url(Buffer.from(clientDataJSON)) },
    };
  }

  /** Meldet sich mit dem ersten (oder angegebenen) gespeicherten Passkey an. Optionen erlauben gezielte Manipulationen. */
  authenticate(
    options: PublicKeyCredentialRequestOptionsJSON,
    {
      credential = this.credentials[0],
      origin = this.origin,
      rpId = this.rpId,
      userHandle,
      counter,
      tamperSignature = false,
    }: {
      credential?: StoredCredential;
      origin?: string;
      rpId?: string;
      /** null lässt den userHandle weg. */
      userHandle?: string | null;
      /** Fester Zählerstand statt Hochzählen. */
      counter?: number;
      tamperSignature?: boolean;
    } = {},
  ): AuthenticationResponseJSON {
    if (!credential) throw new Error('Kein Passkey im Software-Authenticator.');
    if (counter === undefined) credential.counter += 1;
    const authenticatorData = this.authData(
      0x01 | 0x04,
      counter ?? credential.counter,
      undefined,
      rpId,
    );
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: options.challenge,
        origin,
        crossOrigin: false,
      }),
    );
    const signature = sign(
      'sha256',
      Buffer.concat([authenticatorData, sha256(clientDataJSON)]),
      credential.privateKey,
    );
    if (tamperSignature)
      signature[signature.length - 1] = (signature[signature.length - 1] ?? 0) ^ 0xff;
    const handle = userHandle === undefined ? credential.userHandle : userHandle;

    return {
      id: b64url(credential.id),
      rawId: b64url(credential.id),
      type: 'public-key',
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authenticatorData),
        signature: b64url(signature),
        ...(handle === null ? {} : { userHandle: handle }),
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }
}

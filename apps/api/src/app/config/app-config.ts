/** Typisierte Konfiguration aus der Umgebung. Fehlende oder unsichere Werte brechen den Start ab. */
export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  appOrigin: string;
  /** Origin der Oberfläche für WebAuthn; Standard ist APP_ORIGIN. */
  webauthn: { rpId: string; rpName: string; origin: string };
  authPepper: string;
  /** Mindestdauer fehlgeschlagener Code-Prüfungen in ms (gleicht Antwortzeiten an). */
  authFailureFloorMs: number;
  cookieSecure: boolean;
  /** Web Push (Phase 5); ohne Schlüssel nur Banner und E-Mail. */
  vapid: { publicKey: string; privateKey: string; subject: string } | null;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string | undefined;
    password: string | undefined;
    from: string;
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');

type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Umgebungsvariable ${key} fehlt.`);
  return value;
}

export function loadAppConfig(env: Env = process.env): AppConfig {
  const nodeEnv = env['NODE_ENV'] ?? 'development';
  if (nodeEnv !== 'development' && nodeEnv !== 'test' && nodeEnv !== 'production') {
    throw new Error(`NODE_ENV ${nodeEnv} wird nicht unterstützt.`);
  }

  const authPepper = required(env, 'AUTH_PEPPER');
  if (authPepper.length < 32) throw new Error('AUTH_PEPPER muss mindestens 32 Zeichen lang sein.');

  const cookieSecure = (env['COOKIE_SECURE'] ?? 'true') !== 'false';
  if (!cookieSecure && nodeEnv !== 'development') {
    throw new Error('COOKIE_SECURE=false ist nur in der Entwicklung erlaubt.');
  }

  const appOrigin = new URL(required(env, 'APP_ORIGIN')).origin;

  return {
    nodeEnv,
    port: Number(env['API_PORT'] ?? 3000),
    databaseUrl: required(env, 'DATABASE_URL'),
    appOrigin,
    webauthn: {
      rpId: required(env, 'WEBAUTHN_RP_ID'),
      rpName: env['WEBAUTHN_RP_NAME'] ?? 'Zeit & Urlaub',
      origin: env['WEBAUTHN_ORIGIN'] ? new URL(env['WEBAUTHN_ORIGIN']).origin : appOrigin,
    },
    authPepper,
    authFailureFloorMs: Number(env['AUTH_FAILURE_FLOOR_MS'] ?? 400),
    cookieSecure,
    vapid: vapidConfig(env, appOrigin),
    smtp: {
      host: required(env, 'SMTP_HOST'),
      port: Number(required(env, 'SMTP_PORT')),
      secure: env['SMTP_SECURE'] === 'true',
      user: env['SMTP_USER'] || undefined,
      password: env['SMTP_PASSWORD'] || undefined,
      from: env['MAIL_FROM'] ?? 'Zeit & Urlaub <zeit@example.com>',
    },
  };
}

/** VAPID-Schlüssel für Web Push; beide oder keiner (Phase 5). */
function vapidConfig(env: Env, appOrigin: string): AppConfig['vapid'] {
  const publicKey = env['VAPID_PUBLIC_KEY']?.trim();
  const privateKey = env['VAPID_PRIVATE_KEY']?.trim();
  if (!publicKey && !privateKey) return null;
  if (!publicKey || !privateKey)
    throw new Error('VAPID_PUBLIC_KEY und VAPID_PRIVATE_KEY nur gemeinsam setzen.');
  return { publicKey, privateKey, subject: env['VAPID_SUBJECT']?.trim() || appOrigin };
}

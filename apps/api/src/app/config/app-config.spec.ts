import { loadAppConfig } from './app-config';

const base = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  APP_ORIGIN: 'https://zeit.example.com/',
  WEBAUTHN_RP_ID: 'zeit.example.com',
  AUTH_PEPPER: 'x'.repeat(32),
  SMTP_HOST: 'mail',
  SMTP_PORT: '25',
};

describe('loadAppConfig', () => {
  it('liest eine gültige Konfiguration', () => {
    const config = loadAppConfig(base);
    expect(config.appOrigin).toBe('https://zeit.example.com');
    expect(config.cookieSecure).toBe(true);
  });

  it('verlangt einen ausreichend langen Pepper', () => {
    expect(() => loadAppConfig({ ...base, AUTH_PEPPER: 'kurz' })).toThrow(/AUTH_PEPPER/);
  });

  it('erlaubt unsichere Cookies nur in der Entwicklung', () => {
    expect(() => loadAppConfig({ ...base, COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
    expect(
      loadAppConfig({ ...base, NODE_ENV: 'development', COOKIE_SECURE: 'false' }).cookieSecure,
    ).toBe(false);
  });

  it('meldet fehlende Pflichtwerte', () => {
    expect(() => loadAppConfig({ ...base, DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });
});

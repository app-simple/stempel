import type { LoggerService } from '@nestjs/common';
import { SoftAuthenticator } from '../../testing/soft-authenticator';
import {
  cookiesFrom,
  createEmployee,
  createTestApp,
  http,
  ORIGIN,
  resetDb,
  type TestContext,
} from '../../testing/test-app';
import { LoginCodeService } from './login-code.service';

/** CLAUDE.md: keine personenbezogenen Daten in Logs. */
class CapturingLogger implements LoggerService {
  readonly lines: string[] = [];
  private push(...args: unknown[]): void {
    this.lines.push(
      args
        .map((a) => (a instanceof Error ? `${a.name} ${a.message} ${a.stack ?? ''}` : String(a)))
        .join(' '),
    );
  }
  log(...args: unknown[]): void {
    this.push(...args);
  }
  error(...args: unknown[]): void {
    this.push(...args);
  }
  warn(...args: unknown[]): void {
    this.push(...args);
  }
  debug(...args: unknown[]): void {
    this.push(...args);
  }
  verbose(...args: unknown[]): void {
    this.push(...args);
  }
}

describe('Logs ohne personenbezogene Daten', () => {
  const logger = new CapturingLogger();
  let ctx: TestContext;
  beforeAll(async () => (ctx = await createTestApp({ logger })));
  afterAll(() => ctx.close());

  it('schreibt bei Anmeldeabläufen weder Adressen, Namen noch Codes ins Log', async () => {
    await resetDb(ctx.prisma);
    const { email } = await createEmployee(ctx.prisma, {
      name: 'Erika Musterfrau',
      email: 'erika.musterfrau@example.org',
    });
    const post = (path: string) => http(ctx).post(path).set('Origin', ORIGIN);

    jest.spyOn(ctx.mail, 'send').mockRejectedValueOnce(new Error(`SMTP lehnt ${email} ab`));
    await post('/api/auth/code/request').send({ email }).expect(202);
    await ctx.app.get(LoginCodeService).whenIdle();

    await post('/api/auth/code/request').send({ email }).expect(202);
    await ctx.app.get(LoginCodeService).whenIdle();
    const code = ctx.mail.lastCodeFor(email);
    await post('/api/auth/code/verify')
      .send({ email, code: code === '000000' ? '111111' : '000000' })
      .expect(401);
    await post('/api/auth/code/verify').send({ email, code }).expect(200);

    const options = await post('/api/auth/passkey/options').expect(200);
    const unknown = new SoftAuthenticator('localhost', ORIGIN);
    unknown.register({
      challenge: 'x',
      rp: { name: 'x', id: 'localhost' },
      user: { id: 'eA', name: 'x', displayName: 'x' },
      pubKeyCredParams: [],
    });
    await post('/api/auth/passkey/verify')
      .set('Cookie', cookiesFrom(options))
      .send({ response: unknown.authenticate(options.body) })
      .expect(401);

    const all = logger.lines.join('\n');
    expect(logger.lines.length).toBeGreaterThan(0);
    expect(all).not.toContain(email);
    expect(all).not.toContain('Erika');
    expect(all).not.toContain('Musterfrau');
    expect(all).not.toContain(code);
  });
});

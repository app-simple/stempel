import {
  createEmployee,
  createTestApp,
  http,
  ORIGIN,
  resetDb,
  type TestContext,
} from '../../testing/test-app';
import { CODE_REQUESTED_MESSAGE } from './auth.controller';
import { INVALID_CODE_MESSAGE, LoginCodeService } from './login-code.service';

describe('Anmeldung per E-Mail-Code (Konzept 5.1)', () => {
  let ctx: TestContext;
  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.mail.clear();
    ctx.clock.set('2026-10-12T08:00:00.000Z');
  });

  const requestCode = (email: string, ip = '10.0.0.1') =>
    http(ctx)
      .post('/api/auth/code/request')
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', ip)
      .send({ email });
  const verify = (email: string, code: string, ip = '10.0.9.1') =>
    http(ctx)
      .post('/api/auth/code/verify')
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', ip)
      .send({ email, code });
  const idle = () => ctx.app.get(LoginCodeService).whenIdle();

  async function codeFor(email: string): Promise<string> {
    await requestCode(email).expect(202);
    await idle();
    return ctx.mail.lastCodeFor(email);
  }

  it('schickt einen sechsstelligen Code und speichert nur den Hash', async () => {
    const { id, email } = await createEmployee(ctx.prisma);
    const res = await requestCode(email).expect(202);
    expect(res.body).toEqual({ message: CODE_REQUESTED_MESSAGE });
    await idle();
    const code = ctx.mail.lastCodeFor(email);
    expect(code).toMatch(/^\d{6}$/);
    const stored = await ctx.prisma.loginCode.findFirstOrThrow({ where: { employeeId: id } });
    expect(stored.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.codeHash).not.toContain(code);
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBe(10 * 60_000);
  });

  it('antwortet für unbekannte und gesperrte Adressen gleich und verschickt nichts', async () => {
    await createEmployee(ctx.prisma, { email: 'gesperrt@example.com', lockedAt: new Date() });
    const unknown = await requestCode('niemand@example.com').expect(202);
    const locked = await requestCode('gesperrt@example.com').expect(202);
    expect(unknown.body).toEqual(locked.body);
    await idle();
    expect(ctx.mail.sent).toHaveLength(0);
    expect(await ctx.prisma.loginCode.count()).toBe(0);
  });

  it('meldet an, setzt das Sitzungscookie und protokolliert die Methode', async () => {
    const { id, email } = await createEmployee(ctx.prisma, {
      email: 'Gross@Example.com'.toLowerCase(),
    });
    const code = await codeFor(email);
    const res = await verify('  GROSS@example.com ', code).expect(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0] ?? '';
    expect(cookie).toMatch(/^__Host-asos_session=[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Max-Age=2592000/);

    const session = await http(ctx)
      .get('/api/auth/session')
      .set('Cookie', cookie.split(';')[0] ?? '')
      .expect(200);
    expect(session.body).toMatchObject({ id, method: 'EMAIL_CODE' });
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'auth.login', actorId: id },
    });
    expect(audit?.details).toEqual({ method: 'EMAIL_CODE' });
  });

  it('lässt jeden Code nur einmal zu', async () => {
    const { email } = await createEmployee(ctx.prisma);
    const code = await codeFor(email);
    await verify(email, code).expect(200);
    const again = await verify(email, code).expect(401);
    expect(again.body.message).toBe(INVALID_CODE_MESSAGE);
  });

  it('akzeptiert den Code bis knapp 10 Minuten und danach nicht mehr', async () => {
    const { email } = await createEmployee(ctx.prisma);
    let code = await codeFor(email);
    ctx.clock.advance(10 * 60_000 - 1);
    await verify(email, code).expect(200);

    code = await codeFor(email);
    ctx.clock.advance(10 * 60_000);
    await verify(email, code).expect(401);
  });

  it('sperrt den Code nach 5 Fehlversuchen, 4 Fehlversuche sind noch erlaubt', async () => {
    const { email } = await createEmployee(ctx.prisma);
    let code = await codeFor(email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) await verify(email, wrong).expect(401);
    await verify(email, code).expect(200);

    ctx.clock.advance(15 * 60_000); // neues Rate-Limit-Fenster
    code = await codeFor(email);
    for (let i = 0; i < 5; i++) await verify(email, wrong).expect(401);
    const res = await verify(email, code).expect(401);
    expect(res.body.message).toBe(INVALID_CODE_MESSAGE);
  });

  it('gibt für unbekannte Adressen dieselbe Fehlermeldung wie für falsche Codes', async () => {
    const res = await verify('niemand@example.com', '123456').expect(401);
    expect(res.body.message).toBe(INVALID_CODE_MESSAGE);
  });

  it('entwertet ältere Codes, sobald ein neuer angefordert wird', async () => {
    const { email } = await createEmployee(ctx.prisma);
    const first = await codeFor(email);
    const second = await codeFor(email);
    if (first !== second) await verify(email, first).expect(401);
    await verify(email, second).expect(200);
  });

  it('begrenzt Code-Anforderungen je Adresse, auch für unbekannte Adressen', async () => {
    for (let i = 0; i < 3; i++) await requestCode('niemand@example.com', `10.0.1.${i}`).expect(202);
    const res = await requestCode('niemand@example.com', '10.0.1.9').expect(429);
    expect(res.body.message).toBe('Zu viele Versuche. Bitte in einigen Minuten erneut versuchen.');
    ctx.clock.advance(15 * 60_000);
    await requestCode('niemand@example.com', '10.0.1.10').expect(202);
  });

  it('begrenzt Code-Anforderungen je IP', async () => {
    for (let i = 0; i < 10; i++) await requestCode(`a${i}@example.com`, '10.0.2.1').expect(202);
    await requestCode('a10@example.com', '10.0.2.1').expect(429);
    await requestCode('a10@example.com', '10.0.2.2').expect(202);
  });

  it('begrenzt Code-Prüfungen je IP', async () => {
    for (let i = 0; i < 10; i++) await verify('niemand@example.com', '123456').expect(401);
    await verify('niemand@example.com', '123456').expect(429);
  });

  it('lässt Ausgetretene am Austrittstag noch zu und ab dem Folgetag nicht mehr', async () => {
    const { email } = await createEmployee(ctx.prisma, { exitDate: '2026-10-12' });
    const code = await codeFor(email);
    await verify(email, code).expect(200);

    ctx.clock.set('2026-10-12T22:00:00.000Z'); // 13.10. 00:00 in Berlin
    ctx.mail.clear();
    await requestCode(email, '10.0.3.1').expect(202);
    await idle();
    expect(ctx.mail.sent).toHaveLength(0);
  });

  it('lässt auch bei parallelen Versuchen höchstens fünf Vergleiche je Code zu', async () => {
    const { id, email } = await createEmployee(ctx.prisma);
    const code = await codeFor(email);
    const wrong = code === '000000' ? '111111' : '000000';
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => verify(email, wrong, `10.0.4.${i}`)),
    );
    expect(results.every((r) => r.status === 401)).toBe(true);
    const stored = await ctx.prisma.loginCode.findFirstOrThrow({ where: { employeeId: id } });
    expect(stored.failedAttempts).toBe(5);
    expect(
      await ctx.prisma.auditLog.count({
        where: {
          action: 'auth.code.failed',
          actorId: id,
          details: { path: ['reason'], equals: 'mismatch' },
        },
      }),
    ).toBe(5);
    await verify(email, code, '10.0.4.99').expect(401);
  });

  it('antwortet auch dann sofort, wenn der Versand scheitert', async () => {
    const { email } = await createEmployee(ctx.prisma);
    const send = jest.spyOn(ctx.mail, 'send').mockRejectedValueOnce(new Error('SMTP down'));
    await requestCode(email).expect(202);
    await idle();
    expect(send).toHaveBeenCalledTimes(1);
    send.mockRestore();
  });

  it('protokolliert abgelaufene Codes und gesperrte Personen mit Grund, ohne Code oder Adresse', async () => {
    const { id, email } = await createEmployee(ctx.prisma);
    const code = await codeFor(email);
    ctx.clock.advance(11 * 60_000);
    await verify(email, code).expect(401);
    await ctx.prisma.employee.update({ where: { id }, data: { lockedAt: new Date() } });
    await verify(email, code).expect(401);
    const entries = await ctx.prisma.auditLog.findMany({
      where: { action: 'auth.code.failed', actorId: id },
      orderBy: { id: 'asc' },
    });
    expect(entries.map((e) => e.details)).toEqual([{ reason: 'expired' }, { reason: 'locked' }]);
    const serialized = JSON.stringify(entries.map((e) => ({ ...e, id: e.id.toString() })));
    expect(serialized).not.toContain(email);
    expect(serialized).not.toContain(code);
  });

  it('hinterlässt bei parallelen Anforderungen höchstens einen offenen Code', async () => {
    const { id, email } = await createEmployee(ctx.prisma);
    await Promise.all([1, 2, 3].map((i) => requestCode(email, `10.0.5.${i}`)));
    await idle();
    expect(await ctx.prisma.loginCode.count({ where: { employeeId: id, usedAt: null } })).toBe(1);
  });
});

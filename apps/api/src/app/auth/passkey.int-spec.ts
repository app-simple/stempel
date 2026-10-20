import { SoftAuthenticator } from '../../testing/soft-authenticator';
import {
  cookiesFrom,
  createEmployee,
  createTestApp,
  http,
  ORIGIN,
  resetDb,
  sessionCookie,
  type TestContext,
} from '../../testing/test-app';
import { PASSKEY_LOGIN_FAILED } from './passkey.service';

function expectStatus<T extends { status: number }>(res: T, status: number): T {
  expect(res.status).toBe(status);
  return res;
}

describe('Passkeys (Konzept 5.1)', () => {
  let ctx: TestContext;
  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.clock.set('2026-10-12T08:00:00.000Z');
  });

  const post = (path: string, cookie?: string) => {
    const req = http(ctx).post(path).set('Origin', ORIGIN);
    return cookie ? req.set('Cookie', cookie) : req;
  };

  async function register(cookie: string, authenticator: SoftAuthenticator, name = 'Laptop') {
    const options = await post('/api/me/passkeys/registration/options', cookie).expect(200);
    const response = authenticator.register(options.body);
    return post('/api/me/passkeys/registration/verify', cookie).send({ response, name });
  }

  async function login(authenticator: SoftAuthenticator, origin?: string) {
    const options = await post('/api/auth/passkey/options').expect(200);
    const challengeCookie = cookiesFrom(options);
    expect(challengeCookie).toMatch(/^__Host-asos_challenge=/);
    const response = authenticator.authenticate(options.body, origin ? { origin } : {});
    return post('/api/auth/passkey/verify', challengeCookie).send({ response });
  }

  it('registriert nur mit Sitzung', async () => {
    await post('/api/me/passkeys/registration/options').expect(401);
  });

  it('legt Passkeys an und meldet ohne E-Mail-Adresse damit an', async () => {
    const { id } = await createEmployee(ctx.prisma);
    const cookie = await sessionCookie(ctx, id);
    const authenticator = new SoftAuthenticator('localhost', ORIGIN);

    const created = expectStatus(await register(cookie, authenticator), 201);
    expect(created.body).toMatchObject({ name: 'Laptop', lastUsedAt: null });

    const options = await post('/api/auth/passkey/options').expect(200);
    expect(options.body.allowCredentials ?? []).toEqual([]);

    const res = expectStatus(await login(authenticator), 200);
    const session = await http(ctx)
      .get('/api/auth/session')
      .set(
        'Cookie',
        cookiesFrom(res)
          .split('; ')
          .find((c) => c.startsWith('__Host-asos_session=')) ?? '',
      )
      .expect(200);
    expect(session.body).toMatchObject({ id, method: 'PASSKEY' });

    const stored = await ctx.prisma.passkey.findFirstOrThrow({ where: { employeeId: id } });
    expect(stored.counter).toBe(1n);
    expect(stored.lastUsedAt).not.toBeNull();
  });

  it('erlaubt mehrere Passkeys je Person und verhindert doppelte Registrierung desselben Geräts', async () => {
    const { id } = await createEmployee(ctx.prisma);
    const cookie = await sessionCookie(ctx, id);
    expectStatus(await register(cookie, new SoftAuthenticator('localhost', ORIGIN), 'Laptop'), 201);
    expectStatus(await register(cookie, new SoftAuthenticator('localhost', ORIGIN), 'Handy'), 201);
    const list = await http(ctx).get('/api/me/passkeys').set('Cookie', cookie).expect(200);
    expect(list.body.map((p: { name: string }) => p.name)).toEqual(['Laptop', 'Handy']);

    const options = await post('/api/me/passkeys/registration/options', cookie).expect(200);
    expect(options.body.excludeCredentials).toHaveLength(2);
    expect(options.body.authenticatorSelection).toMatchObject({ residentKey: 'required' });
  });

  it('lässt jede Challenge nur einmal zu', async () => {
    const { id } = await createEmployee(ctx.prisma);
    const authenticator = new SoftAuthenticator('localhost', ORIGIN);
    expectStatus(await register(await sessionCookie(ctx, id), authenticator), 201);

    const options = await post('/api/auth/passkey/options').expect(200);
    const challengeCookie = cookiesFrom(options);
    const response = authenticator.authenticate(options.body);
    await post('/api/auth/passkey/verify', challengeCookie).send({ response }).expect(200);
    const replay = await post('/api/auth/passkey/verify', challengeCookie)
      .send({ response })
      .expect(401);
    expect(replay.body.message).toBe(PASSKEY_LOGIN_FAILED);
  });

  it('lehnt fremde Origins, abgelaufene Challenges und gesperrte Personen ab', async () => {
    const { id } = await createEmployee(ctx.prisma);
    const authenticator = new SoftAuthenticator('localhost', ORIGIN);
    expectStatus(await register(await sessionCookie(ctx, id), authenticator), 201);

    expectStatus(await login(authenticator, 'https://evil.example'), 401);

    const options = await post('/api/auth/passkey/options').expect(200);
    ctx.clock.advance(5 * 60_000);
    await post('/api/auth/passkey/verify', cookiesFrom(options))
      .send({ response: authenticator.authenticate(options.body) })
      .expect(401);

    await ctx.prisma.employee.update({ where: { id }, data: { lockedAt: new Date() } });
    expectStatus(await login(authenticator), 401);
  });

  it('lehnt unbekannte Passkeys und fehlende Challenge-Cookies ab', async () => {
    const unknown = new SoftAuthenticator('localhost', ORIGIN);
    unknown.register({
      challenge: 'x',
      rp: { name: 'x', id: 'localhost' },
      user: { id: 'eA', name: 'x', displayName: 'x' },
      pubKeyCredParams: [],
    });
    expectStatus(await login(unknown), 401);

    const options = await post('/api/auth/passkey/options').expect(200);
    await post('/api/auth/passkey/verify')
      .send({ response: unknown.authenticate(options.body) })
      .expect(401);
  });

  it('benennt und löscht nur eigene Passkeys', async () => {
    const me = await createEmployee(ctx.prisma);
    const other = await createEmployee(ctx.prisma);
    const myCookie = await sessionCookie(ctx, me.id);
    const otherCookie = await sessionCookie(ctx, other.id);
    const created = expectStatus(
      await register(otherCookie, new SoftAuthenticator('localhost', ORIGIN)),
      201,
    );
    const foreignId = created.body.id as string;

    await http(ctx)
      .patch(`/api/me/passkeys/${foreignId}`)
      .set('Origin', ORIGIN)
      .set('Cookie', myCookie)
      .send({ name: 'Meins' })
      .expect(404);
    await http(ctx)
      .delete(`/api/me/passkeys/${foreignId}`)
      .set('Origin', ORIGIN)
      .set('Cookie', myCookie)
      .expect(404);

    const renamed = await http(ctx)
      .patch(`/api/me/passkeys/${foreignId}`)
      .set('Origin', ORIGIN)
      .set('Cookie', otherCookie)
      .send({ name: 'Arbeitslaptop' })
      .expect(200);
    expect(renamed.body.name).toBe('Arbeitslaptop');
    await http(ctx)
      .delete(`/api/me/passkeys/${foreignId}`)
      .set('Origin', ORIGIN)
      .set('Cookie', otherCookie)
      .expect(204);
    expect(await ctx.prisma.passkey.count()).toBe(0);
  });

  describe('Negativfälle (Codex-Review AP5, Befund 8)', () => {
    async function setup() {
      const { id } = await createEmployee(ctx.prisma);
      const cookie = await sessionCookie(ctx, id);
      const authenticator = new SoftAuthenticator('localhost', ORIGIN);
      expectStatus(await register(cookie, authenticator), 201);
      return { id, cookie, authenticator };
    }

    async function loginWith(
      authenticator: SoftAuthenticator,
      opts: Parameters<SoftAuthenticator['authenticate']>[1],
    ) {
      const options = await post('/api/auth/passkey/options').expect(200);
      return post('/api/auth/passkey/verify', cookiesFrom(options)).send({
        response: authenticator.authenticate(options.body, opts),
      });
    }

    it('lässt eine Challenge auch bei parallelen Anfragen nur einmal zu', async () => {
      const { authenticator } = await setup();
      const options = await post('/api/auth/passkey/options').expect(200);
      const cookie = cookiesFrom(options);
      const response = authenticator.authenticate(options.body);
      const results = await Promise.all(
        [1, 2, 3].map(() => post('/api/auth/passkey/verify', cookie).send({ response })),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 401, 401]);
      expect(await ctx.prisma.session.count({ where: { method: 'PASSKEY' } })).toBe(1);
    });

    it('lehnt falsche RP-ID und manipulierte Signaturen ab', async () => {
      const { authenticator } = await setup();
      expectStatus(await loginWith(authenticator, { rpId: 'evil.example' }), 401);
      expectStatus(await loginWith(authenticator, { tamperSignature: true }), 401);
      expectStatus(await loginWith(authenticator, {}), 200);
    });

    it('lehnt nicht steigende Zähler ab und erlaubt Authenticatoren ohne Zähler', async () => {
      const { authenticator } = await setup();
      expectStatus(await loginWith(authenticator, { counter: 5 }), 200);
      expectStatus(await loginWith(authenticator, { counter: 5 }), 401);
      expectStatus(await loginWith(authenticator, { counter: 4 }), 401);

      const { authenticator: zero } = await setup();
      expectStatus(await loginWith(zero, { counter: 0 }), 200);
      expectStatus(await loginWith(zero, { counter: 0 }), 200);
    });

    it('verlangt einen passenden userHandle', async () => {
      const { authenticator } = await setup();
      const other = await createEmployee(ctx.prisma);
      expectStatus(await loginWith(authenticator, { userHandle: null }), 401);
      expectStatus(await loginWith(authenticator, { userHandle: '' }), 401);
      expectStatus(
        await loginWith(authenticator, { userHandle: Buffer.from(other.id).toString('base64url') }),
        401,
      );
      expectStatus(await loginWith(authenticator, { userHandle: 'kein+base64url' }), 400);
    });

    it('lehnt die erneute Registrierung desselben Passkeys ab', async () => {
      const { id } = await createEmployee(ctx.prisma);
      const cookie = await sessionCookie(ctx, id);
      const authenticator = new SoftAuthenticator('localhost', ORIGIN);
      const first = await post('/api/me/passkeys/registration/options', cookie).expect(200);
      const response = authenticator.register(first.body);
      await post('/api/me/passkeys/registration/verify', cookie)
        .send({ response, name: 'Laptop' })
        .expect(201);
      const second = await post('/api/me/passkeys/registration/options', cookie).expect(200);
      await post('/api/me/passkeys/registration/verify', cookie)
        .send({ response: authenticator.reRegister(second.body, response), name: 'Laptop' })
        .expect(409);
    });

    it('lehnt unvollständige WebAuthn-Antworten mit 400 ab', async () => {
      const { authenticator } = await setup();
      const options = await post('/api/auth/passkey/options').expect(200);
      const response = authenticator.authenticate(options.body);
      const broken = {
        ...response,
        response: { clientDataJSON: response.response.clientDataJSON },
      };
      await post('/api/auth/passkey/verify', cookiesFrom(options))
        .send({ response: broken })
        .expect(400);
      await post('/api/auth/passkey/verify', cookiesFrom(options))
        .send({ response: { id: 'x' } })
        .expect(400);
    });
  });
});

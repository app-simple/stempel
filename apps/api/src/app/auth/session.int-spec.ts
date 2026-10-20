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

describe('Sitzung und CSRF-Schutz', () => {
  let ctx: TestContext;
  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.clock.set('2026-10-12T08:00:00.000Z');
  });

  it('verlangt eine Anmeldung', async () => {
    const res = await http(ctx).get('/api/auth/session').expect(401);
    expect(res.body.message).toBe('Bitte anmelden.');
    await http(ctx)
      .get('/api/auth/session')
      .set('Cookie', '__Host-asos_session=unbekannt')
      .expect(401);
  });

  it('verlängert die Sitzung rollierend und läuft nach 30 Tagen ohne Aktivität ab', async () => {
    const { id } = await createEmployee(ctx.prisma);
    const cookie = await sessionCookie(ctx, id);

    ctx.clock.advance(30 * 60_000);
    const quiet = await http(ctx).get('/api/auth/session').set('Cookie', cookie).expect(200);
    expect(quiet.headers['set-cookie']).toBeUndefined();

    ctx.clock.advance(31 * 60_000);
    const renewed = await http(ctx).get('/api/auth/session').set('Cookie', cookie).expect(200);
    expect(cookiesFrom(renewed)).toBe(cookie);
    const session = await ctx.prisma.session.findFirstOrThrow({ where: { employeeId: id } });
    expect(session.expiresAt.toISOString()).toBe(
      new Date(ctx.clock.now().getTime() + 30 * 86_400_000).toISOString(),
    );

    ctx.clock.advance(30 * 86_400_000);
    await http(ctx).get('/api/auth/session').set('Cookie', cookie).expect(401);
    expect(await ctx.prisma.session.count({ where: { employeeId: id } })).toBe(0);
  });

  it('beendet bestehende Sitzungen bei Sperre und nach dem Austritt', async () => {
    const locked = await createEmployee(ctx.prisma);
    const cookieLocked = await sessionCookie(ctx, locked.id);
    await ctx.prisma.employee.update({ where: { id: locked.id }, data: { lockedAt: new Date() } });
    await http(ctx).get('/api/auth/session').set('Cookie', cookieLocked).expect(401);

    const leaving = await createEmployee(ctx.prisma, { exitDate: '2026-10-12' });
    const cookieLeaving = await sessionCookie(ctx, leaving.id);
    await http(ctx).get('/api/auth/session').set('Cookie', cookieLeaving).expect(200);
    ctx.clock.set('2026-10-13T06:00:00.000Z');
    await http(ctx).get('/api/auth/session').set('Cookie', cookieLeaving).expect(401);
  });

  it('meldet ab und löscht nur die eigene Sitzung', async () => {
    const { id } = await createEmployee(ctx.prisma);
    const a = await sessionCookie(ctx, id);
    const b = await sessionCookie(ctx, id);
    const res = await http(ctx)
      .post('/api/auth/logout')
      .set('Origin', ORIGIN)
      .set('Cookie', a)
      .expect(204);
    expect(String(res.headers['set-cookie'])).toMatch(/__Host-asos_session=;/);
    await http(ctx).get('/api/auth/session').set('Cookie', a).expect(401);
    await http(ctx).get('/api/auth/session').set('Cookie', b).expect(200);
  });

  it('meldet auf allen Geräten ab, ohne andere Personen zu betreffen', async () => {
    const me = await createEmployee(ctx.prisma);
    const other = await createEmployee(ctx.prisma);
    const a = await sessionCookie(ctx, me.id);
    const b = await sessionCookie(ctx, me.id);
    const c = await sessionCookie(ctx, other.id);
    await http(ctx).post('/api/auth/logout-all').set('Origin', ORIGIN).set('Cookie', a).expect(204);
    await http(ctx).get('/api/auth/session').set('Cookie', b).expect(401);
    await http(ctx).get('/api/auth/session').set('Cookie', c).expect(200);
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'auth.logout-all', actorId: me.id },
    });
    expect(audit?.details).toEqual({ sessions: 2 });
  });

  it('lehnt zustandsändernde Anfragen ohne passenden Origin oder ohne JSON ab', async () => {
    const { id } = await createEmployee(ctx.prisma);
    const cookie = await sessionCookie(ctx, id);
    await http(ctx).post('/api/auth/logout').set('Cookie', cookie).expect(403);
    await http(ctx)
      .post('/api/auth/logout')
      .set('Origin', 'https://evil.example')
      .set('Cookie', cookie)
      .expect(403);
    await http(ctx)
      .post('/api/auth/code/request')
      .set('Origin', ORIGIN)
      .type('form')
      .send('email=a@example.com')
      .expect(415);

    await http(ctx).get('/api/auth/session').set('Cookie', cookie).expect(200);
  });

  it('lehnt unbekannte Felder ab', async () => {
    await http(ctx)
      .post('/api/auth/code/request')
      .set('Origin', ORIGIN)
      .send({ email: 'a@example.com', role: 'ADMIN' })
      .expect(400);
  });
});

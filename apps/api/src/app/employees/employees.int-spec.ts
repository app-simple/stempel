import type { AdminEmployeeView, EmployeeView, ProfileView } from '@as/shared';
import {
  createEmployee,
  createTestApp,
  http,
  ORIGIN,
  resetDb,
  seedLegalParameters,
  sessionCookie,
  type TestContext,
} from '../../testing/test-app';

describe('Mitarbeiterverwaltung (Spezifikation Abschnitt 8)', () => {
  let ctx: TestContext;
  let admin: { id: string; cookie: string };
  let lead: { id: string; cookie: string };

  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.clock.set('2026-10-12T08:00:00.000Z');
    await seedLegalParameters(ctx.prisma);
    const a = await createEmployee(ctx.prisma, { role: 'ADMIN', name: 'Admin' });
    const l = await createEmployee(ctx.prisma, { role: 'LEAD', leadId: a.id, name: 'Lead' });
    admin = { id: a.id, cookie: await sessionCookie(ctx, a.id) };
    lead = { id: l.id, cookie: await sessionCookie(ctx, l.id) };
  });

  const req = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, cookie: string) =>
    http(ctx)[method](path).set('Origin', ORIGIN).set('Cookie', cookie);

  const terms = (overrides: object = {}) => ({
    validFrom: '2026-01-01',
    type: 'FULL_TIME',
    weeklyMinutes: 2400,
    workDays: [1, 2, 3, 4, 5],
    annualLeaveDays: 30,
    extraLeaveDays: 0,
    hourlyWageCents: null,
    ...overrides,
  });
  const newEmployee = (overrides: object = {}, termsOverrides: object = {}) => ({
    name: 'Jonas Beispiel',
    jobTitle: 'Entwicklung',
    role: 'EMPLOYEE',
    loginEmail: 'jonas.beispiel@example.com',
    leadId: lead.id,
    deputyId: null,
    entryDate: '2026-01-01',
    exitDate: null,
    terms: terms(termsOverrides),
    carryOverDays: 0,
    ...overrides,
  });

  describe('Sichtbarkeit', () => {
    it('zeigt Vorgesetzten nur sich und das direkte Team, ohne Anmeldeadressen', async () => {
      const mine = await createEmployee(ctx.prisma, { leadId: lead.id });
      const otherLead = await createEmployee(ctx.prisma, { role: 'LEAD', leadId: admin.id });
      await createEmployee(ctx.prisma, { leadId: otherLead.id });

      const res = await req('get', '/api/employees', lead.cookie).expect(200);
      const list = res.body as EmployeeView[];
      expect(list.map((e) => e.id).sort()).toEqual([lead.id, mine.id].sort());
      expect(JSON.stringify(list)).not.toContain('loginEmail');
      expect(JSON.stringify(list)).not.toContain('@example.com');
    });

    it('zeigt dem Admin alle mit Anmeldeadresse', async () => {
      const res = await req('get', '/api/employees', admin.cookie).expect(200);
      expect(
        (res.body as AdminEmployeeView[]).every((e) => e.loginEmail.endsWith('@example.com')),
      ).toBe(true);
    });

    it('zeigt Mitarbeitern ihr eigenes Profil inklusive eigener Anmeldeadresse', async () => {
      const me = await createEmployee(ctx.prisma, { leadId: lead.id, email: 'ich@example.org' });
      const res = await req('get', '/api/me', await sessionCookie(ctx, me.id)).expect(200);
      const profile = res.body as ProfileView;
      expect(profile).toMatchObject({
        id: me.id,
        loginEmail: 'ich@example.org',
        passkeyCount: 0,
        status: 'ACTIVE',
      });
      expect(profile.currentTerms).toMatchObject({
        dailyTargetMinutes: 480,
        minVacationDays: 20,
        editable: false,
      });
    });
  });

  describe('Anlegen und Prüfung des Vertragsstands', () => {
    it('legt einen Mitarbeiter mit Vertragsstand, Übertrag und Protokoll an', async () => {
      const res = await req('post', '/api/employees', admin.cookie)
        .send(newEmployee({ loginEmail: 'Jonas.Beispiel@Example.com', carryOverDays: 2 }))
        .expect(201);
      const created = res.body as AdminEmployeeView;
      expect(created).toMatchObject({
        loginEmail: 'jonas.beispiel@example.com',
        leadName: 'Lead',
        carryOver: { year: 2026, days: 2 },
      });
      const audit = await ctx.prisma.auditLog.findMany({ where: { entityId: created.id } });
      expect(audit.map((a) => a.action)).toEqual(['employee.create']);
    });

    it('lehnt einen Jahresurlaub unter dem gesetzlichen Minimum ab (§ 3 BUrlG)', async () => {
      const res = await req('post', '/api/employees', admin.cookie)
        .send(newEmployee({}, { annualLeaveDays: 19 }))
        .expect(422);
      expect(res.body.message).toBe('Der Vertragsstand ist nicht zulässig.');
      expect(res.body.errors).toEqual([
        {
          code: 'VACATION_BELOW_MINIMUM',
          text: 'Jahresurlaub liegt unter dem gesetzlichen Minimum von 20 Tagen.',
          paragraph: '§ 3 BUrlG',
        },
      ]);
      expect(
        await ctx.prisma.employee.count({ where: { loginEmail: 'jonas.beispiel@example.com' } }),
      ).toBe(0);

      await req('post', '/api/employees', admin.cookie)
        .send(newEmployee({}, { workDays: [1, 2, 3], weeklyMinutes: 1440, annualLeaveDays: 12 }))
        .expect(201);
    });

    it('lehnt mehr als 10 Stunden je Tag und mehr als 48 Wochenstunden ab (§ 3 ArbZG)', async () => {
      const day = await req('post', '/api/employees', admin.cookie)
        .send(newEmployee({}, { workDays: [1, 2, 3, 4], weeklyMinutes: 2401 }))
        .expect(422);
      expect(day.body.errors.map((e: { code: string }) => e.code)).toEqual([
        'DAILY_HOURS_ABOVE_10',
      ]);
      const week = await req('post', '/api/employees', admin.cookie)
        .send(
          newEmployee(
            {},
            { workDays: [1, 2, 3, 4, 5, 6], weeklyMinutes: 2881, annualLeaveDays: 24 },
          ),
        )
        .expect(422);
      expect(week.body.errors.map((e: { code: string }) => e.code)).toEqual([
        'WEEKLY_HOURS_ABOVE_48',
      ]);
    });

    it('prüft Mindestlohn und Minijob-Grenze gegen die Werte am Stichtag und warnt vor künftigen Werten', async () => {
      const minijob = { type: 'MINIJOB', weeklyMinutes: 480, workDays: [2, 4], annualLeaveDays: 8 };
      const low = await req('post', '/api/employees', admin.cookie)
        .send(newEmployee({}, { ...minijob, hourlyWageCents: 1389 }))
        .expect(422);
      expect(low.body.errors[0]).toMatchObject({
        code: 'WAGE_BELOW_MINIMUM',
        text: 'Stundenlohn unter dem Mindestlohn von 13,90 €.',
      });

      const res = await req('post', '/api/employees', admin.cookie)
        .send(newEmployee({}, { ...minijob, hourlyWageCents: 1390 }))
        .expect(201);
      expect((res.body as AdminEmployeeView).warnings).toEqual([
        {
          code: 'FUTURE_WAGE_BELOW_MINIMUM',
          text: 'Ab 01.01.2027 liegt der Stundenlohn unter dem Mindestlohn von 14,60 €.',
          paragraph: '§ 1 MiLoG',
        },
      ]);
    });

    it('verlangt den ersten Stand ab Eintritt, bei frühem Eintritt ab dem ersten Stichtag gesetzlicher Werte', async () => {
      const early = await req('post', '/api/employees', admin.cookie)
        .send(newEmployee({ entryDate: '2015-03-01' }, { validFrom: '2015-03-01' }))
        .expect(400);
      expect(early.body.message).toBe(
        'Der erste Vertragsstand gilt ab 01.01.2026, weil für frühere Stichtage keine gesetzlichen Werte hinterlegt sind.',
      );
      const gap = await req('post', '/api/employees', admin.cookie)
        .send(newEmployee({ entryDate: '2026-02-01' }, { validFrom: '2026-03-01' }))
        .expect(400);
      expect(gap.body.message).toBe('Der erste Vertragsstand gilt ab dem Eintritt (01.02.2026).');
      await req('post', '/api/employees', admin.cookie)
        .send(newEmployee({ entryDate: '2026-02-01' }))
        .expect(400);
      await req('post', '/api/employees', admin.cookie)
        .send(newEmployee({ entryDate: '2015-03-01' }))
        .expect(201);
    });

    it('meldet fehlende gesetzliche Werte am Stichtag mit 422', async () => {
      const employee = await createEmployee(ctx.prisma, { leadId: lead.id });
      await ctx.prisma.legalParameter.deleteMany({});
      const res = await req('post', `/api/employees/${employee.id}/terms`, admin.cookie)
        .send(terms({ validFrom: '2026-11-01' }))
        .expect(422);
      expect(res.body.errors[0]).toEqual({
        code: 'LEGAL_VALUES_MISSING',
        text: 'Für den Stichtag 01.11.2026 sind keine gesetzlichen Werte hinterlegt.',
      });
    });

    it('lehnt null in Pflichtfeldern und fehlende Vertragsstände mit 400 ab', async () => {
      const employee = await createEmployee(ctx.prisma, { leadId: lead.id });
      for (const body of [
        { name: null },
        { role: null },
        { loginEmail: null },
        { entryDate: null },
      ]) {
        await req('patch', `/api/employees/${employee.id}`, admin.cookie).send(body).expect(400);
      }
      const withoutTerms: Partial<ReturnType<typeof newEmployee>> = newEmployee();
      delete withoutTerms.terms;
      await req('post', '/api/employees', admin.cookie).send(withoutTerms).expect(400);
    });

    it('lehnt doppelte Anmeldeadressen unabhängig von Groß- und Kleinschreibung ab', async () => {
      await req('post', '/api/employees', admin.cookie).send(newEmployee()).expect(201);
      const res = await req('post', '/api/employees', admin.cookie)
        .send(newEmployee({ loginEmail: 'JONAS.beispiel@example.com' }))
        .expect(409);
      expect(res.body.message).toBe('Diese Anmeldeadresse ist bereits vergeben.');
    });

    it('prüft Vorgesetzte und Vertretung', async () => {
      const employee = await createEmployee(ctx.prisma, { leadId: lead.id });
      await req('post', '/api/employees', admin.cookie)
        .send(newEmployee({ leadId: null }))
        .expect(400);
      await req('post', '/api/employees', admin.cookie)
        .send(newEmployee({ leadId: employee.id }))
        .expect(400);
      await req('post', '/api/employees', admin.cookie)
        .send(newEmployee({ deputyId: lead.id }))
        .expect(400);
      await req('post', '/api/employees', admin.cookie)
        .send(newEmployee({ deputyId: admin.id }))
        .expect(201);
      // Kreis: Admin bekommt Lead als Vorgesetzten, Lead hat Admin.
      await req('patch', `/api/employees/${admin.id}`, admin.cookie)
        .send({ leadId: lead.id })
        .expect(400);
    });
  });

  describe('Ändern, Sperren, Austritt', () => {
    it('protokolliert Änderungen nur mit Feldnamen', async () => {
      const employee = await createEmployee(ctx.prisma, { leadId: lead.id });
      await req('patch', `/api/employees/${employee.id}`, admin.cookie)
        .send({ loginEmail: 'neu@example.org', jobTitle: 'Support' })
        .expect(200);
      const entry = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'employee.update', entityId: employee.id },
      });
      expect(entry.details).toEqual({ fields: ['jobTitle', 'loginEmail'] });
    });

    it('stuft Vorgesetzte mit Team nicht herab', async () => {
      await createEmployee(ctx.prisma, { leadId: lead.id });
      await req('patch', `/api/employees/${lead.id}`, admin.cookie)
        .send({ role: 'EMPLOYEE' })
        .expect(409);
    });

    it('sperrt, beendet Sitzungen und entsperrt', async () => {
      const employee = await createEmployee(ctx.prisma, { leadId: lead.id });
      const cookie = await sessionCookie(ctx, employee.id);
      const locked = await req('post', `/api/employees/${employee.id}/lock`, admin.cookie).expect(
        200,
      );
      expect(locked.body.status).toBe('LOCKED');
      await http(ctx).get('/api/me').set('Cookie', cookie).expect(401);
      const unlocked = await req(
        'post',
        `/api/employees/${employee.id}/unlock`,
        admin.cookie,
      ).expect(200);
      expect(unlocked.body.status).toBe('ACTIVE');
    });

    it('zeigt Ausgetretene ab dem Folgetag als ausgetreten; Entsperren ändert daran nichts', async () => {
      const employee = await createEmployee(ctx.prisma, { leadId: lead.id });
      await req('patch', `/api/employees/${employee.id}`, admin.cookie)
        .send({ exitDate: '2026-10-12' })
        .expect(200);
      expect((await req('get', `/api/employees/${employee.id}`, admin.cookie)).body.status).toBe(
        'ACTIVE',
      );
      ctx.clock.set('2026-10-13T08:00:00.000Z');
      admin.cookie = await sessionCookie(ctx, admin.id);
      await req('post', `/api/employees/${employee.id}/unlock`, admin.cookie).expect(200);
      expect((await req('get', `/api/employees/${employee.id}`, admin.cookie)).body.status).toBe(
        'EXITED',
      );
      await req('patch', `/api/employees/${employee.id}`, admin.cookie)
        .send({ exitDate: '2026-10-01', entryDate: '2026-11-01' })
        .expect(400);
    });

    it('lässt immer einen anmeldefähigen Admin übrig', async () => {
      await req('post', `/api/employees/${admin.id}/lock`, admin.cookie).expect(409);
      await req('patch', `/api/employees/${admin.id}`, admin.cookie)
        .send({ role: 'LEAD', leadId: lead.id })
        .expect(409);
      await req('patch', `/api/employees/${admin.id}`, admin.cookie)
        .send({ exitDate: '2026-10-11' })
        .expect(409);
      const second = await createEmployee(ctx.prisma, { role: 'ADMIN' });
      await req('post', `/api/employees/${second.id}/lock`, admin.cookie).expect(200);
      await req('post', `/api/employees/${admin.id}/lock`, admin.cookie).expect(409);
      await req('post', `/api/employees/${second.id}/unlock`, admin.cookie).expect(200);
      await req('post', `/api/employees/${admin.id}/lock`, admin.cookie).expect(200);
    });
  });

  describe('Vertragsstände', () => {
    it('hält geltende Stände unveränderlich und erlaubt Korrekturen über neue Stände', async () => {
      const employee = await createEmployee(ctx.prisma, { leadId: lead.id });
      const [current] = (
        await req('get', `/api/employees/${employee.id}/terms`, admin.cookie).expect(200)
      ).body as { id: string }[];
      await req('patch', `/api/employees/${employee.id}/terms/${current?.id}`, admin.cookie)
        .send(terms({ validFrom: '2027-01-01' }))
        .expect(409);
      await req(
        'delete',
        `/api/employees/${employee.id}/terms/${current?.id}`,
        admin.cookie,
      ).expect(409);

      const correction = await req('post', `/api/employees/${employee.id}/terms`, admin.cookie)
        .send(terms({ validFrom: '2026-10-01', weeklyMinutes: 2310 }))
        .expect(201);
      expect(correction.body.terms).toMatchObject({
        validFrom: '2026-10-01',
        dailyTargetMinutes: 462,
        editable: false,
      });
      await req('post', `/api/employees/${employee.id}/terms`, admin.cookie)
        .send(terms({ validFrom: '2026-10-01' }))
        .expect(409);
    });

    it('ändert und löscht künftige Stände, aber nie den letzten', async () => {
      const employee = await createEmployee(ctx.prisma, { leadId: lead.id });
      const future = await req('post', `/api/employees/${employee.id}/terms`, admin.cookie)
        .send(
          terms({
            validFrom: '2027-01-01',
            weeklyMinutes: 1440,
            workDays: [1, 2, 3],
            annualLeaveDays: 12,
          }),
        )
        .expect(201);
      const id = future.body.terms.id as string;
      expect(future.body.terms.editable).toBe(true);
      await req('patch', `/api/employees/${employee.id}/terms/${id}`, admin.cookie)
        .send(
          terms({
            validFrom: '2027-02-01',
            weeklyMinutes: 1440,
            workDays: [1, 2, 3],
            annualLeaveDays: 11,
          }),
        )
        .expect(422);
      await req('patch', `/api/employees/${employee.id}/terms/${id}`, admin.cookie)
        .send(terms({ validFrom: '2026-10-12' }))
        .expect(400);
      await req('delete', `/api/employees/${employee.id}/terms/${id}`, admin.cookie).expect(204);

      const starter = await createEmployee(ctx.prisma, { leadId: lead.id });
      const only = await ctx.prisma.employmentTerms.findFirstOrThrow({
        where: { employeeId: starter.id },
      });
      await ctx.prisma.employee.update({
        where: { id: starter.id },
        data: { entryDate: new Date('2026-12-01T00:00:00Z') },
      });
      await ctx.prisma.employmentTerms.update({
        where: { id: only.id },
        data: { validFrom: new Date('2026-12-01T00:00:00Z') },
      });
      await req('delete', `/api/employees/${starter.id}/terms/${only.id}`, admin.cookie).expect(
        409,
      );
    });

    it('pflegt den Übertrag je Jahr', async () => {
      const employee = await createEmployee(ctx.prisma, { leadId: lead.id });
      await req('put', `/api/employees/${employee.id}/carry-over/2026`, admin.cookie)
        .send({ days: 3 })
        .expect(200);
      await req('put', `/api/employees/${employee.id}/carry-over/2026`, admin.cookie)
        .send({ days: 5 })
        .expect(200);
      await req('put', `/api/employees/${employee.id}/carry-over/2026`, admin.cookie)
        .send({ days: 61 })
        .expect(400);
      await req('put', `/api/employees/${employee.id}/carry-over/2020`, admin.cookie)
        .send({ days: 1 })
        .expect(400);
      const view = await req('get', `/api/employees/${employee.id}`, admin.cookie).expect(200);
      expect(view.body.carryOver).toEqual({ year: 2026, days: 5 });
    });
  });

  describe('Nebenläufigkeit (Codex-Review AP6/7)', () => {
    it('lässt bei parallelem Sperren zweier Admins einen anmeldefähigen Admin übrig', async () => {
      const second = await createEmployee(ctx.prisma, { role: 'ADMIN' });
      const results = await Promise.all([
        req('post', `/api/employees/${admin.id}/lock`, admin.cookie),
        req('post', `/api/employees/${second.id}/lock`, admin.cookie),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const loginable = await ctx.prisma.employee.count({
        where: { role: 'ADMIN', lockedAt: null },
      });
      expect(loginable).toBe(1);
    });

    it('verhindert Kreise auch bei gleichzeitigen Zuordnungen', async () => {
      const a = await createEmployee(ctx.prisma, { role: 'LEAD', leadId: admin.id });
      const b = await createEmployee(ctx.prisma, { role: 'LEAD', leadId: admin.id });
      const results = await Promise.all([
        req('patch', `/api/employees/${a.id}`, admin.cookie).send({ leadId: b.id }),
        req('patch', `/api/employees/${b.id}`, admin.cookie).send({ leadId: a.id }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    });

    it('schreibt bei PATCH nur die übergebenen Felder', async () => {
      const employee = await createEmployee(ctx.prisma, { role: 'LEAD', leadId: admin.id });
      await req('patch', `/api/employees/${employee.id}`, admin.cookie)
        .send({ jobTitle: 'Support' })
        .expect(200);
      const entry = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'employee.update', entityId: employee.id },
        orderBy: { id: 'desc' },
      });
      expect(entry.details).toEqual({ fields: ['jobTitle'] });
    });

    it('löscht den ersten Vertragsstand nie, auch wenn er in der Zukunft liegt', async () => {
      const res = await req('post', '/api/employees', admin.cookie)
        .send(newEmployee({ entryDate: '2026-12-01' }, { validFrom: '2026-12-01' }))
        .expect(201);
      const id = res.body.id as string;
      await req('post', `/api/employees/${id}/terms`, admin.cookie)
        .send(terms({ validFrom: '2027-01-01' }))
        .expect(201);
      const all = (await req('get', `/api/employees/${id}/terms`, admin.cookie)).body as {
        id: string;
        validFrom: string;
      }[];
      const results = await Promise.all(
        all.map((t) => req('delete', `/api/employees/${id}/terms/${t.id}`, admin.cookie)),
      );
      expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
      expect(await ctx.prisma.employmentTerms.count({ where: { employeeId: id } })).toBe(1);
      await req('patch', `/api/employees/${id}/terms/${all[0]?.id}`, admin.cookie)
        .send(terms({ validFrom: '2026-12-15' }))
        .expect(400);
    });
  });

  it('prüft die Paginierung des Protokolls', async () => {
    for (const query of [
      'limit=1.5',
      'limit=0',
      'limit=501',
      'before=abc',
      'before=99999999999999999999',
    ]) {
      await req('get', `/api/audit-log?${query}`, admin.cookie).expect(400);
    }
    await req('get', '/api/audit-log?limit=5', admin.cookie).expect(200);
  });
});

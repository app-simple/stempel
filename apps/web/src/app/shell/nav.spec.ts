import { navFor, pageTitleFor } from './nav';

describe('navFor', () => {
  it('zeigt Mitarbeitern keine Freigaben und niemandem außer dem Admin die Mitarbeiterverwaltung', () => {
    expect(navFor('EMPLOYEE').map((i) => i.label)).toEqual([
      'Heute',
      'Zeiten',
      'Mein Urlaub',
      'Urlaubsübersicht',
      'Feiertage',
      'Profil',
    ]);
    expect(navFor('LEAD', true).map((i) => i.label)).toEqual([
      'Heute',
      'Zeiten',
      'Mein Urlaub',
      'Freigaben',
      'Urlaubsübersicht',
      'Prüfungen',
      'Feiertage',
      'Profil',
    ]);
  });

  it('zeigt Mitarbeitern während einer Vertretung die Freigaben', () => {
    expect(navFor('EMPLOYEE', true).map((i) => i.label)).toContain('Freigaben');
  });

  it('zeigt dem Admin zusätzlich die Mitarbeiter', () => {
    expect(navFor('ADMIN', true).map((i) => i.label)).toEqual([
      'Heute',
      'Zeiten',
      'Mein Urlaub',
      'Freigaben',
      'Urlaubsübersicht',
      'Prüfungen',
      'Mitarbeiter',
      'Feiertage',
      'Profil',
    ]);
  });

  it('zeigt ohne Anmeldung nichts', () => {
    expect(navFor(null)).toEqual([]);
  });
});

describe('pageTitleFor', () => {
  const items = navFor('ADMIN', true);
  it.each([
    ['/', 'Heute'],
    ['/zeiten?woche=2026-10-12', 'Zeiten'],
    ['/mitarbeiter/abc', 'Mitarbeiter'],
    ['/urlaubsuebersicht#liste', 'Urlaubsübersicht'],
    ['/unbekannt', 'Zeit & Urlaub'],
  ])('%s → %s', (url, title) => expect(pageTitleFor(url, items)).toBe(title));

  it('ordnet /urlaubsuebersicht nicht „Mein Urlaub“ (/urlaub) zu', () => {
    expect(pageTitleFor('/urlaubsuebersicht', items)).toBe('Urlaubsübersicht');
  });
});

it('gibt jedem Menüpunkt ein Symbol', () => {
  expect(navFor('ADMIN', true).every((item) => !!item.icon)).toBe(true);
});

import { termSegments } from './sick-credit';

describe('termSegments', () => {
  it('teilt den Zeitraum bei einem Vertragswechsel', () => {
    const change = '2026-10-15';
    expect(
      termSegments('2026-10-13', '2026-10-16', (d) => (d < change ? [1, 2, 3, 4, 5] : [2, 4])),
    ).toEqual([
      { from: '2026-10-13', to: '2026-10-14', workDays: [1, 2, 3, 4, 5] },
      { from: '2026-10-15', to: '2026-10-16', workDays: [2, 4] },
    ]);
  });
  it('liefert einen Abschnitt ohne Wechsel', () => {
    expect(termSegments('2026-10-13', '2026-10-13', () => [1])).toEqual([
      { from: '2026-10-13', to: '2026-10-13', workDays: [1] },
    ]);
  });
});

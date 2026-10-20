import { fromLocalDate } from '../common/dates';
import { canLogIn } from './login-eligibility';

describe('canLogIn', () => {
  it('erlaubt aktive Mitarbeiter ohne Austritt', () => {
    expect(canLogIn({ lockedAt: null, exitDate: null }, '2026-10-12')).toBe(true);
  });

  it('sperrt bei manueller Sperre, auch vor dem Austritt', () => {
    expect(
      canLogIn({ lockedAt: new Date(), exitDate: fromLocalDate('2026-12-31') }, '2026-10-12'),
    ).toBe(false);
  });

  it('erlaubt die Anmeldung am Austrittstag und sperrt ab dem Folgetag', () => {
    const exitDate = fromLocalDate('2026-10-31');
    expect(canLogIn({ lockedAt: null, exitDate }, '2026-10-30')).toBe(true);
    expect(canLogIn({ lockedAt: null, exitDate }, '2026-10-31')).toBe(true);
    expect(canLogIn({ lockedAt: null, exitDate }, '2026-11-01')).toBe(false);
  });
});

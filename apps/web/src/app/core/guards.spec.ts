import { TestBed } from '@angular/core/testing';
import {
  Router,
  UrlTree,
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
} from '@angular/router';
import { provideRouter } from '@angular/router';
import type { SessionView } from '@as/shared';
import { roleGuard, signedInGuard, signedOutGuard } from './guards';
import { SessionStore } from './session.store';

function withSession(session: SessionView | null): void {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: SessionStore, useValue: { ensureLoaded: () => Promise.resolve(session) } },
    ],
  });
}

const run = (guard: typeof signedInGuard) =>
  TestBed.runInInjectionContext(() =>
    guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
  ) as Promise<boolean | UrlTree>;

const employee: SessionView = {
  id: '1',
  name: 'Elif Aydin',
  role: 'EMPLOYEE',
  method: 'EMAIL_CODE',
};

describe('Guards', () => {
  it('leitet ohne Sitzung zur Anmeldung um', async () => {
    withSession(null);
    const result = await run(signedInGuard);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/anmelden');
  });

  it('leitet Angemeldete von der Anmeldeseite zum Start', async () => {
    withSession(employee);
    const result = await run(signedOutGuard);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/');
  });

  it('leitet bei falscher Rolle zum Start und lässt die richtige Rolle durch', async () => {
    withSession(employee);
    const denied = await run(roleGuard('ADMIN'));
    expect(TestBed.inject(Router).serializeUrl(denied as UrlTree)).toBe('/');
    expect(await run(roleGuard('EMPLOYEE', 'ADMIN'))).toBe(true);
  });
});

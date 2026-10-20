import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { CodePage } from './code-page';
import { LoginFlow } from './login-flow.service';
import { LoginPage } from './login-page';

function setup() {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  return { http: TestBed.inject(HttpTestingController), flow: TestBed.inject(LoginFlow) };
}

const flushAsync = () => new Promise((r) => setTimeout(r, 0));

describe('LoginPage', () => {
  it('verlangt eine gültige Adresse, bevor angefragt wird', async () => {
    const { http } = setup();
    const fixture = TestBed.createComponent(LoginPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('#email')!;
    input.value = 'kein-mail';
    input.dispatchEvent(new Event('input'));
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('gültige E-Mail-Adresse');
    http.expectNone('/api/auth/code/request');
  });

  it('zeigt die Meldung bei zu vielen Versuchen', async () => {
    const { http, flow } = setup();
    const fixture = TestBed.createComponent(LoginPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('#email')!;
    input.value = 'jonas@example.com';
    input.dispatchEvent(new Event('input'));
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    http
      .expectOne('/api/auth/code/request')
      .flush(
        { message: 'Zu viele Versuche. Bitte in einigen Minuten erneut versuchen.' },
        { status: 429, statusText: 'Too Many' },
      );
    await flushAsync();
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Zu viele Versuche');
    expect(flow.email()).toBeNull();
  });
});

describe('CodePage', () => {
  async function render() {
    const ctx = setup();
    ctx.flow.email.set('jonas@example.com');
    const fixture = TestBed.createComponent(CodePage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('#code')!;
    input.value = '123456';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    return { ...ctx, fixture, el };
  }

  it('zeigt die Meldung bei falschem Code und behält die Adresse', async () => {
    const { http, flow, fixture, el } = await render();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    http
      .expectOne('/api/auth/code/verify')
      .flush(
        { message: 'Code ungültig oder abgelaufen.' },
        { status: 401, statusText: 'Unauthorized' },
      );
    await flushAsync();
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      'Code ungültig oder abgelaufen.',
    );
    expect(flow.email()).toBe('jonas@example.com');
  });

  it('behält die Adresse, wenn die Sitzung nach dem Code nicht bestätigt wird', async () => {
    const { http, flow, fixture, el } = await render();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    http.expectOne('/api/auth/code/verify').flush({ ok: true });
    await flushAsync();
    http
      .expectOne('/api/auth/session')
      .flush({ message: 'Fehler' }, { status: 500, statusText: 'Error' });
    await flushAsync();
    await fixture.whenStable();
    expect(flow.email()).toBe('jonas@example.com');
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('nicht bestätigen');
  });

  it('meldet erfolgreich an und räumt die Adresse auf', async () => {
    const { http, flow, el } = await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    http.expectOne('/api/auth/code/verify').flush({ ok: true });
    await flushAsync();
    http
      .expectOne('/api/auth/session')
      .flush({ id: '1', name: 'Jonas', role: 'EMPLOYEE', method: 'EMAIL_CODE' });
    await flushAsync();
    expect(flow.email()).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('sperrt „Neuen Code anfordern“, solange eine Anfrage läuft', async () => {
    const { http, fixture, el } = await render();
    const resend = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Neuen Code'),
    )!;
    resend.click();
    resend.click();
    await fixture.whenStable();
    http
      .expectOne('/api/auth/code/request')
      .flush({ message: 'ok' }, { status: 202, statusText: 'Accepted' });
    await flushAsync();
  });
});

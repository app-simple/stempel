import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TermsForm } from './terms-form';

const legal = [
  { key: 'MIN_WAGE_HOURLY_CENTS', value: 1390, validFrom: '2026-01-01', source: 'Test' },
  { key: 'MINIJOB_MONTHLY_LIMIT_CENTS', value: 60300, validFrom: '2026-01-01', source: 'Test' },
  { key: 'MIN_WAGE_HOURLY_CENTS', value: 1460, validFrom: '2027-01-01', source: 'Test' },
];
async function render() {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  const fixture = TestBed.createComponent(TermsForm);
  fixture.componentRef.setInput('defaultDate', '2026-10-12');
  fixture.detectChanges();
  await Promise.resolve();
  TestBed.inject(HttpTestingController).expectOne('/api/legal-parameters').flush(legal);
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}
function enter(el: HTMLElement, id: string, value: string) {
  const input = el.querySelector<HTMLInputElement>(`#${id}`)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}
describe('TermsForm', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('sperrt Speichern unter dem Mindesturlaub und erlaubt die Grenze', async () => {
    const { fixture, el } = await render();
    enter(el, 'terms-annual', '19');
    await fixture.whenStable();
    expect(el.textContent).toContain(
      'Jahresurlaub liegt unter dem gesetzlichen Minimum von 20 Tagen.',
    );
    expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    enter(el, 'terms-annual', '20');
    await fixture.whenStable();
    expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
  });
  it('prüft den Minijob-Lohn am Stichtag und zeigt künftige Werte nur als Warnung', async () => {
    const { fixture, el } = await render();
    expect(el.querySelector('#terms-wage')).toBeNull();
    const select = el.querySelector<HTMLSelectElement>('#terms-type')!;
    select.value = 'MINIJOB';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    enter(el, 'terms-hours', '8');
    enter(el, 'terms-wage', '13.89');
    await fixture.whenStable();
    expect(el.textContent?.replaceAll('\u00a0', ' ')).toContain(
      'Stundenlohn unter dem Mindestlohn von 13,90 €.',
    );
    expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    enter(el, 'terms-wage', '13.90');
    await fixture.whenStable();
    expect(el.querySelector('.lv-warn')?.textContent).toContain('14,60');
    expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
    enter(el, 'terms-date', '2027-01-01');
    await fixture.whenStable();
    expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  });
  it('sperrt ohne gesetzliche Werte und lädt sie bei Eingaben nicht erneut', async () => {
    const { fixture, el } = await render();
    enter(el, 'terms-date', '2025-12-31');
    await fixture.whenStable();
    expect(el.textContent).toContain(
      'Für den Stichtag 31.12.2025 sind keine gesetzlichen Werte hinterlegt.',
    );
    expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  });
});

it('prüft Jugendmindesturlaub am Jahresbeginn und verhindert auch direktes Absenden', async () => {
  const { fixture, el } = await render();
  fixture.componentRef.setInput('birthDate', '2010-03-01');
  enter(el, 'terms-date', '2027-01-01');
  enter(el, 'terms-annual', '22');
  const saved = vi.fn();
  fixture.componentInstance.saved.subscribe(saved);
  await fixture.whenStable();
  expect(el.textContent).toContain('mindestens 23 Tage (§ 19 Abs. 2 JArbSchG)');
  expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  expect(saved).not.toHaveBeenCalled();
  enter(el, 'terms-annual', '23');
  await fixture.whenStable();
  expect(el.textContent).not.toContain('Mindesturlaub für Jugendliche');
  expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  expect(saved).toHaveBeenCalledWith(expect.objectContaining({ annualLeaveDays: 23 }));
  TestBed.inject(HttpTestingController).verify();
});

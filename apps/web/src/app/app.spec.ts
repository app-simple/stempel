import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { ToastService } from './core/toast.service';

describe('App', () => {
  it('rendert den Router-Outlet und Rückmeldungen', async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(App);
    TestBed.inject(ToastService).show('Gespeichert.');
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('router-outlet')).not.toBeNull();
    expect(el.querySelector('[role="status"]')?.textContent).toContain('Gespeichert.');
  });
});

import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { mediaQuery } from './media';

@Component({ template: '' })
class Probe {
  readonly wide = mediaQuery('(min-width: 1024px)');
}

describe('mediaQuery', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ist ohne matchMedia (z. B. in Tests) immer false', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(TestBed.createComponent(Probe).componentInstance.wide()).toBe(false);
  });

  it('folgt Änderungen der Media Query und meldet sich beim Zerstören ab', () => {
    const listeners: ((e: { matches: boolean }) => void)[] = [];
    const list = {
      matches: false,
      addEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.push(l),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => list),
    );
    const fixture = TestBed.createComponent(Probe);
    expect(fixture.componentInstance.wide()).toBe(false);
    listeners[0]!({ matches: true });
    expect(fixture.componentInstance.wide()).toBe(true);
    fixture.destroy();
    expect(list.removeEventListener).toHaveBeenCalledOnce();
  });
});

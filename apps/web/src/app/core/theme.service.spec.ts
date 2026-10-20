import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  beforeEach(() => localStorage.clear());

  it('setzt hell, dunkel und System und merkt sich die Wahl', () => {
    const theme = TestBed.inject(ThemeService);
    theme.set('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('asos-theme')).toBe('dark');
    theme.set('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    theme.set('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(theme.choice()).toBe('system');
  });
});

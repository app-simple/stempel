import { DestroyRef, inject, signal, type Signal } from '@angular/core';

/** Ab hier feste Seitenleiste statt Schublade (Spezifikation Design, Abschnitt 3). */
export const DESKTOP = '(min-width: 1024px)';
/** Bis hier kompakte Tabellen und Wochenkalender (Abschnitte 4 und 5). */
export const NARROW = '(max-width: 639.98px)';

/** Media Query als Signal. Ohne `matchMedia` (Tests, Server) immer false. Nur im Injection Context. */
export function mediaQuery(query: string): Signal<boolean> {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return signal(false).asReadonly();
  }
  const list = window.matchMedia(query);
  const matches = signal(list.matches);
  const update = (event: { matches: boolean }) => matches.set(event.matches);
  list.addEventListener('change', update);
  inject(DestroyRef).onDestroy(() => list.removeEventListener('change', update));
  return matches.asReadonly();
}

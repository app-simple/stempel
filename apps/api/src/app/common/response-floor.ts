import { performance } from 'node:perf_hooks';

/**
 * Wartet, bis seit `startedAt` mindestens `floorMs` (plus etwas Zufall) vergangen sind.
 * Gleicht Antwortzeiten an, damit fehlgeschlagene Anmeldungen nicht verraten, ob eine Adresse bekannt ist.
 */
export async function waitForFloor(
  startedAt: number,
  floorMs: number,
  jitterMs = 50,
): Promise<void> {
  if (floorMs <= 0) return;
  const target = floorMs + Math.random() * jitterMs;
  // Timer können bis zu einer Millisekunde früher feuern, als performance.now() misst: nachwarten,
  // bis die Untergrenze sicher erreicht ist.
  let remaining = target - (performance.now() - startedAt);
  while (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, Math.ceil(remaining)));
    remaining = target - (performance.now() - startedAt);
  }
}

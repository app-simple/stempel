import { BadRequestException } from '@nestjs/common';
import { addDays, berlinInstants, formatLocalDate, type LocalDate } from '@as/shared';

export interface SpanInput {
  start: string;
  end: string | null;
  breaks: readonly { start: string; end: string }[];
}

export interface ResolvedSpan {
  start: Date;
  end: Date | null;
  breaks: { start: Date; end: Date }[];
}

const DAY_MS = 86_400_000;

/** „HH:MMW“ wählt das zweite Vorkommen der doppelten Stunde (Winterzeit), „HH:MM“ ohne W das erste. */
function parse(time: string): { clock: string; second: boolean } {
  return time.endsWith('W')
    ? { clock: time.slice(0, 5), second: true }
    : { clock: time, second: false };
}

function pick(day: LocalDate, time: string, candidates: Date[]): Date | undefined {
  const { second } = parse(time);
  if (candidates.length > 1) return second ? candidates[1] : candidates[0];
  if (second)
    throw new BadRequestException(
      `Die Uhrzeit ${parse(time).clock} kommt am ${formatLocalDate(day)} nur einmal vor.`,
    );
  return candidates[0];
}

function instant(date: LocalDate, time: string): Date {
  const result = pick(date, time, berlinInstants(date, parse(time).clock));
  if (!result)
    throw new BadRequestException(
      `Die Uhrzeit ${time} gibt es am ${formatLocalDate(date)} wegen der Zeitumstellung nicht.`,
    );
  return result;
}

/**
 * Erster Zeitpunkt mit dieser Uhrzeit, der nicht vor `after` liegt: am Tag des Beginns oder am Folgetag.
 * Existiert die Uhrzeit an einem Tag nicht (Sommerzeit), zählt der andere Tag. Die doppelte Stunde im
 * Oktober wird über „W“ eindeutig gewählt (Codex-Review Web Phase 2, Befund 1).
 */
function atOrAfter(date: LocalDate, time: string, after: Date): Date {
  for (const day of [date, addDays(date, 1)]) {
    const all = berlinInstants(day, parse(time).clock);
    if (all.length === 0) continue;
    const chosen = pick(day, time, all);
    if (chosen && chosen >= after) return chosen;
  }
  throw new BadRequestException(
    `Die Uhrzeit ${time} liegt nicht innerhalb von 24 Stunden nach dem Beginn.`,
  );
}

/**
 * Uhrzeiten eines Arbeitstags in Zeitpunkte umrechnen (Europe/Berlin). Liegt das Ende vor dem Beginn,
 * gilt es für den Folgetag (Entscheidung 3). Pausen müssen innerhalb der Buchung liegen und dürfen sich
 * nicht überschneiden. Nichts darf in der Zukunft liegen; höchstens 24 Stunden.
 */
export function resolveSpan(date: LocalDate, input: SpanInput, now: Date): ResolvedSpan {
  const start = instant(date, input.start);
  const end =
    input.end === null ? null : atOrAfter(date, input.end, new Date(start.getTime() + 60_000));
  if (start > now) throw new BadRequestException('„Kommen“ liegt in der Zukunft.');
  if (end && end > now) throw new BadRequestException('„Gehen“ liegt in der Zukunft.');
  if (end && end.getTime() - start.getTime() > DAY_MS)
    throw new BadRequestException('Eine Buchung dauert höchstens 24 Stunden.');

  const limit = end ?? now;
  const breaks = input.breaks
    .map((b) => {
      const bStart = atOrAfter(date, b.start, start);
      const bEnd = atOrAfter(date, b.end, new Date(bStart.getTime() + 60_000));
      return { start: bStart, end: bEnd };
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  for (const [i, b] of breaks.entries()) {
    if (b.end > limit) throw new BadRequestException('Eine Pause liegt außerhalb der Arbeitszeit.');
    const previous = breaks[i - 1];
    if (previous && b.start < previous.end)
      throw new BadRequestException('Pausen dürfen sich nicht überschneiden.');
  }
  return { start, end, breaks };
}

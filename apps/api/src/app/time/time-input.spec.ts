import { BadRequestException } from '@nestjs/common';
import { resolveSpan } from './time-input';

const now = new Date('2026-10-12T16:00:00Z'); // 18:00 Berliner Zeit

describe('resolveSpan', () => {
  it('rechnet Uhrzeiten des Tages in UTC um', () => {
    const span = resolveSpan(
      '2026-10-12',
      { start: '08:00', end: '16:30', breaks: [{ start: '12:00', end: '12:30' }] },
      now,
    );
    expect(span.start.toISOString()).toBe('2026-10-12T06:00:00.000Z');
    expect(span.end?.toISOString()).toBe('2026-10-12T14:30:00.000Z');
    expect(span.breaks[0]?.start.toISOString()).toBe('2026-10-12T10:00:00.000Z');
  });

  it('legt ein Ende vor dem Beginn auf den Folgetag, Pausen nach Mitternacht ebenso', () => {
    const span = resolveSpan(
      '2026-10-10',
      { start: '20:00', end: '02:00', breaks: [{ start: '23:45', end: '00:15' }] },
      now,
    );
    expect(span.end?.toISOString()).toBe('2026-10-11T00:00:00.000Z');
    expect(span.breaks[0]?.end.toISOString()).toBe('2026-10-10T22:15:00.000Z');
  });

  it('lehnt Zukunft, Pausen außerhalb und Überschneidungen ab', () => {
    expect(() => resolveSpan('2026-10-12', { start: '18:30', end: null, breaks: [] }, now)).toThrow(
      BadRequestException,
    );
    expect(() =>
      resolveSpan('2026-10-12', { start: '08:00', end: '19:00', breaks: [] }, now),
    ).toThrow('Zukunft');
    expect(() =>
      resolveSpan(
        '2026-10-12',
        { start: '08:00', end: '12:00', breaks: [{ start: '11:45', end: '12:15' }] },
        now,
      ),
    ).toThrow('außerhalb');
    expect(() =>
      resolveSpan(
        '2026-10-12',
        {
          start: '08:00',
          end: '16:00',
          breaks: [
            { start: '10:00', end: '10:30' },
            { start: '10:15', end: '10:45' },
          ],
        },
        now,
      ),
    ).toThrow('überschneiden');
  });

  it('kennt die Lücke der Sommerzeitumstellung und lässt Nachtschichten darüber zu', () => {
    expect(() =>
      resolveSpan('2026-03-29', { start: '02:30', end: '06:00', breaks: [] }, now),
    ).toThrow('nicht');
    const night = resolveSpan('2026-03-29', { start: '22:00', end: '02:30', breaks: [] }, now);
    expect(night.end?.toISOString()).toBe('2026-03-30T00:30:00.000Z');
  });

  it('wählt die doppelte Stunde im Oktober eindeutig über „W“', () => {
    const later = new Date('2026-10-26T00:00:00Z');
    const summer = resolveSpan('2026-10-25', { start: '02:30', end: '03:30', breaks: [] }, later);
    expect((summer.end!.getTime() - summer.start.getTime()) / 60_000).toBe(120);
    const winter = resolveSpan('2026-10-25', { start: '02:30W', end: '03:30', breaks: [] }, later);
    expect(winter.start.toISOString()).toBe('2026-10-25T01:30:00.000Z');
    expect((winter.end!.getTime() - winter.start.getTime()) / 60_000).toBe(60);
    expect(() =>
      resolveSpan('2026-10-12', { start: '08:00W', end: '09:00', breaks: [] }, later),
    ).toThrow('nur einmal');
  });

  it('erlaubt eine laufende Buchung für heute', () => {
    expect(
      resolveSpan('2026-10-12', { start: '08:00', end: null, breaks: [] }, now).end,
    ).toBeNull();
  });
});

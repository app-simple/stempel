import {
  berlinInstant,
  berlinInstants,
  berlinTime,
  berlinTimeInput,
  isoWeekKey,
  isTimeInput,
  mondayOf,
  mondayOfIsoWeek,
} from './berlin-time';

describe('berlin-time', () => {
  it('rechnet Ortszeit in UTC um, auch über die Zeitumstellung', () => {
    expect(berlinInstant('2026-10-12', '08:00')?.toISOString()).toBe('2026-10-12T06:00:00.000Z');
    expect(berlinInstant('2026-01-12', '08:00')?.toISOString()).toBe('2026-01-12T07:00:00.000Z');
    expect(berlinInstant('2026-03-29', '01:59')?.toISOString()).toBe('2026-03-29T00:59:00.000Z');
    expect(berlinInstant('2026-03-29', '02:30')).toBeNull();
    expect(berlinInstant('2026-03-29', '03:00')?.toISOString()).toBe('2026-03-29T01:00:00.000Z');
    expect(berlinInstant('2026-10-25', '02:30')?.toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(() => berlinInstant('2026-10-12', '24:00')).toThrow(RangeError);
  });

  it('liefert keinen, einen oder zwei Zeitpunkte an der Zeitumstellung', () => {
    expect(berlinInstants('2026-03-29', '02:30')).toEqual([]);
    expect(berlinInstants('2026-10-25', '02:30').map((d) => d.toISOString())).toEqual([
      '2026-10-25T00:30:00.000Z',
      '2026-10-25T01:30:00.000Z',
    ]);
    expect(berlinInstants('2026-10-25', '03:30')).toHaveLength(1);
  });

  it('zeigt Zeitpunkte in Berliner Zeit', () => {
    expect(berlinTime(new Date('2026-10-12T06:02:00Z'))).toBe('08:02');
    expect(berlinTime(new Date('2026-12-31T23:30:00Z'))).toBe('00:30');
  });

  it('bestimmt ISO-Wochen und ihren Montag', () => {
    expect(isoWeekKey('2026-10-12')).toBe('2026-W42');
    expect(isoWeekKey('2027-01-01')).toBe('2026-W53');
    expect(mondayOfIsoWeek('2026-W42')).toBe('2026-10-12');
    expect(mondayOfIsoWeek('2026-W53')).toBe('2026-12-28');
    expect(mondayOfIsoWeek('2025-W53')).toBeNull();
    expect(mondayOfIsoWeek('2026-42')).toBeNull();
    expect(mondayOf('2026-10-18')).toBe('2026-10-12');
  });

  it('kennzeichnet die zweite Stunde der Rückstellung eindeutig', () => {
    expect(berlinTimeInput(new Date('2026-10-25T00:30:00Z'))).toBe('02:30');
    expect(berlinTimeInput(new Date('2026-10-25T01:30:00Z'))).toBe('02:30W');
    expect(berlinTimeInput(new Date('2026-10-12T06:02:00Z'))).toBe('08:02');
    expect(isTimeInput('02:30W')).toBe(true);
    expect(isTimeInput('02:30X')).toBe(false);
  });
});

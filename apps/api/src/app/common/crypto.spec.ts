import { hmacHex, randomSixDigitCode, randomToken, safeEqualHex, sha256Hex } from './crypto';

describe('crypto', () => {
  it('erzeugt sechsstellige Codes mit führenden Nullen', () => {
    for (let i = 0; i < 200; i++) expect(randomSixDigitCode()).toMatch(/^\d{6}$/);
  });

  it('erzeugt lange, unterschiedliche Tokens', () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
  });

  it('hasht abhängig vom Pepper', () => {
    expect(hmacHex('p1'.repeat(16), 'x')).not.toBe(hmacHex('p2'.repeat(16), 'x'));
    expect(sha256Hex('x')).toHaveLength(64);
  });

  it('vergleicht Hex-Werte sicher', () => {
    const h = sha256Hex('a');
    expect(safeEqualHex(h, sha256Hex('a'))).toBe(true);
    expect(safeEqualHex(h, sha256Hex('b'))).toBe(false);
    expect(safeEqualHex(h, 'ab')).toBe(false);
  });
});

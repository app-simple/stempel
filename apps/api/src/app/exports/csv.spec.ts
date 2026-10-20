import { toCsv } from './csv';

describe('toCsv (Spezifikation Phase 4, Entscheidung 4)', () => {
  it('schreibt BOM, Semikolon und CRLF', () => {
    expect(
      toCsv([
        ['a', 'b'],
        ['c', 'd'],
      ]),
    ).toBe('﻿a;b\r\nc;d\r\n');
  });

  it('setzt Felder mit Semikolon, Anführungszeichen und Umbruch in Anführungszeichen', () => {
    expect(toCsv([['x;y', 'Sie sagte "ja"', 'a\nb']])).toBe('﻿"x;y";"Sie sagte ""ja""";"a\nb"\r\n');
  });

  it('entschärft Formeln aus Freitexten, lässt Zahlen und Zeiten stehen', () => {
    expect(toCsv([['=SUMME(A1)', '+49', '@x', '-1:30', '-5', '7:30']])).toBe(
      "﻿'=SUMME(A1);'+49;'@x;-1:30;-5;7:30\r\n",
    );
  });
});

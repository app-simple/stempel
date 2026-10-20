import { parseCreateAdminArgs } from './create-admin-args';

describe('parseCreateAdminArgs', () => {
  it('liest Werte in beiden Schreibweisen und normalisiert die Adresse', () => {
    expect(
      parseCreateAdminArgs([
        '--name',
        'Erika Beispiel',
        '--email=Erika@Example.com',
        '--entry',
        '2026-01-01',
      ]),
    ).toEqual({
      name: 'Erika Beispiel',
      email: 'erika@example.com',
      entryDate: '2026-01-01',
    });
  });

  it('meldet fehlende oder ungültige Angaben', () => {
    expect(() =>
      parseCreateAdminArgs(['--email', 'a@example.com', '--entry', '2026-01-01']),
    ).toThrow('--name');
    expect(() =>
      parseCreateAdminArgs(['--name', 'A', '--email', 'kein-mail', '--entry', '2026-01-01']),
    ).toThrow('--email');
    expect(() =>
      parseCreateAdminArgs(['--name', 'A', '--email', 'a@example.com', '--entry', '2026-02-30']),
    ).toThrow('--entry');
  });
});

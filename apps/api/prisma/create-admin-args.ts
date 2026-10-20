import { isLocalDate, type LocalDate } from '@as/shared';

export interface CreateAdminArgs {
  name: string;
  email: string;
  entryDate: LocalDate;
}

/** Liest --name, --email und --entry (JJJJ-MM-TT). Wirft mit deutscher Meldung bei fehlenden Angaben. */
export function parseCreateAdminArgs(argv: readonly string[]): CreateAdminArgs {
  const value = (flag: string): string | undefined => {
    const inline = argv.find((a) => a.startsWith(`--${flag}=`));
    if (inline) return inline.slice(flag.length + 3).trim();
    const index = argv.indexOf(`--${flag}`);
    return index >= 0 ? argv[index + 1]?.trim() : undefined;
  };
  const name = value('name');
  const email = value('email')?.toLowerCase();
  const entryDate = value('entry');
  if (!name) throw new Error('Bitte --name angeben.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error('Bitte eine gültige --email angeben.');
  if (!entryDate || !isLocalDate(entryDate))
    throw new Error('Bitte --entry im Format JJJJ-MM-TT angeben.');
  return { name, email, entryDate };
}

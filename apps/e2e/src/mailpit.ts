import { E2E } from './env';

interface MailpitSearch {
  messages: { ID: string; To: { Address: string }[]; Created: string }[];
}

/** Löscht alle Nachrichten an eine Adresse, damit nur neue Codes gefunden werden. */
export async function clearMailbox(address: string): Promise<void> {
  await fetch(`${E2E.mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`, {
    method: 'DELETE',
  });
}

/** Wartet auf die neueste Code-Mail an eine Adresse und liefert den sechsstelligen Code. */
export async function waitForCode(address: string, timeoutMs = 15_000): Promise<string> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const res = await fetch(
      `${E2E.mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
    );
    const search = (await res.json()) as MailpitSearch;
    const latest = search.messages[0];
    if (latest) {
      const message = (await (
        await fetch(`${E2E.mailpitUrl}/api/v1/message/${latest.ID}`)
      ).json()) as { Text: string; Subject: string };
      const code = /\b(\d{6})\b/.exec(message.Text)?.[1];
      if (code) return code;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Keine Code-Mail an ${address} in Mailpit.`);
}

/** Wartet auf die neueste Mail an eine Adresse mit passendem Betreff und liefert ihren Text. */
export async function waitForMail(
  address: string,
  subject: RegExp,
  timeoutMs = 15_000,
): Promise<{ subject: string; text: string }> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const res = await fetch(
      `${E2E.mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
    );
    const search = (await res.json()) as MailpitSearch;
    for (const item of search.messages) {
      const message = (await (
        await fetch(`${E2E.mailpitUrl}/api/v1/message/${item.ID}`)
      ).json()) as { Text: string; Subject: string };
      if (subject.test(message.Subject)) return { subject: message.Subject, text: message.Text };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Keine passende Mail an ${address} in Mailpit.`);
}

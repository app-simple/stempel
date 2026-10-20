# Spezifikation Phase 5: Erinnerungen und Auswertung der Nachträge

Stand: 14.10.2026 · Status: **freigegeben am 14.10.2026**, alle Vorschläge in Abschnitt 12 bestätigt
Grundlage: `docs/PROMPT-ERINNERUNGEN.md`, `docs/KONZEPT.md` (Abschnitte 4.1, 4.6, 5), `CLAUDE.md`, `prototype/index.html` (`usualStart`, `lateInfo`, `lateStats`, Erinnerung in „Heute“, Abschnitt „Nachträge“ in „Prüfungen“), Phasen 1 bis 4
Branch: `phase-5-erinnerungen`, aufbauend auf `main`

## 1. Ziel

Wer an einem Arbeitstag noch nicht gestempelt hat, bekommt eine Erinnerung als Systembenachrichtigung (Web Push), ersatzweise per E-Mail, und ein Banner in „Heute“. Der Zeitpunkt wird aus den eigenen echten Stempelzeiten gelernt. Mit derselben Technik: Erinnerung bei vergessenem Ausstempeln und bei Minijobbern an die Aufzeichnungsfrist. Dazu die Auswertung der Nachträge je Person.

Nicht in Phase 5: Meldungen an Vorgesetzte (ausgeschlossen), automatisches Stempeln (ausgeschlossen), native Apps.

## 2. Feste Regeln aus CLAUDE.md, Konzept und Prompt

- Empfänger ist immer nur die betroffene Person. Keine automatische Meldung an Vorgesetzte.
- Es wird nie automatisch gestempelt. „Jetzt stempeln“ öffnet die Stempeluhr; gestempelt wird erst durch die Person.
- Der Benachrichtigungstext enthält keine personenbezogenen Details, nur „Du hast heute noch nicht gestempelt“ (bzw. die neutralen Texte der anderen Erinnerungen).
- Höchstens zwei Erinnerungen je Art und Tag: erste beim Fälligwerden, zweite nach 60 Minuten.
- Gelernter Beginn: Median der echten Stempelzeiten (Quelle Stempeluhr) desselben Wochentags der letzten acht Wochen; Nachträge zählen nie mit; unter drei Werten gilt die betriebsweite Standardzeit.
- Keine Erinnerung ans Einstempeln an Feiertagen, vertragsfreien Tagen, bei genehmigter Abwesenheit (auch halbtägig) und wenn heute schon eine Buchung existiert. Die Minijob-Erinnerung kommt nicht an Feiertagen und nicht bei eigener Abwesenheit am Versandtag, höchstens einmal je Tag gebündelt für alle offenen Tage. Die Erinnerung ans Ausstempeln kommt immer, wenn eine Buchung über 10 Stunden offen ist (wer eingestempelt ist, arbeitet). Keine Erinnerungen nach dem Austritt oder bei gesperrten Konten.
- Jede Sendung steht im `ReminderLog`; nichts geht doppelt raus, auch bei mehreren API-Instanzen.
- Die Auswertung der Nachträge ist eine Verhaltenskontrolle: Sie muss den Beschäftigten bekannt sein (Hinweistext in der Anwendung, Datenschutzhinweise). Mitarbeiter sehen nur ihre eigene Quote; Vorgesetzte ihr Team; Admin alle.
- Keine personenbezogenen Daten in Logs; Push-Endpunkte und Schlüssel nur in der Datenbank.

## 3. Arbeitspakete

| AP | Inhalt | Wer | Abnahme |
| --- | --- | --- | --- |
| 1 | Schema: `PushSubscription`, `ReminderLog` (eindeutig je Person, Tag, Art, Stufe), Einstellungen (Standardzeit, Schwellen, E-Mail-Rückfall je Person) | Claude, Review Codex | Migration, Eindeutigkeit gegen doppelte Sendungen |
| 2 | `libs/time-rules`: üblicher Beginn (Median), Fälligkeit der Erinnerungen, Nachtrags-Statistik mit Schwellen (Signaturen Claude, Implementierung und Grenzwerttests Codex) | Claude + Codex | Tests: Nachträge ändern den Beginn nicht; Grenzfälle |
| 3 | Fälligkeitsprüfung als wiederkehrender Lauf alle 5 Minuten (Entscheidung 12.1), Versand per Web Push und E-Mail-Rückfall, Entfernen abgelaufener Subscriptions (404/410) | Claude | Integrationstests mit gestellter Uhr: Urlaub, Feiertag, vertragsfrei → keine Erinnerung; höchstens zwei je Tag |
| 4 | API: Subscription an- und abmelden, „Heute nicht erinnern“, Status für das Banner, E-Mail-Rückfall im Profil, Nachtrags-Auswertung je Rolle, Einstellungen | Claude | Zugriffsmatrix |
| 5 | Web: Service Worker und Manifest, Anmeldung je Gerät im Profil, Banner in „Heute“ mit „Jetzt stempeln“, „Bin schon länger da: nachtragen“, „Heute nicht erinnern“; Nachtrags-Auswertung in „Prüfungen“ und eigene Quote in „Zeiten“ | Codex nach Vorgabe, Claude prüft | Komponententests |
| 6 | E2E-Abnahme, README, Betriebsdoku (VAPID-Schlüssel, CSP), Codex-Review | Claude | Abschnitt 10 |

## 4. Datenmodell (Entwurf)

```prisma
enum ReminderKind { CLOCK_IN CLOCK_OUT MINIJOB_RECORDING }
enum ReminderChannel { PUSH EMAIL }

model PushSubscription {          // Konzept 5
  id          String   @id @default(uuid()) @db.Uuid
  employeeId  String   @db.Uuid
  endpoint    String   @unique
  p256dh      String
  auth        String
  deviceName  String
  createdAt   DateTime @db.Timestamptz(3)
  lastSuccessAt DateTime? @db.Timestamptz(3)
}

model ReminderLog {               // Konzept 5
  id          String   @id @default(uuid()) @db.Uuid
  employeeId  String   @db.Uuid
  date        DateTime @db.Date            // Arbeitstag, Europe/Berlin
  kind        ReminderKind
  stage       Int                          // 1 oder 2
  channel     ReminderChannel?             // null = stummgeschaltet / nichts gesendet
  sentAt      DateTime? @db.Timestamptz(3)
  muted       Boolean  @default(false)     // „Heute nicht erinnern“
  @@unique([employeeId, date, kind, stage])
}
```

Einstellungen in `CompanySettings`: `reminderDefaultStart` (Standardzeit), `lateFlagMinCount` (3), `lateFlagMinShare` (20 %), `lateFlagWeeks` (6). Am Mitarbeiter: `reminderEmailFallback` (Entscheidung 12.5).

## 5. Regelbibliothek (Phase-5-Umfang)

| Funktion | Grundlage | Inhalt |
| --- | --- | --- |
| `usualStart(entries, date)` | Konzept 4.6 | Median der Beginnzeiten (Berliner Uhrzeit) der Stempeluhr-Buchungen desselben Wochentags in den 56 Tagen vor `date`; null unter drei Werten |
| `clockInReminderDue(input)` | Konzept 4.6 | fällig ab üblichem Beginn bzw. Standardzeit + 15 Minuten, wenn Arbeitstag, kein Feiertag, keine Abwesenheit, keine Buchung, nicht stummgeschaltet; Stufe 2 nach 60 Minuten |
| `clockOutReminderDue(input)` | Konzept 4.6 | offene Buchung seit über 10 Stunden (Entscheidung 12.4) |
| `minijobRecordingDue(input)` | § 17 Abs. 1 MiLoG, Konzept 4.6 | nach Entscheidung 12.4 |
| `lateEntryStats(entries, since, thresholds)` | Konzept 4.1, `lateStats` | Buchungen, Nachträge, Anteil, Ø Verzug (nur Nachträge am selben Tag), auffällig ab Schwellen |

## 6. Abläufe

### 6.1 Erinnerung ans Stempeln
Der Lauf prüft je aktiver Person die Fälligkeit, legt vor dem Versand die `ReminderLog`-Zeile an (eindeutig je Person, Tag, Art, Stufe) und sendet dann an alle Push-Subscriptions der Person; ohne Subscription per E-Mail, wenn der Rückfall eingeschaltet ist. Antworten 404 oder 410 entfernen die Subscription. Banner in „Heute“ wie Prototyp: „Du hast heute noch nicht gestempelt. Montags beginnst du meist gegen 08:15 Uhr. Das leitet das Tool aus deinen bisherigen Stempelzeiten ab.“ mit „Jetzt stempeln“, „Bin schon länger da: nachtragen“, „Heute nicht erinnern“.

### 6.2 Benachrichtigung
Titel „Zeit & Urlaub“, Text „Du hast heute noch nicht gestempelt“, Aktionen „Jetzt stempeln“ (öffnet „Heute“) und „Heute nicht erinnern“ (meldet die Stummschaltung an die API, ohne zu stempeln). Kein Name, keine Uhrzeit.

### 6.3 Weitere Erinnerungen
„Du bist seit über 10 Stunden eingestempelt. Ausstempeln vergessen?“ (öffnet „Heute“). Minijob: „Bitte trage deine Arbeitszeit vom {Datum} nach. Die Aufzeichnung muss bis zum 7. Tag erfolgen.“ – nach Entscheidung 12.4 ohne weitere Details in der Push-Nachricht.

### 6.4 Auswertung der Nachträge
„Prüfungen“ (Vorgesetzte Team, Admin alle): je Person Buchungen, Nachträge, Anteil, Ø später erfasst (nur Nachträge am selben Tag), Markierung „auffällig“ ab den Schwellen; Text wie Prototyp. Jede Person sieht in „Zeiten“ ihre eigene Quote und ihre markierten Nachträge. Hinweistext zur Auswertung im Profil (Entscheidung 12.7).

## 7. Rechte

| Aktion | Mitarbeiter | Vorgesetzte/r | Admin |
| --- | --- | --- | --- |
| Eigene Subscriptions, Stummschalten, E-Mail-Rückfall | ja | ja | ja |
| Eigene Nachtragsquote | ja | ja | ja |
| Nachtrags-Auswertung anderer | nein | eigenes Team | alle |
| Einstellungen (Standardzeit, Schwellen) | nein | nein | ja |

## 8. API-Routen (Entwurf)

`GET /reminders/today` (Banner), `POST /reminders/mute` (heute), `GET/POST/DELETE /me/push-subscriptions`, `GET /push/public-key`, `PATCH /me/reminder-settings`, `GET /checks/late-entries?from&to` (Vorgesetzte/Admin), `GET /time/late-entries` (eigene), `GET/PUT /settings/reminders` (Admin).

## 9. Web

Service Worker (eigene Datei, keine externen Skripte) mit `push` und `notificationclick`; Web-App-Manifest für die Installation (Voraussetzung für Push auf iPhone und iPad). Profil: „Benachrichtigungen auf diesem Gerät“ an/aus, Liste der Geräte, E-Mail-Rückfall. CSP bleibt `self`; Push-Dienste der Browser werden nur vom Server angesprochen (Entscheidung 12.2).

## 10. Teststrategie und Abnahme

- Unit: üblicher Beginn (Median gerade/ungerade Anzahl, genau drei Werte, Nachträge ignoriert, anderer Wochentag, 56-Tage-Grenze, Sommerzeit), Fälligkeit (genau +15 Minuten, Stufe 2 nach 60 Minuten), Nachtrags-Schwellen (2/3 Nachträge, 19 %/20 %).
- Integration mit gestellter Uhr: Urlaub, Feiertag, vertragsfreier Tag, Buchung vorhanden, stummgeschaltet → keine Erinnerung; nie mehr als zwei je Tag; parallele Läufe senden einmal; 410 entfernt die Subscription; E-Mail-Rückfall nur ohne Subscription.
- E2E: Banner erscheint mit gelerntem Beginn, „Heute nicht erinnern“ blendet es aus; Push-Anmeldung im Profil mit Testpush (Chromium); Nachtrags-Auswertung nur im eigenen Team.
- Abnahme laut Prompt: Erinnerung lokal als Systembenachrichtigung in Chrome und Safari (manuelle Prüfung durch den Auftraggeber, Anleitung in der README).

## 11. Gesetzliche Werte

Keine. Die Aufzeichnungsfrist der Minijobber (§ 17 Abs. 1 MiLoG, sieben Tage) steht als Regel mit Paragraf in `libs/time-rules` (bereits `MINIJOB_LATE`).

## 12. Entscheidungen (14.10.2026, alle wie vorgeschlagen)

1. **Wiederkehrender Lauf**: Der Prompt nennt BullMQ; das braucht Redis als neue Infrastruktur. Vorschlag: Lauf im API-Prozess alle 5 Minuten wie die bestehenden Hintergrundaufgaben, Schutz vor Doppelversand über die eindeutige `ReminderLog`-Zeile in PostgreSQL. Kein Redis.
2. **Web Push und externe Dienste**: Web Push läuft technisch immer über den Push-Dienst des Browserherstellers (Google, Apple, Mozilla). CLAUDE.md verbietet externe Dienste zur Laufzeit. Vorschlag: zulassen als bewusste Ausnahme, weil das Konzept Web Push ausdrücklich vorsieht; die Nachricht ist Ende-zu-Ende verschlüsselt und enthält nur den neutralen Text; Push ist je Gerät freiwillig, E-Mail bleibt Rückfall. In CLAUDE.md als Ausnahme festhalten.
3. **Standardzeit** bei weniger als drei Werten: 08:00 Uhr, vom Admin änderbar.
4. **Weitere Erinnerungen**: vergessenes Ausstempeln bei über 10 Stunden offener Buchung (zwei Stufen wie oben). Minijob: an vertraglichen Arbeitstagen ohne Buchung ab dem 5. Tag danach täglich eine Erinnerung bis Tag 7, danach keine mehr (der Verstoß steht dann in den Prüfungen).
5. **E-Mail-Rückfall**: standardmäßig an für Personen ohne Push-Gerät, im Profil abschaltbar.
6. **Halbe Abwesenheitstage**: keine Erinnerung ans Einstempeln (Beginn ist an solchen Tagen nicht vorhersehbar).
7. **Transparenz**: Im Profil ein Abschnitt „Was das System auswertet“ (gelernter Beginn aus eigenen Stempelzeiten, Nachtragsquote mit Schwellen, wer sie sieht). Die Datenschutzhinweise selbst erstellt der Betrieb.
8. **Schwellen der Nachtrags-Auswertung**: wie Konzept (mindestens 3 Nachträge und 20 % in 6 Wochen), vom Admin änderbar.

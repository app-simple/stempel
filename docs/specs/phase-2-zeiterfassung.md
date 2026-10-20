# Spezifikation Phase 2: Zeiterfassung

Stand: 12.10.2026 · Status: **freigegeben am 12.10.2026** mit den Entscheidungen in Abschnitt 12
Grundlage: `docs/KONZEPT.md` (Abschnitte 2, 3, 4.1, 5), `CLAUDE.md`, `prototype/index.html` (Ansichten „Heute“ und „Zeiten“, Funktionen `entryFlags`, `soll`, `workedToday`, `miniMonth`, `lateInfo`), Phase 1 (`docs/specs/phase-1-fundament.md`)
Branch: `phase-2-zeiterfassung`, aufbauend auf `phase-1-fundament` (PR #1 noch nicht gemergt)

## 1. Ziel

Alle Beschäftigten erfassen ihre Arbeitszeit mit einer Stempeluhr (Kommen, Pause, Gehen) und tragen Vergessenes mit Begründung nach. Jede Buchung wird beim Speichern gegen ArbZG und MiLoG geprüft; Verstöße blockieren nicht, sie werden angezeigt und protokolliert. Eine Wochenansicht zeigt Soll, Ist und Saldo, Minijobber sehen Stunden und Verdienst gegen die Monatsgrenze.

Nicht in Phase 2: Urlaubsanträge und Abwesenheiten (Phase 3; das Soll berücksichtigt Urlaub erst dann), Prüfseite, Export, Löschjob (Phase 4), Erinnerungen, gelernter üblicher Beginn und Auswertung der Nachträge (Phase 5, `docs/PROMPT-ERINNERUNGEN.md`). Die Daten für Phase 5 (Quelle, Erfassungszeitpunkt) entstehen aber schon jetzt.

## 2. Feste Regeln aus CLAUDE.md und Konzept

- Die Stempeluhr nimmt immer die Serverzeit. Der Browser schickt nur die Aktion, nie eine Uhrzeit.
- Jede von Hand eingetragene Zeit ist ein Nachtrag mit Erfassungszeitpunkt (`recordedAt`), Grund und Person und wird in der Oberfläche markiert („Nachgetragen um 10:04, 2:04 Std. nach Beginn“ bzw. „Nachgetragen am 14.10.“).
- Zeitbuchungen werden nie gelöscht oder überschrieben. Jede Änderung erzeugt eine `TimeEntryRevision` mit altem und neuem Wert, Grund, Person und Zeitpunkt (append-only, per Trigger geschützt wie das AuditLog). Eine falsche Buchung wird mit Grund als ungültig markiert, nicht gelöscht.
- Regelverstöße blockieren keine Buchung. Sie erscheinen beim Mitarbeiter und werden protokolliert.
- Es wird nie automatisch für jemanden gestempelt.
- Zeitpunkte in UTC, Arbeitstage als lokales Datum in Europe/Berlin; Sommerzeitwechsel korrekt.
- Sichtbarkeit wie Phase 1: Mitarbeiter nur eigene Zeiten; Vorgesetzte ihr Team; Admin alle. Kollegen sehen keine Stempeldaten anderer.

## 3. Arbeitspakete

| AP | Inhalt | Wer | Abnahme |
| --- | --- | --- | --- |
| 1 | Prisma-Schema und Migration: `TimeEntry`, `TimeEntryBreak`, `TimeEntryRevision`, `MonthClosing` (falls freigegeben, siehe 12.6) | Claude, Review Codex | Migration läuft, Revisionen per Trigger unveränderlich |
| 2 | `libs/time-rules`: Signaturen und Typen (Claude), Implementierung und Grenzwerttests (Codex) | Claude + Codex | Abschnitt 5, jede Regel mit Paragraf und Grenzwerten |
| 3 | API Stempeluhr: Kommen, Pause beginnen/beenden, Gehen, Status heute | Claude | Serverzeit, keine doppelte offene Buchung auch bei parallelen Klicks |
| 4 | API Buchungen: Nachtrag, Korrektur, Ungültig-Markierung, Revisionen, Wochen- und Monatsansicht, Team heute, Minijob-Monat | Claude, Review und Zusatztests Codex | Zugriffsmatrix um alle neuen Routen erweitert |
| 5 | Web „Heute“: Stempeluhr, Meine Woche bzw. Mein Monat (Minijob), Hinweise der letzten 14 Tage, Team heute für Vorgesetzte | Claude | Komponententests |
| 6 | Web „Zeiten“: Wochentabelle, Nachtrag, Korrektur, Verlauf einer Buchung, Auswahl der Person für Vorgesetzte und Admin | Codex nach Vorgabe | Komponententests |
| 7 | Seed: Buchungen der Beispielmitarbeiter wie im Prototyp (ab 31.08.2026, Nachträge von Marco Pichler, Verstöße von Miriam Stadler und Elif Aydin) | Codex | idempotent, nur Entwicklung |
| 8 | E2E-Abnahme, README, Codex-Review | Claude | Abschnitt 10 |

## 4. Datenmodell (Entwurf)

```prisma
enum TimeEntrySource { CLOCK MANUAL }   // Stempeluhr oder Nachtrag

model TimeEntry {
  id           String          @id @default(uuid()) @db.Uuid
  employeeId   String          @db.Uuid
  workDate     DateTime        @db.Date          // Arbeitstag = lokales Datum des Beginns (Europe/Berlin)
  startAt      DateTime        @db.Timestamptz(3)
  endAt        DateTime?       @db.Timestamptz(3) // null = läuft noch
  source       TimeEntrySource
  recordedAt   DateTime        @db.Timestamptz(3) // Erfassungszeitpunkt (Serverzeit)
  recordedById String          @db.Uuid           // wer erfasst hat (bei Nachtrag durch Vorgesetzte ≠ employeeId)
  reason       String?                            // Pflicht bei MANUAL
  voidedAt     DateTime?       @db.Timestamptz(3) // ungültig markiert, nie gelöscht
  breaks       TimeEntryBreak[]
  revisions    TimeEntryRevision[]
  @@index([employeeId, workDate])
}

model TimeEntryBreak {                          // Pausen als Zeiträume (12.2)
  id      String    @id @default(uuid()) @db.Uuid
  entryId String    @db.Uuid
  startAt DateTime  @db.Timestamptz(3)
  endAt   DateTime? @db.Timestamptz(3)          // null = Pause läuft
}

model TimeEntryRevision {                       // append-only, Trigger lehnt UPDATE/DELETE ab
  id          BigInt   @id @default(autoincrement())
  entryId     String   @db.Uuid
  changedAt   DateTime @default(now()) @db.Timestamptz(3)
  changedById String   @db.Uuid
  reason      String
  before      Json                               // Beginn, Ende, Pausen, ungültig
  after       Json
}

model MonthClosing {                            // nur falls 12.6 freigegeben
  employeeId    String   @db.Uuid
  month         String                           // JJJJ-MM
  confirmedAt   DateTime @db.Timestamptz(3)
  reopenedAt    DateTime? @db.Timestamptz(3)
  reopenedById  String?  @db.Uuid
  @@id([employeeId, month])
}
```

Constraints: Ende nach Beginn; Pausen innerhalb der Buchung und ohne Überlappung; höchstens eine offene Buchung je Person (partieller Unique-Index); `reason` Pflicht bei `MANUAL`; Buchung höchstens 24 Std. lang.

Das normale Fortschreiben durch die Stempeluhr (Pause, Gehen) ist keine Korrektur und erzeugt keine Revision. Jede Änderung bereits gesetzter Werte (Beginn, Ende, Pausen) und jede Ungültig-Markierung erzeugt eine Revision.

## 5. Regelbibliothek `libs/time-rules` (Phase-2-Umfang)

Reine Funktionen, Zeiten in Minuten bzw. als UTC-Zeitpunkte mit Berliner Kalendertag, gesetzliche Werte als Parameter.

| Funktion | Paragraf | Verhalten (Vorlage `entryFlags`) | Grenzwerttests |
| --- | --- | --- | --- |
| `netWorkMinutes(entry)` | – | Anwesenheit minus anrechenbare Pausen | Pausen über Mitternacht, laufende Pause |
| `checkMaxWorkingTime(dayMinutes)` | § 3 ArbZG | Verstoß über 10 Std., Hinweis über 8 Std. („Ausgleich nötig“) je Arbeitstag, Summe aller Buchungen des Tages | 480/481, 600/601 |
| `checkBreaks(entry)` | § 4 ArbZG | 30 Min. bei mehr als 6 Std., 45 bei mehr als 9; nur Pausen ab 15 Min. zählen; nicht länger als 6 Std. am Stück ohne Pause | 360/361, 540/541, Pause 14/15 Min., 6 Std. am Stück genau/darüber |
| `checkRestPeriod(prevEnd, nextStart)` | § 5 ArbZG | mindestens 11 Std. zwischen Ende des letzten und Beginn des nächsten Arbeitstags | 660/659 Min., Sommerzeitwechsel |
| `checkSundayHoliday(workDate, holidays)` | §§ 9, 10 ArbZG | Hinweis „Sonntagsarbeit“ bzw. „Feiertagsarbeit“ | Sonntag, Feiertag, Feiertag am Sonntag |
| `checkMinijobRecording(workDate, recordedAt)` | § 17 Abs. 1 MiLoG | Verstoß, wenn erst nach dem 7. Kalendertag aufgezeichnet (ab Tag 8) | Tag 7 / Tag 8 in Berliner Zeit |
| `minijobMonth(minutes, wageCents, limitCents)` | § 8 Abs. 1a SGB IV | Verdienst, Anteil an der Grenze, Stufe ok / ab 90 % / über 100 % wie `meterHtml` | 89,99 %, 90 %, 100 %, 100,01 % |
| `targetMinutesForDay(terms, date, holidays)` | Konzept 4.1 | Soll am Arbeitstag laut Vertragsstand an diesem Datum, 0 an Feiertagen und freien Tagen, `null` bei Minijob | Vertragswechsel mitten in der Woche |
| `lateInfo(entry)` | Konzept 4.1 | Nachtrag: Tage Verzug bzw. Minuten nach Beginn am selben Tag | gleicher Tag, Folgetag |

Meldungen mit Code, deutschem Text wie im Prototyp und Paragraf, Stufen `crit`, `warn`, `info`.

## 6. Abläufe

### 6.1 Stempeluhr (nur für sich selbst)
- **Kommen**: legt eine offene Buchung mit `startAt = jetzt` an. Gibt es schon eine offene, Fehler 409 „Du bist bereits eingestempelt.“
- **Pause beginnen / beenden**: legt eine Pause an bzw. schließt sie.
- **Gehen**: setzt `endAt = jetzt`, schließt eine laufende Pause, prüft die Regeln und gibt die Hinweise zurück (Toast wie im Prototyp).
- Nach „Gehen“ kann am selben Tag erneut „Kommen“ gewählt werden (12.1).
- Alle Aktionen serialisiert je Person, damit Doppelklicks keine zweite offene Buchung erzeugen.

### 6.2 Nachtrag
Datum, Kommen, Gehen (für heute optional, wenn noch da), Pausen als Zeiträume, Begründung Pflicht. `source = MANUAL`, `recordedAt = jetzt`. Kommen nicht in der Zukunft. Prüfung und Hinweise wie beim Stempeln.

### 6.3 Korrektur und Ungültig-Markierung
Ändert Beginn, Ende oder Pausen einer bestehenden Buchung bzw. markiert sie als ungültig, jeweils mit Pflichtbegründung und Revision. Wer das darf, siehe 12.4.

### 6.4 Wochenansicht
Je Tag: Buchungen mit Kommen, Gehen, Pause, Arbeitszeit, Soll, Saldo, Hinweise (Regeln und Nachtrag-Markierung). Tage ohne Buchung: Feiertag, frei laut Vertrag, oder „Keine Buchung“ bei vergangenem Arbeitstag. Summe der Woche. Minijob: kein Soll, dafür Monatsanzeige gegen die Grenze.

### 6.5 Heute
Wie Prototyp: Uhr, Status („Anwesend seit 08:02 Uhr“), Aktionen, heute gearbeitet, Woche (Ist, Soll, Saldo bis gestern) bzw. Monat bei Minijob, Hinweise der letzten 14 Tage. Vorgesetzte und Admin zusätzlich „Team heute“: anwesend seit, gegangen, kein Arbeitstag, noch nicht gestempelt (ohne „erwartet gegen“, das kommt mit Phase 5).

## 7. Rechte

| Aktion | Mitarbeiter | Vorgesetzte/r | Admin |
| --- | --- | --- | --- |
| Stempeln | nur sich | nur sich | nur sich |
| Eigene Zeiten lesen | ja | ja | ja |
| Zeiten anderer lesen | nein | eigenes Team | alle |
| Nachtrag für sich | ja | ja | ja |
| Nachtrag für andere | nein | eigenes Team (12.5) | alle (12.5) |
| Korrektur / ungültig | siehe 12.4 | siehe 12.4 | siehe 12.4 |
| Team heute | nein | eigenes Team | alle |

Alle Abfragen laufen über den zentralen Filter aus Phase 1; fremde Buchungen ergeben 404.

## 8. API-Routen (Präfix `/api`)

| Methode und Pfad | Mitarbeiter | Vorgesetzte/r | Admin |
| --- | --- | --- | --- |
| `GET /time/today` | eigene | eigene | eigene |
| `POST /time/clock/in`, `/time/clock/break-start`, `/time/clock/break-end`, `/time/clock/out` | eigene | eigene | eigene |
| `GET /time/week?employeeId&week=JJJJ-Www` | eigene | Team, sonst 404 | alle |
| `GET /time/month?employeeId&month=JJJJ-MM` (Minijob-Stunden, Verdienst, Grenze) | eigene | Team | alle |
| `POST /time/entries` (Nachtrag) | für sich | für sich und Team (12.5) | alle (12.5) |
| `POST /time/entries/:id/correct` | 12.4 | 12.4 | 12.4 |
| `POST /time/entries/:id/void` | 12.4 | 12.4 | 12.4 |
| `GET /time/entries/:id/revisions` | eigene | Team | alle |
| `GET /time/team-today` | 403 | Team | alle |
| `POST /time/months/:month/close` und `GET /time/months` (falls 12.6) | eigene | eigene | eigene |
| `POST /time/months/:employeeId/:month/reopen` (falls 12.6) | 403 | 403 | ja |

Die Zugriffsmatrix aus Phase 1 wird um jede neue Route mit allen fünf Akteuren erweitert.

## 9. Web

- Navigation: „Heute“ ersetzt „Start“; neu „Zeiten“ für alle. Der Vertragsüberblick der bisherigen Startseite wandert ins Profil.
- „Heute“ und „Zeiten“ wie im Prototyp, Texte von dort. Zeiten in Mono, Hinweise als Pillen mit Paragraf, Nachträge als markierte Pille mit Begründung als Tooltip.
- Die Uhr im Browser ist nur Anzeige; die gebuchte Zeit kommt vom Server und wird nach jeder Aktion neu geladen.

## 10. Teststrategie und Abnahme

- Unit: jede Regel mit Grenzwerten und Paragraf im `describe`-Titel; Sommerzeitwechsel (29.03. und 25.10.2026).
- Integration: Stempelabläufe mit gestellter Uhr, parallele Klicks, Nachtrag mit und ohne Ende, Korrektur mit Revision, Revisionen unveränderlich, Sichtbarkeit, Zugriffsmatrix.
- E2E: Kommen, Pause, Gehen als Mitarbeiter; Nachtrag mit Begründung erscheint markiert; Verstoß (z. B. fehlende Pause) wird angezeigt, Buchung trotzdem gespeichert; Vorgesetzte sieht Team heute, Mitarbeiter nicht.
- Abnahme: Buchungen gehen nie verloren und jede Änderung ist im Verlauf nachvollziehbar; Verstöße blockieren nicht; Mitarbeiter sehen keine Zeiten anderer (Tests); CI grün.

## 11. Gesetzliche Werte

Keine neuen Schlüssel. Minijob-Grenze und Mindestlohn kommen aus `LegalParameter` am jeweiligen Monat bzw. Arbeitstag.

## 12. Entscheidungen (12.10.2026)

1. **Mehrere Buchungen je Tag**: ja. Höchstarbeitszeit und Pausen zählen über den ganzen Tag, die Ruhezeit vom letzten Ende des Vortags.
2. **Pausen als Zeiträume**: ja, auch im Nachtrag („Pause von–bis“, eine oder mehrere). Pausen unter 15 Min. zählen nicht als Ruhepause (§ 4 ArbZG). Sie zählen als Arbeitszeit (§ 2 ArbZG); vom Auftraggeber bestätigt am 13.10.2026.
3. **Über Mitternacht**: ja. Die Buchung zählt zum Tag des Beginns, höchstens 24 Std.
4. **Korrekturen: Variante B.** Korrekturen und Ungültig-Markierungen durch die betroffene Person sind Anträge (`TimeCorrectionRequest`) und gelten erst nach Freigabe durch ihre Vorgesetzte bzw. ihren Vorgesetzten oder den Admin; bis dahin bleibt der alte Wert. Ablehnung nur mit Begründung, offene Anträge kann die Person zurückziehen. Korrekturen durch Vorgesetzte (für ihr Team) und Admin (für alle) gelten sofort. Der Admin hat keinen Vorgesetzten; seine eigenen Korrekturen gelten sofort. Nachträge fehlender Zeiten brauchen keine Freigabe, sie sind nur markiert. Rechte der Vertretung folgen in Phase 3.
5. **Nachtrag für andere**: ja, Vorgesetzte für ihr Team, Admin für alle („Nachtrag durch …“).
6. **Monatsabschluss**: ja. Nach der Bestätigung keine eigenen Nachträge, Korrekturanträge oder Stempelungen mehr für diesen Monat; Vorgesetzte und Admin weiterhin mit Begründung; der Admin kann den Monat wieder öffnen.
7. **Überstundenkonto je Mitarbeiter aktivierbar**: Der Admin aktiviert es ab einem Stichtag (und kann es beenden). Saldo = Summe aus Ist minus Soll je Tag vom Stichtag bis einschließlich gestern (nur gültige Buchungen); der laufende Tag zählt ab dem Folgetag. (Vom Auftraggeber bestätigt am 13.10.2026.) Korrekturbuchungen zählen ab ihrem Wirksamkeitsdatum und nicht vor Kontobeginn. Der Admin kann Korrekturbuchungen mit Begründung erfassen (z. B. Auszahlung, Übernahme eines Altsaldos), append-only. Nicht für Minijob (kein Soll). Ohne aktiviertes Konto nur Wochen- und Monatssaldo. Freie Tage zum Überstundenabbau kommen als Abwesenheitsart in Phase 3.
8. **Ausgleich über 6 Monate**: in Phase 2 nur der Tageshinweis, Durchschnittsprüfung in Phase 4.
9. **Wie weit zurück**: beliebig weit, nicht vor dem Eintritt, nicht in abgeschlossene Monate, nie in die Zukunft.
10. **Uhrzeit-Hinweis**: ja, ab 2 Min. Abweichung zwischen Gerät und Server, rein informativ.

### Ergänzungen am Datenmodell durch die Entscheidungen

```prisma
enum CorrectionKind { CORRECT VOID }
enum CorrectionStatus { PENDING APPROVED REJECTED WITHDRAWN }

model TimeCorrectionRequest {
  id             String           @id @default(uuid()) @db.Uuid
  entryId        String           @db.Uuid
  kind           CorrectionKind
  proposed       Json?            // Beginn, Ende, Pausen bei CORRECT
  reason         String
  requestedById  String           @db.Uuid
  requestedAt    DateTime         @db.Timestamptz(3)
  status         CorrectionStatus @default(PENDING)
  decidedById    String?          @db.Uuid
  decidedAt      DateTime?        @db.Timestamptz(3)
  decisionReason String?          // Pflicht bei Ablehnung
}

model OvertimeAdjustment {          // append-only
  id          String   @id @default(uuid()) @db.Uuid
  employeeId  String   @db.Uuid
  minutes     Int                   // positiv oder negativ
  effectiveOn DateTime @db.Date
  reason      String
  createdById String   @db.Uuid
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
}

// Employee: overtimeAccountSince DateTime? @db.Date (null = kein Konto)
```

Zusätzliche Routen: `GET /time/corrections` (eigene, für Vorgesetzte das Team, Admin alle), `POST /time/corrections/:id/approve|reject|withdraw`, `GET /time/overtime?employeeId`, `PUT /employees/:id/overtime-account` (Admin), `POST /employees/:id/overtime-adjustments` (Admin). Web: Korrekturanträge auf „Zeiten“, Freigaben für Vorgesetzte (Menüpunkt „Freigaben“ mit Zähler), Überstundenkonto in „Heute“ und im Mitarbeiterformular.

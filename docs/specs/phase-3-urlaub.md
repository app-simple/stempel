# Spezifikation Phase 3: Urlaub

Stand: 13.10.2026 · Status: **freigegeben am 13.10.2026** mit den Entscheidungen in Abschnitt 12
Grundlage: `docs/KONZEPT.md` (Abschnitte 2, 3, 4.2, 4.3, 4.4, 5), `CLAUDE.md`, `prototype/index.html` (Ansichten „Mein Urlaub“, „Genehmigungen“, „Urlaubsübersicht“, Funktionen `leaveDays`, `account`, `leavePreview`, `overlaps`, `anonRow`, `soll`), Phasen 1 und 2 (`docs/specs/`)
Branch: `phase-3-urlaub`, aufbauend auf `main` (Phasen 1 und 2 gemergt)

## 1. Ziel

Beschäftigte beantragen Urlaub für einen Zeitraum. Gezählt werden nur ihre Arbeitstage laut Vertrag ohne Feiertage. Die Vorgesetzte bzw. der Vorgesetzte genehmigt oder lehnt mit Begründung ab; bei Abwesenheit entscheidet die Vertretung. Urlaubskonten zeigen Anspruch, Übertrag, Genehmigt, Beantragt und Rest. Eine Urlaubsübersicht zeigt Kalender, Liste und Konten nach Rolle, Mitarbeiter sehen von Kollegen nur die Anzahl der Abwesenden. Beteiligte werden per E-Mail benachrichtigt. Genehmigter Urlaub setzt in der Zeiterfassung das Soll auf null.

Neben Urlaub gibt es Überstundenabbau und Sonderurlaub als Abwesenheitsarten (12.1).

Nicht in Phase 3: jährlicher Urlaubshinweis und Verfall (`LeaveNotice`, Phase 4), Prüfseite und Export (Phase 4), Krankmeldungen (Konzept 7 offen), Erinnerungen (Phase 5).

## 2. Feste Regeln aus CLAUDE.md und Konzept

- Gezählt werden nur Arbeitstage laut dem am jeweiligen Tag gültigen Vertragsstand, ohne Feiertage (§ 3 BUrlG, `countLeaveDays`).
- Ablehnung nur mit Begründung, die der Mitarbeiter sieht (§ 7 Abs. 1 BUrlG). Die Entscheiderin sieht Überschneidungen im Team und das Urlaubskonto.
- Offene Anträge kann der Mitarbeiter zurückziehen. Genehmigten Urlaub storniert nur die Vorgesetzte mit Einverständnis des Mitarbeiters.
- Datensparsamkeit: Mitarbeiter sehen von Kollegen keine Namen, keine offenen Anträge, keine Konten, nur die Anzahl der Abwesenden im eigenen Team je Tag. Vorgesetzte sehen ihr Team mit Namen, der Admin alle.
- Abwesenheitsgründe erscheinen in keinem Kalender: Der Kalender zeigt nur „abwesend“ bzw. „beantragt“, nie die Art.
- Rechteprüfung im Backend über den zentralen Filter; fremde Anträge ergeben 404. Jede neue Route kommt mit allen fünf Akteuren in die Zugriffsmatrix.
- Konten und Korrekturen sind nachvollziehbar: Entscheidungen und Korrekturbuchungen werden nie geändert oder gelöscht (append-only wie `AuditLog`). Zusatzurlaub bleibt eine Zahl ohne Grund.
- Keine personenbezogenen Daten in Logs. E-Mails gehen nur an die Anmeldeadresse der betroffenen Personen.
- Datumswerte als lokales Datum in Europe/Berlin.

## 3. Arbeitspakete

| AP | Inhalt | Wer | Abnahme |
| --- | --- | --- | --- |
| 1 | Prisma-Schema und Migration: `LeaveRequest`, `LeaveLedgerEntry`; Constraints, keine überlappenden aktiven Anträge je Person (Exclusion Constraint), Schutz gegen Löschen und Ändern abgeschlossener Daten | Claude, Review Codex | Migration läuft, Überschneidung auch bei parallelen Anträgen unmöglich |
| 2 | `libs/time-rules`: Signaturen und Typen (Claude), Implementierung und Grenzwerttests (Codex) | Claude + Codex | Abschnitt 5, jede Regel mit Paragraf und Grenzwerten |
| 3 | API Urlaub: Vorschau, Antrag, Zurückziehen, Genehmigen, Ablehnen, Stornierung, Konto, Liste, Kalender, Vertretung, Korrekturbuchungen | Claude, Review und Zusatztests Codex | Zugriffsmatrix um alle neuen Routen erweitert |
| 4 | Zeiterfassung: Soll null bzw. halbiert an Urlaubstagen, keine „Keine Buchung“, Team heute „abwesend“, Überstundenabbau im Saldo | Claude | Integrationstests Woche, Monat, Überstundenkonto |
| 5 | E-Mail-Benachrichtigungen und tägliche Meldung überfälliger Anträge an den Admin | Claude | Integrationstest mit Mailpit, Lauf nur einmal je Tag auch bei mehreren Instanzen |
| 6 | Web „Mein Urlaub“ und Urlaubsanträge in „Freigaben“ | Claude (Freigaben), Codex nach Vorgabe („Mein Urlaub“) | Komponententests |
| 7 | Web „Urlaubsübersicht“ (Kalender, Liste, Konten), Kacheln auf „Heute“, Rest und Korrekturbuchung bei den Mitarbeitern | Codex nach Vorgabe | Komponententests, Datenschutz der Mitarbeiteransicht |
| 8 | Seed: Anträge wie im Prototyp (genehmigt, offen, abgelehnt) | Codex | idempotent, nur Entwicklung |
| 9 | E2E-Abnahme, README, Codex-Review | Claude | Abschnitt 10 |

## 4. Datenmodell (Entwurf)

Tage werden intern in halben Tagen gezählt (`halfDays`, ganze Zahl), damit halbe Urlaubstage ohne Rundungsfehler gehen. Angezeigt wird „2,5 Tage“.

```prisma
enum AbsenceType { VACATION OVERTIME_OFF SPECIAL_LEAVE } // Urlaub, Überstundenabbau, Sonderurlaub (12.1)
enum LeaveStatus { PENDING APPROVED REJECTED WITHDRAWN CANCELLED }
enum LeaveLedgerKind { CORRECTION FORFEIT }         // FORFEIT erst mit Phase 4

model LeaveRequest {
  id                String      @id @default(uuid()) @db.Uuid
  employeeId        String      @db.Uuid
  type              AbsenceType
  from              DateTime    @db.Date
  to                DateTime    @db.Date
  startHalf         Boolean     @default(false)   // erster Tag nur halb (12.2)
  endHalf           Boolean     @default(false)   // letzter Tag nur halb
  halfDays          Int                           // beim Antrag berechnet, zur Nachvollziehbarkeit (12.14)
  note              String?                       // freiwillig, höchstens 140 Zeichen; Hinweis: keine Gesundheitsangaben
  status            LeaveStatus @default(PENDING)
  requestedAt       DateTime    @db.Timestamptz(3)
  requestedById     String      @db.Uuid          // die Person selbst, ihre Vorgesetzte oder der Admin (12.6)
  decidedAt         DateTime?   @db.Timestamptz(3)
  decidedById       String?     @db.Uuid
  decisionReason    String?                       // Pflicht bei Ablehnung
  cancelRequestedAt DateTime?   @db.Timestamptz(3) // Einverständnis des Mitarbeiters zur Stornierung (12.9)
  cancelledAt       DateTime?   @db.Timestamptz(3)
  cancelledById     String?     @db.Uuid
  overdueNotifiedAt DateTime?   @db.Timestamptz(3) // Meldung an den Admin (12.12)
}

model LeaveLedgerEntry {                            // Korrekturbuchungen des Admins, append-only (12.10)
  id          String          @id @default(uuid()) @db.Uuid
  employeeId  String          @db.Uuid
  year        Int
  kind        LeaveLedgerKind
  halfDays    Int                                 // mit Vorzeichen
  note        String                              // neutraler Vermerk, keine Gesundheitsangaben
  createdAt   DateTime        @db.Timestamptz(3)
  createdById String          @db.Uuid
}
```

Constraints: `to >= from`; an einem eintägigen Antrag nicht zugleich `startHalf` und `endHalf`; Ablehnung mit nicht leerer Begründung; Entscheider ungleich Antragsteller außer beim Admin für sich selbst (12.8); keine zwei Anträge derselben Person mit Status `PENDING` oder `APPROVED`, deren Zeiträume sich überschneiden (`EXCLUDE USING gist` mit `daterange`, Erweiterung `btree_gist`). `LeaveLedgerEntry` per Trigger unveränderlich wie `AuditLog`. Anträge werden nie gelöscht; Statuswechsel landen zusätzlich im `AuditLog`.

Abweichung vom Konzept (Abschnitt 5, `LeaveLedgerEntry` mit Anspruch, Übertrag, Abzug, Korrektur, Verfall): Anspruch wird aus den Vertragsständen berechnet, Übertrag kommt aus `LeaveCarryOver` (Phase 1, Entscheidung 4), Abzug aus den genehmigten Anträgen. Gebucht werden nur Korrekturen und später Verfall. So gibt es keine zweite Wahrheit neben Vertrag und Anträgen.

## 5. Regelbibliothek `libs/time-rules` (Phase-3-Umfang)

| Funktion | Paragraf | Inhalt | Grenzwerte in Tests |
| --- | --- | --- | --- |
| `leaveHalfDays(request, termsAt, holidays)` | § 3 BUrlG, Konzept 4.2 | Arbeitstage laut Vertragsstand je Tag ohne Feiertage, in halben Tagen; halber erster bzw. letzter Tag zählt 1 statt 2, aber nur, wenn er ein Arbeitstag ist | eintägig ganz/halb, halber Tag an Feiertag, Vertragswechsel im Zeitraum, Jahreswechsel |
| `splitByYear(request, …)` | Konzept 4.4 | Tage eines Antrags je Kalenderjahr | Antrag 28.12.–05.01. |
| `annualEntitlement(year, terms, entryDate, exitDate)` | §§ 3, 4, 5 BUrlG | Jahresanspruch in halben Tagen nach Entscheidung 12.3: tagesgenauer Jahreswert über die Vertragsstände, im Ein- und Austrittsjahr gezwölftelt, gesetzliches Minimum nach §§ 4, 5 als Untergrenze, Rundung nach § 5 Abs. 2 | Eintritt 01.01./01.07./02.07./15.03., Austritt 30.06./01.07./31.12., Wechsel von 5 auf 3 Tage am Monatsersten und mitten im Monat, Schaltjahr, Untergrenze greift (Vertrag = Minimum, Eintritt 01.06.), Bruchteile 0,3/0,49/0,5 |
| `leaveAccount(parts)` | Konzept 4.4 | Rest = Anspruch + Übertrag + Korrekturen − Genehmigt − Beantragt (wie `account` im Prototyp); nur Art Urlaub | Rest genau 0, negativ (12.5) |
| `targetMinutesForDay(terms, date, holidays, absence)` (Erweiterung) | Konzept 4.1 | Urlaub und Sonderurlaub ganztägig: Soll 0, halber Tag: halbes Soll; Überstundenabbau: Soll bleibt | halber Tag mit ungerader Minutenzahl, Feiertag im Urlaub |
| `businessDaysBetween(from, to, holidays)` | Konzept 4.2 | Werktage Mo–Fr ohne Feiertage für die Meldung „länger als fünf Arbeitstage offen“ | genau 5 / 6, über Feiertag und Wochenende |

## 6. Abläufe

### 6.1 Antrag
1. Mitarbeiter wählt Art, ersten und letzten Tag, optional halben ersten bzw. letzten Tag und eine Notiz. Die Vorschau (Server) nennt die gezählten Arbeitstage, nicht gezählte Feiertage und den Rest danach, wie `leavePreview` im Prototyp: „5 Arbeitstage Urlaub. Rest danach: 13 Tage. Nicht gezählt: Allerheiligen (01.11.).“
2. Abgelehnt wird: Zeitraum ohne Arbeitstag („In diesem Zeitraum liegt keiner deiner Arbeitstage.“), Beginn vor heute (außer beim Eintragen durch Vorgesetzte oder Admin, 12.6), Überschneidung mit eigenem offenem oder genehmigtem Antrag („In diesem Zeitraum hast du schon einen Antrag.“), Zeitraum vor dem Eintritt oder nach dem Austritt, Überstundenabbau ohne aktives Überstundenkonto. Zu wenig Rest blockiert nicht: Vorschau und Antrag warnen „Das übersteigt dein Urlaubskonto.“, die Entscheiderin sieht den negativen Rest (12.5).
3. Der Antrag geht an die Vorgesetzte, bei deren Abwesenheit an die Vertretung (12.7), E-Mail an die Entscheider (12.13). Toast: „Antrag über 5 Tage an Tobias Lechner gesendet.“

### 6.2 Entscheidung
Genehmigen bucht ab und trägt in den Kalender ein. Vorgesetzte (für ihr Team) und Admin (für alle) können Abwesenheiten auch direkt eintragen, auch rückwirkend; sie gelten dann sofort als genehmigt und sind als „eingetragen durch …“ markiert (12.6). Ablehnen verlangt eine Begründung (mindestens 10 Zeichen, wie Prototyp: „Bitte den betrieblichen Grund nennen (mindestens ein Satz).“). Beide nur bei Status `PENDING`; parallele Entscheidungen: genau eine gewinnt (409 für die andere). Keine Entscheidung über eigene Anträge.

### 6.3 Zurückziehen und Stornieren
Offene Anträge zieht der Mitarbeiter zurück. Genehmigten Urlaub storniert nur die Vorgesetzte bzw. der Admin auf Wunsch des Mitarbeiters (12.9).

### 6.4 Konto
Je Kalenderjahr: Anspruch (berechnet), Übertrag (`LeaveCarryOver` des Jahres), Korrekturen, Genehmigt, Beantragt, Rest. Überstundenabbau und Sonderurlaub zählen nicht gegen das Urlaubskonto.

### 6.5 Urlaubsübersicht
- Kalender je Monat: Spalte je Tag; genehmigt, beantragt, Feiertag, Wochenende, kein Arbeitstag laut Vertrag unterscheidbar; keine Art der Abwesenheit. Mitarbeiter: eigene Zeile und Zeile „Im Team abwesend“ mit der Anzahl genehmigter Abwesenheiten der Kollegen mit derselben Vorgesetzten (einschließlich dieser), nur an deren Arbeitstagen, ohne Namen und ohne offene Anträge. Vorgesetzte: Zeile je Person ihres Teams (einschließlich sich selbst). Admin: alle.
- Liste: Anträge mit Art, Zeitraum, Tagen, Status, Entscheider; Filter nach Person und Status; Mitarbeiter nur eigene.
- Konten: Mitarbeiter nur eigenes, Vorgesetzte ihr Team, Admin alle.

### 6.6 Auswirkungen auf die Zeiterfassung
An genehmigten Urlaubs- und Sonderurlaubstagen ist das Soll 0, an halben Tagen halbiert; „Keine Buchung“ entfällt; in „Zeiten“ steht „Urlaub“, „Sonderurlaub“ bzw. „Überstundenabbau“ (eigene Daten bzw. Team, kein Kalender). Buchungen an Urlaubstagen bleiben möglich und erhalten einen Info-Hinweis „Buchung an einem Urlaubstag“. „Team heute“ zeigt „abwesend“ ohne Grund. Überstundenabbau lässt das Soll stehen und senkt damit den Saldo.

## 7. Rechte

| Aktion | Mitarbeiter | Vorgesetzte/r | Vertretung (12.7) | Admin |
| --- | --- | --- | --- | --- |
| Eigenen Antrag stellen, zurückziehen, Stornierung erbitten | ja | ja | ja | ja (12.8) |
| Abwesenheit für andere eintragen (direkt genehmigt) | nein | eigenes Team (12.6) | nein | alle (12.6) |
| Anträge anderer sehen | nein | eigenes Team | vertretene Personen, solange die Vorgesetzte abwesend ist | alle |
| Genehmigen, ablehnen, Stornierung bestätigen | nein | eigenes Team, nie eigene | wie Spalte „sehen“ | alle, nie eigene außer 12.8 |
| Konto sehen | eigenes | Team | vertretene Personen während der Vertretung | alle |
| Kalender | eigene Zeile + Anzahl | Team mit Namen | eigene Rolle | alle |
| Korrekturbuchung | nein | nein | nein | ja |

## 8. API-Routen (Präfix `/api`)

| Methode und Pfad | Mitarbeiter | Vorgesetzte/r | Admin |
| --- | --- | --- | --- |
| `GET /leave/preview?type&from&to&startHalf&endHalf[&employeeId]` | eigene | eigene und Team | alle |
| `POST /leave/requests` | für sich | für sich und Team (12.6) | für sich und alle (12.6) |
| `GET /leave/requests?employeeId&status&year` | eigene | Team (+ Vertretung) | alle |
| `POST /leave/requests/:id/withdraw` | eigene offene | eigene offene | eigene offene |
| `POST /leave/requests/:id/approve`, `/reject` | 403 | Team (+ Vertretung), nicht eigene | alle |
| `POST /leave/requests/:id/cancellation` (Stornierung erbitten) | eigene genehmigte vor Beginn | dto. | dto. |
| `POST /leave/requests/:id/cancellation/approve`, `/reject` | 403 | Team (+ Vertretung) | alle |
| `GET /leave/account?employeeId&year` | eigenes | Team (+ Vertretung) | alle |
| `GET /leave/accounts?year` | 403 | Team | alle |
| `GET /leave/calendar?month=JJJJ-MM` | eigene Zeile + Anzahl | Team | alle |
| `GET /employees/:id/leave-ledger`, `POST /employees/:id/leave-ledger` | 403 | 403 | ja |

Fremde Anträge und Konten ergeben 404, Rollenfehler 403. Die Zugriffsmatrix wird um jede Route mit allen fünf Akteuren erweitert, dazu Tests für Vertretung vor, während und nach der Abwesenheit der Vorgesetzten.

## 9. Web

- Navigation wie Prototyp: neu „Mein Urlaub“ (alle) und „Urlaubsübersicht“ (alle). „Freigaben“ (Vorgesetzte, Admin, Vertretung während der Vertretung) bündelt Urlaubsanträge, Stornierungen und Korrekturanträge; der Zähler summiert alle entscheidbaren offenen Anträge.
- „Mein Urlaub“: Kontokacheln, Antragsformular mit Art, Live-Vorschau und Warnung bei zu wenig Rest, „Meine Anträge“ mit Status, Entscheidung und Begründung, Zurückziehen bzw. Stornierung erbitten.
- Vorgesetzte und Admin tragen in der Urlaubsübersicht (Liste) Abwesenheiten für ihr Team bzw. alle ein.
- „Freigaben“: je Antrag Name, Funktion, Zeitraum, Tage, gestellt am, „seit N Tagen offen“ ab mehr als fünf Arbeitstagen, Notiz, Konto nach Genehmigung, Überschneidungen im Team mit Namen und Status; „Zuletzt entschieden“.
- „Urlaubsübersicht“: Tabs Kalender, Liste, Urlaubskonten wie Prototyp, Legende, Datenschutzhinweis für Mitarbeiter.
- „Heute“: Kacheln „Resturlaub 2026“ und „Beantragt“.
- „Mitarbeiter“ (Admin): Spalte Rest; im Formular Korrekturbuchungen mit Vermerk und Vorschlag für den Übertrag ins Folgejahr (12.4).
- Texte aus dem Prototyp. Fokusführung und Tastaturbedienung wie in Phase 2.

## 10. Teststrategie und Abnahme

- Unit: jede Regel mit Grenzwerten und Paragraf im `describe`-Titel.
- Integration: Antrag, Vorschau, parallele Anträge im selben Zeitraum (genau einer gewinnt), parallele Entscheidungen, Zurückziehen, Stornierung, Konto mit Ein- und Austritt, Vertretung, Sichtbarkeit des Kalenders (Mitarbeiter sieht keine Namen und keine offenen Anträge anderer, Antwort enthält keine fremden IDs), Soll in Woche und Überstundenkonto, E-Mails in Mailpit, Meldung überfälliger Anträge genau einmal.
- E2E: Mitarbeiterin beantragt Urlaub mit Vorschau; Vorgesetzter sieht Überschneidung und lehnt ohne Begründung nicht ab, genehmigt dann; Mitarbeiterin sieht Rest und Kalender; Kollegin sieht nur die Anzahl; E-Mail an den Vorgesetzten kommt an.
- Abnahme: Konten stimmen mit den Beispielen des Prototyps überein; Mitarbeiter sehen keine Namen oder Gründe anderer (Tests); CI grün.

## 11. Gesetzliche Werte

Keine neuen `LegalParameter`. Der gesetzliche Mindesturlaub folgt wie in Phase 1 aus § 3 BUrlG (4 Tage je Wochenarbeitstag) und ist eine Rechenregel, kein Jahreswert.

## 12. Entscheidungen (13.10.2026)

1. **Abwesenheitsarten**: Urlaub, Überstundenabbau und Sonderurlaub. Überstundenabbau nur bei aktivem Überstundenkonto; er zieht nicht vom Urlaubskonto ab, das Soll bleibt, der Saldo sinkt. Sonderurlaub setzt das Soll auf 0 und zieht nicht vom Urlaubskonto ab; der Anlass wird nicht gespeichert (nur die freiwillige Notiz mit Hinweis, keine Gesundheitsangaben einzutragen). Krankheit nicht in Phase 3.
2. **Halbe Tage**: erster und letzter Tag eines Antrags können halb sein; an einem halben Urlaubs- oder Sonderurlaubstag halbiert sich das Soll.
3. **Anspruch im Jahr**:
   a) Ein- und Austrittsjahr: immer gezwölftelt, ein Zwölftel je vollem Beschäftigungsmonat im Jahr, auch für den Vertragsurlaub über dem Minimum (Entscheidung des Auftraggebers; setzt eine entsprechende Vertragsklausel voraus, vor dem Go-live mit dem Steuerberater prüfen).
   b) Untergrenze: Der gesetzliche Mindesturlaub nach §§ 3, 4, 5 BUrlG wird nie unterschritten (z. B. Eintritt bis 01.07. mit erfüllter Wartezeit im Jahr: volles gesetzliches Minimum). Das Konto nimmt den höheren der beiden Werte.
   c) Wechsel der Vertragsstände im Jahr: tagesgenau, jeder Stand mit dem Anteil seiner Kalendertage im Jahr.
   d) Rundung: Bruchteile ab einem halben Tag auf einen ganzen Tag aufrunden (§ 5 Abs. 2 BUrlG), kleinere Bruchteile auf einen halben Tag zugunsten der Beschäftigten.
4. **Übertrag**: bleibt eine Zahl je Jahr, die der Admin am Mitarbeiter pflegt; das Formular schlägt den rechnerischen Rest des Vorjahres vor. Kein automatischer Übertrag, kein Verfall vor Phase 4.
5. **Konto reicht nicht**: erlaubt mit Warnung. Der Antrag geht durch, Vorschau und Entscheiderin zeigen den negativen Rest. Anträge ins Folgejahr zählen gegen den Anspruch des Folgejahrs, Anträge über den Jahreswechsel je Jahr.
6. **Eintragen für andere**: Vorgesetzte für ihr Team und Admin für alle, auch rückwirkend; direkt genehmigt, markiert als „eingetragen durch …“, nicht in abgeschlossene Monate, nicht für sich selbst (außer Admin, 12.8). Mitarbeiter beantragen ab heute.
7. **Vertretung**: `deputyId` am Mitarbeiter ist die Vertretung seiner Vorgesetzten. Hat die Vorgesetzte heute eine genehmigte Abwesenheit (Urlaub, Sonderurlaub oder Überstundenabbau), sieht und entscheidet die Vertretung Urlaubs- und Korrekturanträge dieser Person und sieht ihr Konto, aber keine Zeiten außerhalb des Antrags. Neue Anträge gehen dann per E-Mail an die Vertretung. Der Admin kann immer entscheiden.
8. **Eigene Anträge**: Anträge von Vorgesetzten gehen an deren Vorgesetzte. Der Urlaub des Admins gilt sofort als genehmigt und wird protokolliert.
9. **Stornierung**: Der Mitarbeiter erbittet sie vor Urlaubsbeginn (sein Einverständnis), Vorgesetzte oder Admin bestätigen, dann gehen die Tage zurück. Keine einseitige Stornierung, nach Beginn nur Korrekturbuchung durch den Admin, kein Kürzen in Phase 3.
10. **Korrekturbuchung**: Admin bucht halbe oder ganze Tage mit Vorzeichen auf ein Jahr, mit Pflichtvermerk; das Formular weist darauf hin, keine Gesundheitsangaben einzutragen (z. B. „Rückbuchung nach § 9 BUrlG“). Append-only.
11. **Navigation**: „Freigaben“ bündelt Urlaubs-, Stornierungs- und Korrekturanträge.
12. **Überfällige Anträge**: täglicher Lauf um 07:00 (Europe/Berlin), einmalige E-Mail je Antrag an den Admin, wenn er länger als fünf Arbeitstage (Mo–Fr ohne Feiertage) offen ist; Markierung in „Freigaben“. Datenbanksperre gegen doppelte Läufe.
13. **E-Mails**: minimal mit Name, Art, Zeitraum, Tagen und Link; Notiz und Ablehnungsgrund nur in der Anwendung.
14. **Neuberechnung**: Das Konto rechnet mit dem aktuellen Stand von Feiertagen und Vertrag; die beim Antrag berechnete Zahl bleibt gespeichert, der Antrag zeigt „neu berechnet: 4 statt 5 Tage“.
15. **Buchungen an Urlaubstagen**: erlaubt mit Info-Hinweis „Buchung an einem Urlaubstag“, blockiert nicht.

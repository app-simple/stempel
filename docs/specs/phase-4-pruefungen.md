# Spezifikation Phase 4: Prüfungen und Nachweise

Stand: 13.10.2026 · Status: **freigegeben am 13.10.2026**, alle Vorschläge in Abschnitt 12 bestätigt
Grundlage: `docs/KONZEPT.md` (Abschnitte 2, 3, 4.5, 5), `CLAUDE.md`, `prototype/index.html` (Ansicht „Prüfungen“: `vPruef`, `allFlags`, `meterHtml`, Urlaubshinweis), Phasen 1 bis 3 (`docs/specs/`)
Branch: `phase-4-pruefungen`, aufbauend auf `main` (Phasen 1 bis 3 gemergt)

## 1. Ziel

Alle Regelverstöße und Fristen an einer Stelle: eine Prüfseite für Vorgesetzte (eigenes Team) und Admin (alle) mit Verstößen gegen ArbZG und MiLoG, fehlenden Buchungen, dem Ausgleich nach § 3 ArbZG über sechs Monate, der Auslastung der Minijob-Grenze und dem Stand der jährlichen Urlaubshinweise. Dazu der Urlaubshinweis in Textform mit Protokoll und Lesebestätigung, der Verfall von Resturlaub nach Hinweis, der Export je Mitarbeiter und Monat als PDF und CSV und ein Löschjob nach Aufbewahrungsfristen.

Nicht in Phase 4: Auswertung der Nachträge und Erinnerungen (Phase 5, `docs/PROMPT-ERINNERUNGEN.md`; die Prüfseite bekommt den Abschnitt „Nachträge“ dann dort), Schnittstelle zur Lohnabrechnung (Konzept 1: nur Export).

## 2. Feste Regeln aus CLAUDE.md und Konzept

- Prüfungen blockieren nichts; sie zeigen und protokollieren.
- Sichtbarkeit wie bisher: Vorgesetzte nur ihr Team, Admin alle, Rechteprüfung im Backend, jede neue Route in der Zugriffsmatrix.
- Gesetzliche Werte nur aus `LegalParameter`; Fristen und Schwellen mit Paragraf in `libs/time-rules`, jede Regel mit Grenzwerttests.
- Resturlaub verfällt nur nach konkretem Hinweis des Arbeitgebers in Textform (§ 7 Abs. 3 BUrlG, BAG 9 AZR 423/16). Ohne Hinweis kein Verfall.
- Exporte sind ohne das Tool lesbar, enthalten keine Anmeldeadressen und keine Abwesenheitsgründe über die Art hinaus.
- Löschung nur über den Löschjob nach festen Fristen; Buchungen und Revisionen bleiben bis dahin unveränderlich. Keine personenbezogenen Daten in Logs.

## 3. Arbeitspakete

| AP | Inhalt | Wer | Abnahme |
| --- | --- | --- | --- |
| 1 | Schema und Migration: `LeaveNotice`, Aufbewahrungseinstellungen, Datenbankfunktion für die Löschung trotz Schutz-Triggern | Claude, Review Codex | Migration läuft, Löschen nur über die Funktion |
| 2 | `libs/time-rules`: Ausgleich § 3 ArbZG über den Ausgleichszeitraum, Fristen des Urlaubsverfalls, Aufbewahrungsfristen (Signaturen Claude, Implementierung und Grenzwerttests Codex) | Claude + Codex | Abschnitt 5 |
| 3 | API Prüfungen: Feststellungen, Ausgleich, Minijob-Monate, Urlaubshinweise je Person im Sichtbereich | Claude | Zugriffsmatrix, Integrationstests |
| 4 | Urlaubshinweis: Text, Versand per E-Mail, Anzeige in „Mein Urlaub“ mit Lesebestätigung, Protokoll; Verfall nach Entscheidung 12.3 | Claude | Integrationstests, Mail in Mailpit |
| 5 | Export PDF und CSV je Mitarbeiter und Monat | Claude (Rechte, Inhalt), Codex (Layout nach Vorgabe) | Inhalt gegen Wochenansicht geprüft |
| 6 | Löschjob und technische Aufräumarbeiten | Claude | Tests mit gestellter Uhr, nichts vor Fristende gelöscht |
| 7 | Web „Prüfungen“, Hinweis in „Mein Urlaub“, Export-Buttons in „Zeiten“ | Codex nach Vorgabe, Claude prüft | Komponententests |
| 8 | E2E-Abnahme, README, Betriebsdoku, Codex-Review | Claude | Abschnitt 10 |

## 4. Datenmodell (Entwurf)

```prisma
model LeaveNotice {                 // Konzept 5: Mitarbeiter, Jahr, Text, versendet am, gelesen am
  id          String    @id @default(uuid()) @db.Uuid
  employeeId  String    @db.Uuid
  year        Int                   // Urlaubsjahr, auf das sich der Hinweis bezieht
  restHalfDays Int                  // Rest zum Zeitpunkt des Hinweises
  forfeitsOn  DateTime  @db.Date    // genannter Verfallstag
  text        String                // versendeter Wortlaut (Textform)
  sentAt      DateTime  @db.Timestamptz(3)
  sentById    String    @db.Uuid
  readAt      DateTime? @db.Timestamptz(3)   // Lesebestätigung durch die Person
  @@index([employeeId, year])
}
```

Append-only bis auf `readAt` (Trigger). Ein neuer Hinweis im selben Jahr ist erlaubt (z. B. nach Korrektur), es zählt der letzte vor dem Verfallstag. Verfall wird als `LeaveLedgerEntry` der Art `FORFEIT` gebucht (Phase 3 vorbereitet). Aufbewahrungsfristen in `CompanySettings` (Entscheidung 12.6).

## 5. Regelbibliothek (Phase-4-Umfang)

| Funktion | Paragraf | Inhalt |
| --- | --- | --- |
| `averageWorkday(days, period)` | § 3 ArbZG | Durchschnitt der Arbeitszeit je Werktag im Ausgleichszeitraum (Entscheidung 12.7); Hinweis über 480 Minuten |
| `forfeitureDates(year, carried)` | § 7 Abs. 3 BUrlG | Verfallstage: Ende des Urlaubsjahres bzw. 31.03. des Folgejahres für übertragene Tage |
| `noticeIsTimely(notice, forfeitsOn)` | § 7 Abs. 3 BUrlG, BAG 9 AZR 423/16 | Hinweis vor dem Verfallstag mit Nennung von Resttagen und Verfallstag |
| `retentionEnds(category, date, settings)` | § 16 Abs. 2 ArbZG, § 17 Abs. 1 MiLoG, steuerliche Fristen | Ende der Aufbewahrung je Datenart |

## 6. Abläufe

### 6.1 Prüfseite
Kacheln wie Prototyp: „Verstöße ArbZG / MiLoG“ (crit), „Hinweise“ (warn), „Minijob über 90 %“, „Urlaubshinweis fehlt“. Abschnitte: Arbeitszeit (Feststellungen der letzten sechs Wochen je Tag und Person, mit Paragraf; dazu „Keine Buchung an einem Arbeitstag“ als Hinweis zur Erfassungspflicht), Ausgleich § 3 ArbZG je Person, Minijob-Grenze (laufender und Vormonat je Minijobber), Urlaubshinweis (Rest, Status „versendet am … / gelesen am … / fehlt“, Buttons für den Admin). Zeitraum wählbar (Entscheidung 12.1).

### 6.2 Urlaubshinweis
Der Admin sendet je Person oder an alle ohne Hinweis. Text (Entscheidung 12.2): „Hallo {Name}, du hast für {Jahr} noch {Rest} Urlaubstage. Bitte beantrage sie so, dass du sie bis zum 31.12.{Jahr} nehmen kannst. Nicht genommener Urlaub verfällt am 31.12.{Jahr}; soweit er ausnahmsweise übertragen wird, verfällt er am 31.03.{Jahr+1}. …“ Versand per E-Mail an die Anmeldeadresse, Anzeige in „Mein Urlaub“ mit „Gelesen“. Gespeichert wird der genaue Wortlaut.

### 6.3 Verfall
Nach Entscheidung 12.3.

### 6.4 Export
Je Mitarbeiter und Monat: Tage mit Beginn, Ende, Pausen, Arbeitszeit, Soll, Saldo, Art der Abwesenheit, Nachtrag-Markierung mit Erfassungszeitpunkt und Grund, Hinweise mit Paragraf, Summen; bei Minijob Stunden × Lohn gegen die Grenze; Stand des Exports und Hinweis auf Änderungen (Revisionen). Format nach Entscheidung 12.4, Umfang nach 12.5.

### 6.5 Löschjob
Täglich; löscht nach Entscheidung 12.6. Technisch immer: abgelaufene Sitzungen, Anmeldecodes, WebAuthn-Challenges und Rate-Limit-Einträge nach einem Tag.

## 7. Rechte

| Aktion | Mitarbeiter | Vorgesetzte/r | Admin |
| --- | --- | --- | --- |
| Prüfseite | nein | eigenes Team | alle |
| Urlaubshinweis senden | nein | nein | ja |
| Eigenen Hinweis lesen und bestätigen | ja | ja | ja |
| Verfall buchen | nein | nein | ja (12.3) |
| Export eigener Monat | ja | ja | ja |
| Export anderer | nein | eigenes Team | alle |
| Aufbewahrung einstellen | nein | nein | ja |

## 8. API-Routen (Präfix `/api`, Entwurf)

`GET /checks?from&to`, `GET /checks/compensation`, `GET /leave/notices?year`, `POST /leave/notices` (Admin, Person oder alle), `POST /leave/notices/:id/read` (eigene), `POST /leave/forfeitures` (Admin, nach 12.3), `GET /exports/time?employeeId&month&format=pdf|csv`, `GET/PATCH /settings/retention` (Admin).

## 9. Web

Navigation: „Prüfungen“ für Vorgesetzte und Admin. „Mein Urlaub“ zeigt erhaltene Hinweise mit „Gelesen“. „Zeiten“ bekommt „Monat exportieren (PDF/CSV)“. Einstellungen zur Aufbewahrung unter „Mitarbeiter“ bzw. einer Admin-Seite.

## 10. Teststrategie und Abnahme

- Unit: jede neue Regel mit Paragraf und Grenzwerten.
- Integration: Prüfseite je Rolle (Team-Grenzen), Hinweisversand mit Text und Protokoll, Lesebestätigung nur eigene, Verfall nur nach rechtzeitigem Hinweis, Export-Inhalte gegen die Wochenansicht, Löschjob mit gestellter Uhr (nichts vor Fristende), Zugriffsmatrix.
- E2E: Vorgesetzter sieht Feststellungen nur seines Teams; Admin sendet Urlaubshinweis, Mitarbeiter liest und bestätigt; Export eines Monats lädt eine Datei mit den Buchungen.

## 11. Gesetzliche Werte

Keine neuen `LegalParameter` für Mindestlohn oder Minijob-Grenze. Aufbewahrungsfristen sind Einstellungen (Entscheidung 12.6), weil sie teils von Steuerberater und Betrieb abhängen.

## 12. Entscheidungen (13.10.2026, alle wie vorgeschlagen)

1. **Prüfseite**: Vorgesetzte für ihr Team, Admin für alle, Mitarbeiter nicht; Standardzeitraum sechs Wochen, wählbar bis zwölf Monate.
2. **Urlaubshinweis**: Versand durch den Admin (einzeln oder „an alle ohne Hinweis“) per E-Mail und in der Anwendung mit Lesebestätigung; Text wie 6.2; die Prüfseite erinnert ab 1. Juli an fehlende Hinweise (geändert am 14.10.2026, vorher 1. Oktober: Für den Verfall zum 31.12. muss der Hinweis nach 3a bis 30.09. versendet sein). Kein automatischer Versand.
3. **Verfall**: kein automatischer Verfall. Der Admin bucht ihn nach dem Verfallstag auf der Prüfseite; das System schlägt die Tage vor und lässt die Buchung nur zu, wenn ein rechtzeitiger Hinweis für das Jahr vorliegt. Verfallstage: 31.12. für nicht übertragenen Rest, 31.03. des Folgejahres für übertragene Tage. Setzt der Admin einen Übertrag unter dem Rest ohne Hinweis, warnt das Formular.
4. **Exportformat**: PDF serverseitig (Bibliothek `pdfkit`, eingebaute Schriften, keine externen Dienste) und CSV (UTF-8 mit BOM, Semikolon, deutsches Zahlenformat).
5. **Exportumfang**: je Person und Monat für die Person selbst, Vorgesetzte (Team) und Admin; zusätzlich für den Admin ein Monatsexport aller als CSV für den Steuerberater.
6. **Aufbewahrung und Löschung**: Fristen als Einstellung des Admins, je Datenart (Zeitbuchungen samt Revisionen; Minijob-Zeiten als Lohnunterlagen; Urlaubsdaten; Protokoll). Vorschlag: Löschjob vorhanden, aber ausgeschaltet, bis der Steuerberater die Fristen bestätigt (Konzept 7). Mindestwert zwei Jahre (§ 16 Abs. 2 ArbZG, § 17 Abs. 1 MiLoG), Frist läuft ab Ende des Kalenderjahres.
7. **Ausgleich § 3 ArbZG**: Ausgleichszeitraum 24 Wochen rückwärts ab gestern; Durchschnitt der Arbeitszeit je Werktag (Mo–Sa ohne Feiertage); Tage mit genehmigter Abwesenheit zählen nicht als Ausgleichstage und fallen aus dem Nenner. Hinweis, wenn der Durchschnitt 8 Stunden übersteigt.
3a. **Rechtzeitig** (Nachfrage, entschieden am 13.10.2026): Ein Hinweis gilt als rechtzeitig, wenn er mindestens drei Monate vor dem Verfallstag versendet wurde. Der Hinweis für das Jahr Y nennt beide Verfallstage (31.12.Y für nicht übertragenen Rest, 31.03.Y+1 für übertragene Tage); er ist für den 31.12. rechtzeitig bei Versand bis 30.09.Y und für den 31.03. bei Versand bis 31.12.Y. Übertragene Tage gelten als zuerst genommen; was bis 31.03. nicht genommen ist, kann verfallen. Diese Auslegung vor dem Go-live arbeitsrechtlich prüfen lassen (Konzept, Vorbemerkung).
6a. **Voreinstellung der Fristen** (bis zur Bestätigung durch den Steuerberater, Löschjob aus): Zeitbuchungen 2 Jahre, Minijob-Zeiten als Lohnunterlagen 8 Jahre, Urlaubsdaten 3 Jahre, Protokoll 3 Jahre, jeweils ab Ende des Kalenderjahres; kein Wert unter 2 Jahren.
8. **Ausgeschiedene Mitarbeiter**: nach Ablauf aller Fristen werden Stammdaten anonymisiert („Ehemalige Person“), Protokolleinträge behalten nur die ID.

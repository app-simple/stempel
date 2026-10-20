# Spezifikation Phase 7: Jugendarbeitsschutz

Stand: 16.10.2026 · Status: **freigegeben am 16.10.2026**, einschließlich der Punkte in Abschnitt 11
Grundlage: `docs/KONZEPT.md` (Abschnitt 7, offene Frage „Minijobber unter 18“), `CLAUDE.md`, Gesetzestexte JArbSchG (§§ 2, 4, 5, 8, 11–19) und KindArbSchV (§ 2) von gesetze-im-internet.de (abgerufen am 16.10.2026), Entscheidungen des Auftraggebers vom 16.10.2026 (Abschnitt 12)
Branch: `phase-7-jugendarbeitsschutz`, aufbauend auf `main`

## 1. Ziel

Im Betrieb arbeitet mindestens eine Person unter 18. Die App kennt deshalb die Regeln für Jugendliche (15 bis 17 Jahre) und für Jugendliche unter Vollzeitschulpflicht. Sie prüft Buchungen gegen das Jugendarbeitsschutzgesetz, warnt vor einem Verstoß während der Arbeit und setzt den höheren Mindesturlaub als harte Grenze durch. Wie bei ArbZG und MiLoG blockiert kein Verstoß eine Buchung.

Nicht in Phase 7: Kinder unter 15 (Beschäftigung grundsätzlich verboten, § 5 Abs. 1; die App lässt Personen unter 15 nicht anlegen), Berufsschultage (§ 9) und Ausbildung, Branchenausnahmen (Gaststätten, Landwirtschaft, Schichtbetrieb) der §§ 14, 16, 17, ärztliche Untersuchungen (§§ 32 ff.), Einwilligung der Sorgeberechtigten.

Hinweis: Die Einordnung beruht auf dem Gesetzestext und ist keine Rechtsberatung. Insbesondere die Frage, ob eine Tätigkeit im Einzelfall zulässig ist, prüft der Betrieb.

## 2. Begriffe und Status

- **Jugendlich** (§ 2 Abs. 2): wer 15, aber noch nicht 18 Jahre alt ist. Bestimmt aus dem Geburtsdatum am jeweiligen Arbeitstag.
- **Vollzeitschulpflichtig** (§ 2 Abs. 3): für sie gelten die Regeln für Kinder. Nach § 2 KindArbSchV sind Büro- und IT-Tätigkeiten nicht unter den erlaubten Tätigkeiten; eine Beschäftigung ist daher nur in den **Schulferien** zulässig, höchstens **4 Wochen im Kalenderjahr** (§ 5 Abs. 4), dann mit den Regeln für Jugendliche (§§ 8–31).
- Der Status wird je Person vom Admin gepflegt: Geburtsdatum und „vollzeitschulpflichtig bis“ (Datum, optional). Beides sieht nur der Admin. Vorgesetzte sehen die Regelmeldungen mit Paragraf (und damit, dass Jugendschutz gilt), nie das Geburtsdatum.
- Ab dem 18. Geburtstag gelten wieder die Regeln für Erwachsene; Urlaub richtet sich nach dem Alter zu Beginn des Kalenderjahres (§ 19 Abs. 2).

## 3. Datenmodell

- `Employee.birthDate` (Datum, optional, nur Admin; Pflicht nur, wenn die Person unter 18 ist oder es werden kann – der Admin trägt es für Jugendliche ein).
- `Employee.fullTimeSchoolUntil` (Datum, optional, nur Admin): letzter Tag der Vollzeitschulpflicht.
- Neues Modell `SchoolHoliday` (Schulferien Bayern): Name, von, bis, aktiv; gepflegt vom Admin in „Feiertage“ (Abschnitt „Schulferien“), mit Vorlage der bayerischen Termine als Vorschlag zum Übernehmen. Keine personenbezogenen Daten.
- Datenbankregeln: Geburtsdatum nicht in der Zukunft; Personen unter 15 am Eintrittsdatum lassen sich nicht speichern (§ 5 Abs. 1).
- Löschung: Geburtsdatum und Schulpflichtdatum werden mit der Anonymisierung des Kontos gelöscht (Phase 4).

## 4. Regeln für Jugendliche (Hinweise, blockieren nicht)

Für Arbeitstage, an denen die Person jugendlich ist. Arbeitszeit ohne Pausen (§ 4 Abs. 1), Schichtzeit mit Pausen (§ 4 Abs. 2), Woche Montag bis Sonntag (§ 4 Abs. 4).

| Regel | Paragraf | Stufe |
| --- | --- | --- |
| Arbeitszeit über 8 Std. am Tag | § 8 Abs. 1 | Verstoß; bis 8,5 Std. nur Hinweis, wenn an einem anderen Arbeitstag derselben Woche unter 8 Std. gearbeitet wird und die Woche 40 Std. nicht übersteigt (§ 8 Abs. 2a) |
| Arbeitszeit über 40 Std. in der Woche | § 8 Abs. 1 | Verstoß |
| Pause zu kurz: über 4,5 bis 6 Std. mindestens 30 Min., über 6 Std. mindestens 60 Min.; als Pause zählen nur Unterbrechungen ab 15 Min. | § 11 Abs. 1 | Verstoß |
| Mehr als 4,5 Std. am Stück ohne Pause | § 11 Abs. 2 Satz 2 | Verstoß |
| Pause früher als 1 Std. nach Beginn oder später als 1 Std. vor Ende | § 11 Abs. 2 Satz 1 | Hinweis |
| Schichtzeit über 10 Std. | § 12 | Verstoß |
| Weniger als 12 Std. Freizeit seit dem Ende des Vortags | § 13 | Verstoß |
| Arbeit vor 6 Uhr oder nach 20 Uhr | § 14 Abs. 1 | Verstoß |
| Mehr als 5 Arbeitstage in der Woche | § 15 | Verstoß |
| Arbeit am Samstag | § 16 Abs. 1 | Verstoß |
| Arbeit am Sonntag | § 17 Abs. 1 | Verstoß |
| Arbeit an einem Feiertag oder am 24./31.12. nach 14 Uhr | § 18 Abs. 1 | Verstoß |

Die Regeln für Erwachsene (ArbZG) werden für Jugendliche nicht zusätzlich gemeldet, wo die Jugendregel strenger ist (keine doppelten Meldungen zu Pause und Höchstarbeitszeit).

## 5. Zusätzliche Regeln bei Vollzeitschulpflicht

| Regel | Paragraf | Stufe |
| --- | --- | --- |
| Arbeit außerhalb der Schulferien | § 2 Abs. 3, § 5 Abs. 1 und 4 JArbSchG, § 2 KindArbSchV | Verstoß |
| Mehr als 20 Arbeitstage (4 Wochen) im Kalenderjahr | § 5 Abs. 4 | Verstoß ab dem 21. Arbeitstag, Hinweis ab dem 16. |

Zusätzlich gelten die Regeln aus Abschnitt 4.

## 6. Mindesturlaub (harte Grenze)

- § 19 Abs. 2: mindestens 30 Werktage, wer zu Beginn des Kalenderjahres noch nicht 16 ist; 27 Werktage unter 17; 25 Werktage unter 18.
- Umrechnung wie beim BUrlG auf Arbeitstage: Werktage × Arbeitstage je Woche / 6, aufgerundet auf ganze Tage (zugunsten der Beschäftigten). Beispiel 5-Tage-Woche: 25 → 21, 27 → 23, 30 → 25.
- Ein Vertragsstand mit weniger Jahresurlaub lässt sich nicht speichern (wie die Regel aus CLAUDE.md); die Prüfung läuft je Kalenderjahr der Geltung des Vertragsstands. Wird das Geburtsdatum nachgetragen, zeigt die Mitarbeiterseite betroffene Vertragsstände als Fehler und verlangt eine Korrektur.
- Der Urlaubsanspruch im Konto nutzt den höheren Wert, wenn der Vertrag darunter liegt (wie das gesetzliche Minimum bei Erwachsenen, Phase 3 Entscheidung 3 b).

## 7. Vorwarnung während der Arbeit

- **Heute:** Für Jugendliche beim Einstempeln und solange eingestempelt: „Heute spätestens um {Uhrzeit} Feierabend“ (früheste Grenze aus 8 Std. Arbeitszeit, 10 Std. Schichtzeit und 20 Uhr bzw. 14 Uhr am 24./31.12.) und „Pause spätestens um {Uhrzeit}“ (4,5 Std. nach Beginn bzw. nach der letzten Pause ab 15 Min.).
- **Erinnerungen** (Kanäle aus Phase 5, nur an die Person, neutral, je Tag und Art höchstens einmal): 15 Minuten vor 4,5 Std. ohne Pause („Bitte mache bald eine Pause.“), 15 Minuten vor dem spätesten Feierabend („Bitte denke an deinen Feierabend.“).
- Gestempelt wird nie automatisch.

## 8. Oberfläche

- **Mitarbeiter (Admin):** Felder „Geburtsdatum“ und „Vollzeitschulpflichtig bis“ mit Erläuterung; Hinweis „Jugendarbeitsschutz gilt bis {18. Geburtstag}“; Mindesturlaub in der Live-Prüfung des Vertragsstands.
- **Feiertage (Admin):** Abschnitt „Schulferien“ (Liste je Jahr, anlegen, ändern, löschen, Vorlage übernehmen); für alle lesbar (keine personenbezogenen Daten).
- **Heute, Zeiten, Prüfungen:** Regelmeldungen mit Paragraf wie bisher; Vorwarnung aus Abschnitt 7.
- Texte auf Deutsch; Handy-tauglich nach `docs/specs/design-responsive.md`.

## 9. Tests

- **Regeln** (`libs/time-rules`, Grenzwerttests je Zeile in Abschnitt 4 bis 6): 8,0/8,01/8,5/8,51 Std. mit und ohne kürzeren Tag, 40/40,01 Std., Pausen 29/30 und 59/60 Min., 14-Min.-Unterbrechung zählt nicht, 4,5 Std. am Stück, Pausenlage, 10 Std. Schichtzeit, 12 Std. Freizeit, 5:59/6:00 und 20:00/20:01, Samstag/Sonntag/Feiertag, 24.12. 13:59/14:01, sechster Arbeitstag, 18. Geburtstag an einem Arbeitstag, Alter am 1.1. für den Urlaub, Umrechnung bei 5/4/3 Arbeitstagen, Schulferien erster/letzter Tag, 20./21. Arbeitstag.
- **API** (Integrationstests): Geburtsdatum nur für den Admin sichtbar und änderbar (Zugriffsmatrix), Personen unter 15 abgelehnt, Vertragsstand unter dem Jugendmindesturlaub abgelehnt, Meldungen in Zeiten und Prüfungen, Schulferien-Verwaltung, Erinnerungen (genau einmal, nur an die Person).
- **Web** (Komponententests) und **Abnahme** (Playwright): Admin legt eine jugendliche Person an, Buchung bis 20:30 → Verstoß § 14 in „Prüfungen“; Vertragsstand mit 20 Tagen Urlaub abgelehnt; vollzeitschulpflichtige Person bucht außerhalb der Ferien → Verstoß.

## 10. Arbeitspakete

| AP | Inhalt | Wer | Abnahme |
| --- | --- | --- | --- |
| 1 | Schema: Geburtsdatum, Vollzeitschulpflicht, `SchoolHoliday`, Constraints | Claude, Review Codex | Migration, Constraints |
| 2 | `libs/time-rules`: Jugendregeln, Schulpflichtregeln, Mindesturlaub, Vorwarnzeiten (Signaturen Claude, Umsetzung und Grenzwerttests Codex) | Claude + Codex | Grenzwerttests |
| 3 | API: Mitarbeiterfelder (nur Admin), Schulferien, Einbindung in Zeitprüfung, Urlaubsminimum, Erinnerungen | Claude | Integrationstests, Zugriffsmatrix |
| 4 | Weboberfläche | Codex (Worktree), Prüfung Claude | Komponententests |
| 5 | Abnahmetests, Codex-Review, Befunde unter `docs/reviews/phase7-*.md` | Claude, Codex | alles grün |

## 11. Offene Punkte für die Freigabe

Bitte bestätigen oder ändern (Abschnitt 12 wird danach ergänzt):

1. Der Status kommt aus Geburtsdatum und „vollzeitschulpflichtig bis“, beides nur für den Admin sichtbar; Vorgesetzte sehen nur die Regelmeldungen.
2. 8 bis 8,5 Std. ist nur ein Hinweis, wenn ein anderer Arbeitstag derselben Woche kürzer als 8 Std. ist (§ 8 Abs. 2a); die Fünf-Wochen-Verteilung bei Feiertagen (§ 8 Abs. 2) bildet die App nicht ab.
3. „4 Wochen“ in den Ferien = 20 Arbeitstage im Kalenderjahr.
4. Mindesturlaub: Werktage × Arbeitstage je Woche / 6, aufgerundet.
5. Branchenausnahmen (Samstag, Sonntag, Nachtruhe) gelten für ein Büro- und Softwareunternehmen nicht und werden nicht abgebildet.

## 12. Entscheidungen

| Nr. | Frage | Entscheidung (16.10.2026) |
| --- | --- | --- |
| 1 | Minijobber unter 18 im Betrieb | Ja, mindestens eine Person |
| 2 | Einordnung | Eigene Phase vor dem Pilot; danach Phase 8 Pilotvorbereitung |
| 3 | Status | Beide Fälle: Jugendlich und vollzeitschulpflichtig |
| 4 | Schulferien | Admin pflegt Schulferien wie Feiertage |
| 5 | Vorwarnung | Hinweise in „Heute“ und Erinnerungen per Banner, Push bzw. E-Mail |
| 6 | Punkte aus Abschnitt 11 | alle fünf wie vorgeschlagen bestätigt |

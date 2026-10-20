# Spezifikation Phase 6: Krankmeldungen

Stand: 15.10.2026 · Status: **freigegeben am 15.10.2026**, auch die zusätzlichen Festlegungen in Abschnitt 12
Grundlage: `docs/KONZEPT.md` (Abschnitte 2 „§ 9 BUrlG“, 3, 7 „Krankmeldungen schon in der ersten Version?“), `CLAUDE.md`, Phasen 1 bis 5 (`docs/specs/`), Entscheidungen des Auftraggebers vom 15.10.2026 (Abschnitt 12)
Branch: `phase-6-krankmeldungen`, aufbauend auf `main`

## 1. Ziel

Krankheit und „Kind krank“ werden in der App gemeldet und verwaltet: Die Person meldet sich selbst krank (oder Vorgesetzte bzw. Admin tragen es ein), das Zeitkonto bleibt ohne Minus, die Arbeitsunfähigkeitsbescheinigung (AU) wird als Vermerk geführt und bei Fälligkeit erinnert, Krankheit im genehmigten Urlaub bucht die Urlaubstage mit AU automatisch zurück, und der Admin wird auf sechs Wochen Krankheit hingewiesen. Gesundheitsdaten werden so sparsam wie möglich gespeichert und früh gelöscht.

Nicht in Phase 6: Abruf der eAU bei der Krankenkasse (läuft über das Lohnprogramm), Hochladen von Bescheinigungen, Diagnosen oder Gründe, Beurteilung „dieselbe Krankheit“ (Fortsetzungserkrankung), Krankengeld- oder Lohnberechnung.

## 2. Feste Regeln

- Gesundheitsdaten (Art. 9 DSGVO, § 26 Abs. 3 BDSG): gespeichert werden nur Art (`SICK`, `CHILD_SICK`), Zeitraum, „seit“-Uhrzeit am Tag des Heimgehens und der AU-Vermerk. Kein Grund, keine Diagnose, keine Notiz, kein Dokument.
- Sichtbarkeit: die Person selbst, ihre Vorgesetzte (eigenes Team) und der Admin sehen „krank“ bzw. „Kind krank“. Alle anderen Stellen, insbesondere jeder Kalender, zeigen nur „abwesend“ (CLAUDE.md: keine Abwesenheitsgründe im Kalender). Kollegen sehen weiterhin nur die Anzahl Abwesender ohne Namen.
- Rechteprüfung im Backend (Guards und Abfragefilter); zu jeder neuen Route ein Test mit falscher Rolle.
- Keine personenbezogenen Daten in Logs; Benachrichtigungen neutral.
- Krankmeldungen brauchen keine Genehmigung; sie werden zur Kenntnis genommen.
- Es wird nie automatisch gestempelt. Zeitbuchungen bleiben unverändert (Revisionen wie bisher).
- Regeln in `libs/time-rules` nennen ihren Paragrafen und haben Grenzwerttests.

## 3. Datenmodell

Neues Modell `SickLeave` (eigenes Modell statt weiterer Art von `LeaveRequest`: keine Genehmigung, darf sich mit genehmigtem Urlaub überschneiden, eigene Löschfrist):

| Feld | Bedeutung |
| --- | --- |
| `employeeId` | Person |
| `kind` | `SICK` oder `CHILD_SICK`; nach der Löschfrist `NEUTRAL` (Abschnitt 9) |
| `from`, `to` | lokale Daten; `to` ist das voraussichtliche bzw. tatsächliche Ende (inklusive) |
| `sinceMinute` | optional: Minute des Tages (Europe/Berlin), ab der am ersten Tag krank (Heimgehen während der Arbeit); `null` = ganzer Tag |
| `reportedAt`, `reportedById` | Erfassung (Person selbst, Vorgesetzte oder Admin) |
| `certificateUntil`, `certificateAt`, `certificateById` | AU-Vermerk „AU liegt vor bis …“ (Datum), wann und von wem gesetzt; `null` = keine AU vermerkt |
| `endedAt` | gesetzt bei „wieder gesund“ (verkürzt `to` auf den Vortag bzw. heute) |

- Datenbankregel: keine zwei Krankmeldungen derselben Person mit überschneidendem Zeitraum (Exclusion Constraint wie bei `LeaveRequest`); `to >= from`; `sinceMinute` zwischen 0 und 1439.
- Am Mitarbeiter: `certificateFromDay1` (bool, Standard `false`): AU ab dem 1. Krankheitstag verlangt (§ 5 Abs. 1 Satz 3 EFZG), nur vom Admin änderbar.
- Änderungen (verlängern, verkürzen, „wieder gesund“, AU-Vermerk, Löschen durch den Admin) stehen im Audit-Log mit Person und Zeitpunkt, ohne Gesundheitsangaben über Art und Datum hinaus.
- Rückbuchungen nach § 9 BUrlG sind `LeaveLedgerEntry`-Korrekturen mit Verweis auf die Krankmeldung (Abschnitt 6).

## 4. Erfassung und Änderung

- **Selbst:** „Krank melden“ in „Heute“ und in „Mein Urlaub“: Art (krank / Kind krank), ab (Standard heute), voraussichtlich bis (Standard heute), „seit jetzt“ wenn heute bereits gestempelt wurde (setzt `sinceMinute` auf die Serverzeit und beendet eine laufende Buchung nicht automatisch; die Person stempelt selbst aus, ein Hinweis erinnert daran). Rückwirkend höchstens 7 Kalendertage, Beginn spätestens heute, Ende höchstens 14 Tage voraus; weiter zurück, geplant (z. B. Operation) oder länger nur durch Vorgesetzte oder Admin (ergänzt nach Sicherheitsreview am 15.10.2026).
- **Vorgesetzte und Admin:** für Personen ihres Teams bzw. alle, beliebiger Zeitraum.
- **Verlängern und verkürzen:** die Person selbst (laufende und zukünftige Tage, nicht für bereits abgelaufene Krankmeldungen, Ende höchstens 14 Tage voraus), Vorgesetzte und Admin (auch rückwirkend). „Wieder gesund“ setzt das Ende auf gestern bzw. heute.
- **Löschen:** nur der Admin, mit Pflichtbegründung (Fehleintrag); Rückbuchungen werden mit Gegenbuchung aufgehoben.
- Überschneidung mit genehmigtem Urlaub ist erlaubt (Abschnitt 6), mit Überstundenabbau und Sonderurlaub ebenfalls (Krankheit hat für den Tag Vorrang; Überstundenabbau an Krankheitstagen wird mit AU nicht verbraucht, Hinweis an den Admin).
- Buchungen an Krankheitstagen werden nicht verhindert, aber als Hinweis markiert („Buchung an einem Krankheitstag“).

## 5. Zeitkonto

- An Krankheitstagen ist das Soll 0 (Lohnausfallprinzip, § 4 Abs. 1 EFZG), kein Minus, keine Plusstunden durch die Krankheit.
- Tag des Heimgehens (`sinceMinute` gesetzt): die gestempelte Zeit bleibt, das Soll des Tages wird auf die gestempelte Arbeitszeit begrenzt (der Tag gilt als erfüllt, höchstens das vertragliche Soll).
- Halbe Tage gibt es bei Krankheit nicht.
- „Kind krank“ wirkt aufs Zeitkonto wie Krankheit (Soll 0); der Betrieb zahlt kein Entgelt fort (Krankengeld nach § 45 SGB V), das ist für das Zeitkonto ohne Bedeutung.
- Keine Erinnerung ans Ein- oder Ausstempeln an Krankheitstagen (Phase 5), keine Minijob-Aufzeichnungserinnerung für Krankheitstage.

## 6. AU, krank im Urlaub, sechs Wochen

- **AU-Fälligkeit** (`SICK`, § 5 Abs. 1 EFZG): dauert die Krankheit länger als drei Kalendertage, ist die AU am darauffolgenden Arbeitstag fällig; mit `certificateFromDay1` am ersten Krankheitstag. **`CHILD_SICK`:** ärztliche Bescheinigung für das Kind ab dem ersten Tag (§ 45 Abs. 1 SGB V).
- **AU-Vermerk:** Vorgesetzte (eigenes Team) und Admin setzen „AU liegt vor bis …“. Deckt die AU nicht den ganzen Zeitraum, gilt der Rest als „AU fehlt“, sobald fällig.
- **Erinnerung an die Person:** am Fälligkeitstag, wenn keine AU vermerkt ist, einmal über die Erinnerungskanäle aus Phase 5 (Banner in „Heute“, Web Push bzw. E-Mail-Rückfall), neutral: „Bitte reiche deine Arbeitsunfähigkeitsbescheinigung ein.“ Kein Hinweis an Vorgesetzte.
- **Krank im Urlaub** (§ 9 BUrlG, nur `SICK`): für jeden Tag, an dem genehmigter Urlaub und eine durch AU belegte Krankheit zusammenfallen und der laut Vertrag ein Arbeitstag ist (kein Feiertag), wird der Urlaubstag (bzw. halbe Tag) automatisch als Korrekturbuchung im Urlaubskonto gutgeschrieben, sobald der AU-Vermerk gesetzt ist. Wird die Krankmeldung oder der AU-Vermerk später verkürzt oder gelöscht, wird die Gutschrift mit einer Gegenbuchung angepasst. Ohne AU nur ein Hinweis („Krank im Urlaub, AU fehlt“). Der Urlaubsantrag selbst bleibt unverändert.
- **Sechs Wochen** (§ 3 Abs. 1 EFZG): erreicht eine zusammenhängende `SICK`-Krankmeldung 42 Kalendertage, erscheint beim Admin ein Hinweis in „Prüfungen“ (keine E-Mail). Zusätzlich sieht der Admin je Person die Krankheitstage (Kalendertage, getrennt nach Art) der letzten 12 Monate. Ob es dieselbe Krankheit ist, klärt der Admin außerhalb der App.

## 7. Benachrichtigungen

- Meldet sich jemand selbst krank, bekommt die Vorgesetzte (bei aktiver Vertretung die Vertretung) eine E-Mail: „{Name} ist ab {Datum} krankgemeldet, voraussichtlich bis {Datum}.“ Ohne Art („Kind krank“ wird nicht genannt), ohne weitere Angaben, mit Link in die App. Die Person erhält eine Bestätigung in der App (Toast) und keine E-Mail.
- Trägt die Vorgesetzte oder der Admin ein, gibt es keine E-Mail an Vorgesetzte; die Person sieht den Eintrag in der App.
- Verlängerung durch die Person: E-Mail an die Vorgesetzte mit dem neuen Ende.

## 8. Oberfläche

- **Heute:** Knopf „Krank melden“ (Dialog wie Abschnitt 4). Ist die Person heute krank, statt der Stempeluhr der Status „Heute krankgemeldet bis {Datum}“ mit „Verlängern“ und „Wieder gesund“; die Stempeluhr bleibt erreichbar („Trotzdem stempeln“). Banner „AU einreichen“ bei Fälligkeit.
- **Mein Urlaub:** Abschnitt „Krankmeldungen“ mit den eigenen Einträgen (Zeitraum, Art, AU-Status), Verlängern, „Wieder gesund“, Knopf „Krank melden“.
- **Team heute (Vorgesetzte, Admin):** „krank“ statt „abwesend“ für Personen des eigenen Teams.
- **Urlaubsübersicht:** Kalender zeigt Krankheit als „abwesend“ (wie genehmigter Urlaub, ohne Grund). In der Liste sehen Vorgesetzte und Admin für ihr Team zusätzlich die Krankmeldungen mit Art und AU-Status; „Eintragen für das Team“ bekommt die Arten „krank“ und „Kind krank“. Mitarbeiter sehen in der Liste nur eigene Einträge.
- **Zeiten:** Krankheitstage wie Abwesenheiten („krank“, „Kind krank“), Soll 0; am Tag des Heimgehens „krank seit {Uhrzeit}“.
- **Prüfungen:** neuer Abschnitt „Krankmeldungen“: „AU fehlt“ (Person, Zeitraum, fällig seit, AU vermerken), „Krank im Urlaub“ (ohne AU), „Sechs Wochen erreicht“ (nur Admin), Krankheitstage der letzten 12 Monate je Person (nur Admin). Vorgesetzte sehen „AU fehlt“ für ihr Team.
- **Mitarbeiter (Admin):** Schalter „AU ab dem 1. Krankheitstag verlangen“.
- Alle Ansichten nach der Spezifikation „Design und Bedienung auf dem Handy“ (Tabellen mit Detailzeilen, keine Überbreite).

## 9. Löschung

- Am Ende des Kalenderjahres nach dem Ende der Krankmeldung (Beispiel: Krankheit im März 2026 → Ende 2027) wird die Krankmeldung neutralisiert: `kind = NEUTRAL`, `sinceMinute` bleibt (für das Zeitkonto), AU-Vermerk und Erfasser werden entfernt. Die neutrale Abwesenheit wirkt aufs Zeitkonto wie zuvor und erscheint überall nur als „abwesend“.
- Rückbuchungen im Urlaubskonto bleiben als Buchung erhalten; ihr Vermerk nennt nur „Rückbuchung nach § 9 BUrlG“, keine Zeiträume mit Art.
- Neutralisierte Einträge folgen danach der Löschfrist der Zeitbuchungen.
- Bei Anonymisierung eines Kontos (Phase 4) werden Krankmeldungen gelöscht.
- Der Löschjob aus Phase 4 übernimmt das; Audit-Einträge nennen nur die Anzahl.

## 10. Tests und Abnahme

- **Regeln** (`libs/time-rules`, Grenzwerttests): AU-Fälligkeit (3/4 Kalendertage, Wochenende und Feiertag als Fälligkeitstag, „ab dem 1. Tag“, Kind krank), sechs Wochen (41/42 Tage, Unterbrechung), überlappende Urlaubsarbeitstage (halbe Urlaubstage, Feiertage, vertragsfreie Tage, Teil-AU), Soll am Tag des Heimgehens.
- **API** (Integrationstests): Erfassen selbst/Vorgesetzte/Admin, rückwirkend höchstens 7 Tage selbst, Überschneidung abgelehnt, Verlängern/Verkürzen/Wieder gesund, AU-Vermerk mit automatischer Rückbuchung und Gegenbuchung, E-Mail an Vorgesetzte ohne Art, Erinnerung zur AU genau einmal, Zeitkonto Soll 0 und Heimgehen, keine Stempelerinnerung an Krankheitstagen, Kalender ohne Art, Löschjob (Neutralisieren, Anonymisieren), Zugriffsmatrix für jede Route mit falscher Rolle.
- **Web** (Komponententests): Krank melden, Status in „Heute“, Liste in „Mein Urlaub“, Prüfungsabschnitt, Mitarbeiterschalter.
- **Abnahme** (Playwright): Person meldet sich krank → Vorgesetzte erhält neutrale E-Mail (Mailpit), sieht „krank“ in „Team heute“, Kollege sieht im Kalender nur „abwesend“; Admin vermerkt AU für Krankheit im genehmigten Urlaub → Urlaubskonto steigt um die überlappenden Tage; keine Überbreite auf 360 px.

## 11. Arbeitspakete

| AP | Inhalt | Wer | Abnahme |
| --- | --- | --- | --- |
| 1 | Schema: `SickLeave`, `certificateFromDay1`, Constraints, Verweis aus `LeaveLedgerEntry`, Migration | Claude, Review Codex | Migration, Constraints getestet |
| 2 | `libs/time-rules`: AU-Fälligkeit, sechs Wochen, überlappende Urlaubstage, Soll am Heimgeh-Tag (Signaturen Claude, Umsetzung und Grenzwerttests Codex) | Claude + Codex | Grenzwerttests |
| 3 | API: Krankmeldungen (Erfassen, Ändern, AU-Vermerk, Rückbuchung, Löschen), Rechte, Audit, E-Mail an Vorgesetzte | Claude | Integrationstests, Zugriffsmatrix |
| 4 | Einbindung: Zeitkonto, Kalender und Liste, „Team heute“, Erinnerungen (AU, keine Stempelerinnerung), Prüfungen, Löschjob | Claude | Integrationstests |
| 5 | Weboberfläche nach Abschnitt 8 | Codex (Worktree), Prüfung Claude | Komponententests |
| 6 | Abnahmetests, Codex-Review, Befunde unter `docs/reviews/phase6-*.md` | Claude, Codex | alles grün |

## 12. Entscheidungen

| Nr. | Frage | Entscheidung (15.10.2026) |
| --- | --- | --- |
| 1 | Wer trägt ein | Die Person selbst, dazu Vorgesetzte (eigenes Team) und Admin; keine Genehmigung |
| 2 | Wer sieht „krank“ | Person, Vorgesetzte, Admin; sonst nur „abwesend“ |
| 3 | AU-Pflicht | ab dem 4. Kalendertag (§ 5 EFZG), je Person „ab dem 1. Tag“ einstellbar durch den Admin |
| 4 | AU-Nachweis | nur Vermerk „AU liegt vor bis …“, kein Upload |
| 5 | Krank im Urlaub | automatische Rückbuchung mit AU-Vermerk |
| 6 | Zeitkonto | Soll gilt als erfüllt, auch am Tag des Heimgehens |
| 7 | Sechs Wochen | Hinweis an den Admin ohne Diagnose, Krankheitstage der letzten 12 Monate |
| 8 | Benachrichtigung | Vorgesetzte per E-Mail, neutral |
| 9 | AU-Erinnerung | Person erinnern, Admin (und Vorgesetzte für ihr Team) sehen „AU fehlt“ |
| 10 | Löschfrist | Ende des Folgejahres, danach neutrale Abwesenheit |
| 11 | Kind krank | eigene Art, Bescheinigung ab dem 1. Tag, keine Urlaubsrückbuchung |

Zusätzliche Festlegungen dieses Entwurfs (bitte mit freigeben): rückwirkende Selbstmeldung höchstens 7 Kalendertage (Abschnitt 4); „Kind krank“ wird in der E-Mail an Vorgesetzte nicht genannt (Abschnitt 7); Vorgesetzte sehen „AU fehlt“ für ihr Team (Abschnitt 8); Überstundenabbau an Krankheitstagen mit AU wird nur als Hinweis gemeldet, nicht automatisch zurückgebucht (Abschnitt 4).

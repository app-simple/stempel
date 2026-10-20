# Konzept: Zeiterfassung & Urlaubsverwaltung

Stand: 12.10.2026 · Modul im app simple Company OS · Prototyp: `prototype/index.html`

Ein Modul im Company OS erfasst die Arbeitszeit von acht Mitarbeitern und den Minijobbern, wickelt Urlaubsanträge mit Genehmigung ab und prüft jede Buchung automatisch gegen Arbeitszeitgesetz, Mindestlohngesetz und Bundesurlaubsgesetz.

Dieses Konzept ist keine Rechtsberatung. Vor dem Go-live prüfen Steuerberater oder Arbeitsrechtler das Regelwerk und die Texte der Hinweise.

## 1. Ziel und Umfang

- **Zeiterfassung** für alle Beschäftigten: Kommen, Gehen, Pausen, Nachtrag mit Begründung.
- **Urlaubsanträge**: Der Mitarbeiter stellt den Antrag, der Vorgesetzte genehmigt oder lehnt ab.
- **Mitarbeiterübersicht**: Wochenarbeitszeit, Arbeitstage, Urlaubsanspruch, Beschäftigungsart, Vorgesetzter.
- **Urlaubsübersicht** als Kalender und Liste, dazu die Urlaubskonten.
- **Prüfungen**: alle Regelverstöße und Fristen an einer Stelle.

Nicht im ersten Umfang: Lohnabrechnung, Schichtplanung, Projektzeiten, Krankmeldungen mit eAU-Abruf. Die Auswertung für den Steuerberater kommt als Export, nicht als Schnittstelle.

## 2. Rechtliche Anforderungen

| Regel | Quelle | Umsetzung im Tool |
| --- | --- | --- |
| Beginn, Ende und Dauer der Arbeitszeit aller Beschäftigten erfassen; System objektiv, verlässlich, zugänglich | BAG 13.09.2022 (1 ABR 22/21), § 3 Abs. 2 Nr. 1 ArbSchG, EuGH C-55/18 | Jede Buchung mit Beginn, Ende, Pause. Mitarbeiter sehen ihre Daten jederzeit. Änderungen nur mit Begründung, Original bleibt im Protokoll. |
| Höchstens 8 Std. je Werktag; bis 10 Std., wenn der Schnitt in 6 Monaten oder 24 Wochen bei 8 bleibt | § 3 ArbZG | Hinweis ab 8 Std., Verstoß ab 10 Std. Ausgleichskonto je Person. |
| Pause: 30 Min. bei mehr als 6 Std., 45 Min. bei mehr als 9 Std.; höchstens 6 Std. am Stück ohne Pause | § 4 ArbZG | Fehlende Pause wird beim Speichern gemeldet. Keine stille automatische Pausenkürzung. |
| 11 Std. Ruhezeit zwischen zwei Arbeitstagen | § 5 ArbZG | Prüfung gegen das Ende des Vortags. |
| Keine Arbeit an Sonn- und Feiertagen außer in den gesetzlichen Ausnahmen | §§ 9, 10 ArbZG | Bayerische Feiertage hinterlegt, Buchungen an diesen Tagen markiert. |
| Arbeitszeit über 8 Std. aufzeichnen und 2 Jahre aufbewahren | § 16 Abs. 2 ArbZG | Mindestens 2 Jahre Aufbewahrung, danach Löschung nach Plan. |
| Minijobber: Beginn, Ende, Dauer spätestens am 7. Kalendertag nach dem Arbeitstag aufzeichnen, 2 Jahre aufbewahren | § 17 Abs. 1 MiLoG | Erfassungsdatum wird gespeichert. Erinnerung ab Tag 5, Verstoß ab Tag 8. |
| Mindestlohn 13,90 € (2026), Minijob-Grenze 603 €/Monat; ab 01.01.2027 14,60 € und 633 € | MiLoG, § 8 SGB IV | Stunden × Stundenlohn je Monat gegen die Grenze, Warnung ab 90 %. Werte je Jahr als Daten hinterlegt. |
| Mindesturlaub 24 Werktage bei 6-Tage-Woche = 4 Tage je Wochenarbeitstag (20 bei 5-Tage-Woche); gilt auch für Teilzeit und Minijob | § 3 BUrlG | Mindestanspruch wird aus den Arbeitstagen berechnet; ein geringerer Wert lässt sich nicht speichern. |
| Voller Anspruch erst nach 6 Monaten, davor ein Zwölftel je vollem Monat | §§ 4, 5 BUrlG | Anteilige Berechnung aus dem Eintrittsdatum. |
| Urlaubswünsche berücksichtigen; Ablehnung nur bei dringenden betrieblichen Belangen oder vorrangigen Wünschen anderer | § 7 Abs. 1 BUrlG | Ablehnung nur mit Begründung. Vorgesetzter sieht Überschneidungen. |
| Übertrag bis 31.03.; Verfall nur nach Hinweis des Arbeitgebers auf Resturlaub und Verfall | § 7 Abs. 3 BUrlG, BAG 19.02.2019 (9 AZR 423/16) | Jährlicher Hinweis in Textform je Mitarbeiter, mit Datum protokolliert. Ohne Hinweis kein automatischer Verfall. |
| Krankheitstage im Urlaub zählen mit Attest nicht als Urlaub | § 9 BUrlG | Korrekturbuchung durch Admin, Tage gehen zurück aufs Konto. |
| Beschäftigtendaten nur für den Zweck des Arbeitsverhältnisses, nach Rollen getrennt | DSGVO, § 26 BDSG | Rollenrechte, Löschfristen, Hosting in der EU. Abwesenheitsgründe im Teamkalender nicht sichtbar. |

**Geplante Reform.** Das BMAS hat im Juni 2026 einen Entwurf vorgelegt: Erfassung elektronisch und am selben Tag, Ausnahme für Betriebe bis zehn Beschäftigte. Nach den geprüften Berichten von Anfang Oktober 2026 ist er nicht verabschiedet. Das Tool erfüllt die strengere Fassung bereits. Offen ist, ob der Betrieb mit acht Mitarbeitern plus Minijobbern über der Schwelle läge.

## 3. Rollen und Rechte

| Rolle | Sieht | Darf |
| --- | --- | --- |
| Mitarbeiter (auch Minijobber) | Eigene Zeiten, eigenes Urlaubskonto. Im Urlaubskalender nur die eigenen Tage und die Anzahl der Kollegen im Team, die an einem Tag fehlen, ohne Namen | Stempeln, mit Begründung nachtragen, Urlaub beantragen, offene Anträge zurückziehen |
| Vorgesetzter | Zusätzlich Zeiten, Anträge, Abwesenheiten mit Namen und Prüfungen des eigenen Teams, nicht anderer Teams | Anträge genehmigen oder mit Begründung ablehnen, Korrekturen freigeben |
| Admin | Alles | Mitarbeiter anlegen und ändern, Urlaubskonten korrigieren, Hinweise versenden, exportieren |

Jeder Mitarbeiter hat genau einen Vorgesetzten und eine Vertretung für dessen Abwesenheit.

## 4. Module

### 4.1 Zeiterfassung

- Normalfall Stempeluhr: Kommen, Pause, Gehen. Vergessen: Nachtrag mit Grund.
- Jede Buchung speichert Beginn, Ende, Pause, Erfassungszeitpunkt, Erfasser, Quelle.
- Wochenansicht mit Soll, Ist, Saldo je Tag. Urlaub und Feiertage setzen das Soll auf null.
- Regelprüfung beim Speichern: Höchstarbeitszeit, Pause, Ruhezeit, Sonn-/Feiertag, bei Minijobbern die 7-Tage-Frist.
- Verstöße blockieren nicht. Die tatsächliche Zeit muss dokumentiert sein. Der Verstoß erscheint beim Mitarbeiter und in den Prüfungen.
- Minijobber sehen Monatsstunden und Verdienst gegen die Grenze.
- Monatsabschluss: Mitarbeiter bestätigt, danach für ihn gesperrt.
- **Nachträge sind markiert.** Die Stempeluhr nimmt immer die aktuelle Serverzeit. Jede von Hand eingetragene Zeit ist ein Nachtrag und speichert Erfassungszeitpunkt, Grund und Person. Die Wochenansicht zeigt das an, zum Beispiel „Nachgetragen um 10:04, 2:04 Std. nach Beginn“.
- Die Prüfungen werten Nachträge je Mitarbeiter aus: Anzahl, Anteil, durchschnittlicher Verzug. Ab drei Nachträgen und 20 % in sechs Wochen gilt das als auffällig. Der Mitarbeiter sieht seine eigenen Markierungen und seine Quote.

### 4.2 Urlaubsantrag

1. Mitarbeiter wählt Zeitraum und optional eine Notiz. Gezählt werden nur seine Arbeitstage ohne Feiertage; der Rest nach Genehmigung wird angezeigt.
2. Antrag geht an den Vorgesetzten, bei Abwesenheit an die Vertretung. Benachrichtigung per E-Mail.
3. Vorgesetzter sieht Überschneidungen und das Urlaubskonto.
4. Genehmigen bucht ab und trägt in den Kalender ein. Ablehnen verlangt eine Begründung, die der Mitarbeiter sieht.
5. Offene Anträge kann der Mitarbeiter zurückziehen. Genehmigten Urlaub storniert nur der Vorgesetzte mit Einverständnis des Mitarbeiters.

Halbe Tage als Option. Anträge, die länger als fünf Arbeitstage offen sind, werden dem Admin gemeldet.

### 4.3 Mitarbeiterübersicht

Je Person: Beschäftigungsart (Vollzeit, Teilzeit, Minijob), Wochenarbeitszeit, Arbeitstage, Jahresurlaub, Übertrag, Eintritt, Vorgesetzter, bei Minijob Stundenlohn. Abgeleitet: tägliches Soll, gesetzlicher Mindesturlaub, höchstmögliche Monatsstunden im Minijob. Änderungen gelten ab Stichtag (Vertragsstand), damit alte Monate richtig bleiben. Zusatzurlaub wird als Zahl ohne Grund gespeichert, damit kein Gesundheitsmerkmal im System steht.

### 4.4 Urlaubsübersicht

- Kalender: Spalte je Tag; genehmigt, beantragt, Feiertag, arbeitsfreier Tag unterscheidbar. Vorgesetzte sehen eine Zeile je Mitarbeiter ihres Teams, der Admin alle. Mitarbeiter sehen ihre eigene Zeile und eine anonyme Zeile „Im Team abwesend“ mit der Anzahl je Tag.
- Liste: alle Anträge mit Status, filterbar nach Person und Status.
- Urlaubskonten: Anspruch, Übertrag, genehmigt, beantragt, Rest.

### 4.5 Prüfungen

Verstöße gegen das ArbZG, überfällige Aufzeichnungen der Minijobber, Auslastung der Minijob-Grenze je Monat, Stand der jährlichen Urlaubshinweise, Export für Zoll oder Gewerbeaufsicht.

### 4.6 Erinnerungen ans Stempeln

Wer an einem Arbeitstag noch nicht gestempelt hat, bekommt eine Desktop-Benachrichtigung.

- **Auslöser**: Arbeitstag laut Vertrag, kein Feiertag, kein genehmigter Urlaub, noch keine Buchung.
- **Zeitpunkt wird gelernt**: Median der echten Stempelzeiten desselben Wochentags aus den letzten acht Wochen, plus 15 Minuten. Nachträge zählen nicht mit, sonst würde das Tool aus behaupteten Zeiten lernen. Im ersten Monat und bei weniger als drei Werten gilt eine betriebsweite Standardzeit.
- **Kanal**: Web Push aus der Webanwendung (Service Worker, VAPID). Erscheint als Systembenachrichtigung auf Windows und Mac, auch bei geschlossenem Tab, und auf dem Handy bei installierter App. Jeder Mitarbeiter erlaubt das einmal je Gerät. Rückfall per E-Mail und als Banner in der Anwendung.
- **Inhalt**: nur „Du hast heute noch nicht gestempelt“, ohne weitere Details. Aktionen „Jetzt stempeln“ und „Heute nicht erinnern“.
- **Häufigkeit**: zweite Erinnerung nach 60 Minuten, danach keine weitere.
- **Empfänger** ist nur die Person selbst. Es gibt keine automatische Meldung an Vorgesetzte.
- Das Tool stempelt nie automatisch. Wer schon länger da ist, trägt nach, und der Nachtrag ist markiert.
- Mit derselben Technik: Erinnerung bei vergessenem Ausstempeln und bei Minijobbern an die Aufzeichnungsfrist ab Tag 5.

Die Auswertung von Nachträgen ist eine Verhaltenskontrolle. Sie ist für verlässliche Aufzeichnungen begründbar, muss den Mitarbeitern aber bekannt sein und gehört in die Datenschutzhinweise.

## 5. Datenmodell und Technik

Stack: NestJS + Angular (Tailwind) im Nx-Monorepo, Prisma, PostgreSQL, Betrieb auf dem eigenen Cluster in der EU.

| Entität | Inhalt |
| --- | --- |
| Employee | Name, Rolle, Vorgesetzter, Vertretung, Eintritt, Austritt |
| EmploymentTerms | Gültig ab, Beschäftigungsart, Wochenstunden, Arbeitstage, Jahresurlaub, Zusatzurlaub, Stundenlohn |
| TimeEntry | Datum, Beginn, Ende, Pause, Quelle, erfasst am, erfasst von |
| TimeEntryRevision | Alter Wert, neuer Wert, Grund, wer, wann (append-only) |
| LeaveRequest | Zeitraum, Arbeitstage, Status, Entscheider, Begründung, Zeitstempel |
| LeaveLedgerEntry | Jahr, Art (Anspruch, Übertrag, Abzug, Korrektur, Verfall), Tage |
| Holiday | Datum, Name, Bundesland, optional Gemeinde |
| LeaveNotice | Mitarbeiter, Jahr, Text, versendet am, gelesen am |
| LegalParameter | Schlüssel (Mindestlohn, Minijob-Grenze), Wert, gültig ab |
| PushSubscription | Mitarbeiter, Endpoint, Schlüssel, Gerätename, erstellt |
| ReminderLog | Mitarbeiter, Datum, Art, Kanal, gesendet um, stummgeschaltet |
| LoginCode | Mitarbeiter, Code-Hash, gültig bis, Fehlversuche, verwendet am |
| Passkey | Mitarbeiter, Credential-ID, öffentlicher Schlüssel, Zähler, Gerätename, zuletzt benutzt |
| Session | Mitarbeiter, Token-Hash, erstellt, zuletzt aktiv, läuft ab, Methode |

Grundsätze:

- Regelprüfung als eigene Bibliothek aus reinen Funktionen (`libs/time-rules`), Tests je Paragraf. Gesetzliche Werte als Daten mit Gültigkeitsdatum.
- Zeiten in UTC speichern, in Europe/Berlin rechnen (Sommerzeit).
- Zeitbuchungen mindestens 2 Jahre aufbewahren; für lohnrelevante Auswertungen gelten längere steuerliche Fristen laut Steuerberater. Danach automatischer Löschjob.
- Export als PDF und CSV je Mitarbeiter und Monat, lesbar ohne das Tool.
- Datensparsamkeit (Art. 5 Abs. 1 lit. c DSGVO): Mitarbeiter sehen von Kollegen keine Namen, keine Stempeldaten und keine Urlaubskonten, nur die Anzahl der Abwesenden im eigenen Team. Namen sehen Vorgesetzte für ihr Team und der Admin. Abwesenheitsgründe stehen nie im Kalender.
- In kleinen Teams lässt sich aus der Anzahl teils auf die Person schließen. Das ist hinnehmbar, weil die Abwesenheit im Arbeitsalltag ohnehin bekannt wird; das System legt sie aber nicht selbst offen.

### 5.1 Anmeldung

Es gibt keine Passwörter. Mitarbeiter melden sich per E-Mail-Code oder Passkey an.

- **E-Mail-Code**: Adresse eingeben, 6-stelliger Code per E-Mail. 10 Minuten gültig, einmal verwendbar, höchstens 5 Fehlversuche, nur als Hash gespeichert. Rate-Limit je Adresse und IP. Die Antwort verrät nicht, ob eine Adresse bekannt ist.
- **Passkey (WebAuthn)**: Nach der ersten Anmeldung per Code legt der Mitarbeiter je Gerät einen Passkey an und meldet sich danach mit Fingerabdruck, Gesicht oder Geräte-PIN an. Mehrere Passkeys je Person, im Profil umbenennbar und löschbar.
- Der E-Mail-Code bleibt der Rückfallweg, wenn ein Gerät verloren geht.
- Konten legt nur der Admin an, es gibt keine Selbstregistrierung. Nur aktive Mitarbeiter können sich anmelden.
- Die Anmeldeadresse darf eine private E-Mail-Adresse sein, bei Minijobbern ist das teils der Fall. Sie dient nur der Anmeldung und den Benachrichtigungen und ist nur für den Admin sichtbar.
- Sitzung serverseitig in der Datenbank, Cookie httpOnly, Secure, SameSite=Lax, 30 Tage rollierend. Abmelden und „alle Geräte abmelden“ im Profil.
- Anmeldungen werden mit Zeitpunkt und Methode protokolliert.

## 6. Umsetzungsplan

1. **Fundament**: Nx-Workspace, Anmeldung per E-Mail-Code und Passkey, Rollen, Mitarbeiterstamm mit Vertragsständen, Feiertage.
2. **Zeiterfassung**: Stempeluhr, Nachtrag, Wochenansicht, Regelbibliothek mit Tests.
3. **Urlaub**: Antrag, Genehmigung, Konten, Kalender und Liste, E-Mail-Benachrichtigung.
4. **Prüfungen und Nachweise**: Prüfseite, Minijob-Auswertung, Urlaubshinweis, Export, Löschjob.
5. **Erinnerungen**: üblicher Beginn, Web Push, E-Mail-Rückfall, Auswertung der Nachträge. Prompt: `docs/PROMPT-ERINNERUNGEN.md`.
6. **Pilot**: zwei Wochen mit zwei Mitarbeitern und einem Minijobber parallel zum bisherigen Verfahren, dann Umstellung für alle.

Der Prototyp deckt die Schritte 2 bis 4 mit Beispieldaten ab. Die Fachlogik darin (`entryFlags`, `leaveDays`, `account`, `miniMonth`, `empCheck`) ist die Vorlage für die Regelbibliothek.

## 7. Offene Fragen

- [x] Sind Minijobber unter 18 dabei? Dann gelten die engeren Grenzen des JArbSchG. Entschieden am 16.10.2026: ja, mindestens eine Person; umgesetzt in Phase 7 (`docs/specs/phase-7-jugendarbeitsschutz.md`), inklusive vollzeitschulpflichtiger Jugendlicher in den Schulferien.
- [ ] Arbeiten Beschäftigte an Sonn- oder Feiertagen oder spät abends?
- [ ] Ist Mariä Himmelfahrt (15.08.) am Betriebssitz Feiertag? In Bayern gemeindeabhängig.
- [ ] Überstunden: Freizeitausgleich, Auszahlung oder Gleitzeitkonto mit Obergrenze?
- [ ] Vertraglicher Urlaub über dem Mindesturlaub mit eigenen Verfallsregeln?
- [ ] Wer ist für wen Vorgesetzter, wer vertritt?
- [ ] Erfassung per Handy und Browser oder zusätzlich ein Terminal im Betrieb?
- [ ] Krankmeldungen schon in der ersten Version?
- [ ] Regelbibliothek mit der Zeiterfassung von Plenxi teilen?
- [ ] Aufbewahrungsfristen für lohnrelevante Daten laut Steuerberater?
- [x] E-Mail-Adresse der Minijobber: entschieden am 12.10.2026, private Adressen sind als Anmeldeadresse zulässig.

## 8. Quellen

Recherche vom 12.10.2026. Paragrafen des ArbZG und BUrlG nach Gesetzestext.

- § 17 MiLoG, Wortlaut: https://lxgesetze.de/milog/17
- IHK Oldenburg, Mindestlohn und Aufzeichnungspflichten: https://www.ihk.de/oldenburg/geschaeftsfelder/rechtundsteuern/beratung-recht/arbeitsrecht-vertragsrecht-agb/bestehende-arbeitsverhaeltnisse/mindestlohn-3275836
- Mindestlohn und Minijob-Grenze 2026/2027: https://www.steuerschroeder.de/Mindestlohn.html
- Handwerksblatt, Entwurf zum neuen Arbeitszeitgesetz: https://www.handwerksblatt.de/themen-specials/arbeitszeit-erfassen-aber-wie/neues-arbeitszeitgesetz-das-steht-drin
- Deel, Stand des BMAS-Entwurfs (06.10.2026): https://www.deel.com/de/blog/arbeitszeiterfassung-pflicht-bmas-entwurf/
- BAG 9 AZR 423/16, Hinweispflicht beim Urlaubsverfall: https://rechtsanwalt-krau.de/anspruch-auf-den-gesetzlichen-mindesturlaub-bag-urteil-vom-19-02-2019-9-azr-423-16/
- Hinweise zum jährlichen Urlaubshinweis: https://www.rehm-verlag.de/hjr-formulare/tvoed/tarifrecht296.pdf

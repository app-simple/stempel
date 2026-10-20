# Stempel: open-source time and leave tracking for German companies

[![CI](https://github.com/app-simple/stempel/actions/workflows/ci.yml/badge.svg)](https://github.com/app-simple/stempel/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Stempel** is a self-hosted web app for working-time records, leave and sick notes in small German companies. It covers the rules of German labour law and is built privacy-first: no passwords, no tracking, no external services at runtime. It started as the in-house time tracking of [app & simple](#credits). In the app itself it appears as **Zeit & Urlaub**.

> 🇩🇪 **Kurz auf Deutsch**
>
> Stempel ist eine selbst gehostete Web-App für Arbeitszeiterfassung, Urlaub und Krankmeldungen in kleinen Betrieben in Deutschland. Die App kennt ArbZG, MiLoG, BUrlG, EFZG und JArbSchG, meldet Verstöße mit Paragraf und blockiert dabei nie eine Buchung. Anmeldung ohne Passwort (E-Mail-Code und Passkey), Mitarbeiter sehen nur ihre eigenen Daten, keine externen Dienste zur Laufzeit. Oberfläche auf Deutsch, Code auf Englisch, Lizenz MIT. Als Nächstes kommt die **Projektzeiterfassung** dazu.

The user interface and the legal rules are German. Code, identifiers and this README are in English.

## Features

**Time tracking**

- Clock in, break and clock out, always using server time.
- Manual entries are possible but always marked as such, with reason, author and timestamp.
- Entries are never deleted or overwritten: every change creates an immutable revision.
- Corrections follow a request and approval flow with the manager.
- Weekly view with target hours and balance, month closing, an optional overtime account and a "team today" view for managers.

**Leave and absence**

- Leave requests with half days, approval or rejection with a reason, and a deputy when the manager is away.
- Leave accounts with pro-rata entitlement and carry-over. The statutory minimum is a hard limit.
- Sick notes ("Krankmeldungen") with certificate tracking. Leave days that overlap with certified sickness are credited back (§ 9 BUrlG).
- The calendar never shows absence reasons. Colleagues only see how many people in their team are absent per day.

**Rule checks (they report, never block)**

| Law | Covers |
| --- | --- |
| Working Hours Act (ArbZG) | daily maximum, breaks, rest periods, Sunday and holiday work, 24-week compensation |
| Minimum Wage Act (MiLoG) | recording deadline for mini-jobbers and the mini-job earnings limit |
| Federal Leave Act (BUrlG) | statutory minimum leave and the expiry of leave only after a timely notice |
| Continued Remuneration Act (EFZG) | sick-note deadlines and the six-week limit |
| Youth Employment Protection Act (JArbSchG) | for employees under 18, including pupils who work during school holidays |

- Every rule names its paragraph and has boundary tests.
- Statutory values such as the minimum wage are stored as data with a validity date, never as constants in the code.

**Reminders**

- A reminder to clock in at the time you usually start, learned from your own past clock-ins. It comes as Web Push, with e-mail as fallback.
- Reminders for a forgotten clock-out and for the mini-job recording deadline.
- Reminders only ever go to the person themselves. The app never clocks in for anyone.

**Reviews and exports**

- A review page for managers and admins.
- Annual leave notices by e-mail with read confirmation.
- Monthly working-time reports per person as PDF and CSV.
- A retention job with configurable retention periods.

**Privacy and security by design**

- **Sign-in:** no passwords, only an e-mail code and passkeys (WebAuthn). Only the admin creates accounts; there is no self-registration.
- **Access:** employees see only their own data, managers their team, the admin everything. Every route is checked in the backend and has a wrong-role test.
- **No external services at runtime:** no external fonts, no trackers, no personal data in logs. The only exception is Web Push via the browser vendors' push services, with neutral, end-to-end encrypted messages.
- **Time zones:** all timestamps are stored in UTC and shown in Europe/Berlin.

> **Not legal advice.** The rule checks help you keep proper records. They do not replace advice from a lawyer, tax adviser or works council.

## Roadmap

| Status | Item |
| --- | --- |
| ✅ | Foundation: sign-in, roles, employees, contracts, public holidays (Bavaria) |
| ✅ | Time tracking with ArbZG and MiLoG checks |
| ✅ | Leave management |
| ✅ | Reviews, leave notices, exports, retention |
| ✅ | Reminders via Web Push and e-mail |
| ✅ | Sick notes |
| ✅ | Youth employment protection |
| ✅ | Mobile-first redesign |
| 🚧 | Pilot readiness: in-app help, privacy notice with versioning and acknowledgement, feedback button |
| 🔜 | **Project time tracking**: book working time to projects and customers, with reports and exports per project |

Ideas and feedback for project time tracking are welcome as [issues](https://github.com/app-simple/stempel/issues).

## Tech stack

| Path | Contents |
| --- | --- |
| `apps/api` | NestJS, Prisma 7, PostgreSQL |
| `apps/web` | Angular 22 (standalone components, signals), Tailwind CSS 4, fonts bundled locally |
| `apps/e2e` | Playwright end-to-end tests with Mailpit and a virtual WebAuthn authenticator |
| `libs/time-rules` | Labour-law rules as pure functions, each with its paragraph and boundary tests |
| `libs/shared` | Shared types, date and formatting helpers |
| `docs` | Concept, specifications per phase, operations (German) |

It is an Nx monorepo with TypeScript in strict mode, managed with pnpm.

## Getting started

### Prerequisites

- Node.js 24
- pnpm 10 via Corepack (`corepack enable`)
- Docker with Compose
- For the end-to-end tests, once: `pnpm exec playwright install chromium`

### Run locally

```bash
git clone https://github.com/app-simple/stempel.git
cd stempel
corepack enable
pnpm install
pnpm dev
```

`pnpm dev` does the following:

1. creates `.env` from `.env.example` if it is missing;
2. starts PostgreSQL and Mailpit with Docker Compose;
3. applies the migrations;
4. seeds an empty database with demo data;
5. starts the API and the web app.

| Service | Address |
| --- | --- |
| Web app | http://localhost:4200 |
| API | http://localhost:3000/api |
| Mailpit (inbox for sign-in codes) | http://localhost:8036 |
| PostgreSQL | localhost:5442 (`asos`, `asos_test`, `asos_e2e`) |

### Sign in with a demo account

1. Open http://localhost:4200 and enter one of the addresses below.
2. Copy the code from Mailpit (http://localhost:8036).
3. Optionally add a passkey under "Profil".

The demo accounts are fictional people from the prototype:

| Person | Role | Address |
| --- | --- | --- |
| Katharina Brandl | Admin | katharina.brandl@example.com |
| Tobias Lechner | Manager | tobias.lechner@example.com |
| Miriam Stadler | Manager | miriam.stadler@example.com |
| Jonas Reitberger | Employee | jonas.reitberger@example.com |
| Anna Kroiß | Mini-jobber | anna.kroiss@example.org |

Safari does not set `Secure` cookies on `http://localhost`. For Safari, set `COOKIE_SECURE=false` in `.env`; the API only allows this with `NODE_ENV=development`.

To try Web Push locally, generate VAPID keys with `pnpm exec web-push generate-vapid-keys` and put them into `.env` as `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. Never commit them.

## Commands

| Purpose | Command |
| --- | --- |
| Start everything locally | `pnpm dev` |
| Start or stop PostgreSQL and Mailpit | `pnpm services:up` / `pnpm services:down` |
| Format, lint, typecheck, unit and integration tests (run before every commit) | `pnpm check` |
| End-to-end tests (starts API and web on ports 3210 and 4310) | `pnpm e2e` |
| Build | `pnpm build` |
| Apply migrations | `pnpm nx run api:migrate` |
| Create a migration | `pnpm nx run api:migrate-dev --args="--name=description"` |
| Seed demo data (empty database only) | `pnpm nx run api:seed` |
| Seed master data without demo people (production) | `pnpm nx run api:seed-stammdaten` |
| Create the first admin (production) | `pnpm nx run api:create-admin --args="--name='First Last' --email=admin@example.com --entry=YYYY-MM-DD"` |

## Deployment

The API and the web app each have a Dockerfile (`apps/api/Dockerfile`, `apps/web/Dockerfile`). Notes on running the containers are in [docs/betrieb/container.md](docs/betrieb/container.md) (German).

To set up a new environment:

1. Apply the migrations: `prisma migrate deploy --config apps/api/prisma.config.ts`.
2. Seed the master data without demo people: `pnpm nx run api:seed-stammdaten`. This loads statutory values and public holidays. Without them the API rejects every employment contract.
3. Create the first admin with `api:create-admin`. The admin signs in with an e-mail code and creates all other accounts in the app.

All configuration comes from environment variables; see [.env.example](.env.example). In production, set a strong `AUTH_PEPPER`, an SMTP server, and optionally VAPID keys for Web Push.

## Documentation

- [Concept](docs/KONZEPT.md): domain concept, rules, roles, data model (German).
- [Specifications](docs/specs/): one specification per phase (German).
- [Prototype](prototype/index.html): a clickable single-file prototype with demo data, used as the reference for the UI and the domain logic. Unlike the app, the prototype loads its font from Google Fonts.

## How this project is built

Development follows a fixed process:

1. Each phase starts with a written specification.
2. Tests are written together with the code.
3. Every work package gets an independent code review.

A large part of the code was written with AI coding agents, Claude Code and OpenAI Codex, under human direction and review. Code comments refer to the specifications in `docs/specs/` and to findings of those reviews.

## Contributing

Issues and pull requests are welcome.

- Run `pnpm check` before you open a pull request; for changes to the UI or flows, also run `pnpm e2e`.
- User-facing text is German, code and identifiers are English.
- Every new rule names its paragraph and comes with boundary tests.
- Every new route gets a wrong-role test.
- Never commit secrets, `.env` files or real personal data.

## Security

Please do not report security issues in public issues. Use [GitHub's private vulnerability reporting](https://github.com/app-simple/stempel/security/advisories/new) instead.

## License

[MIT](LICENSE) © app & simple UG (haftungsbeschränkt)

## Credits

Stempel is developed and maintained by **[app & simple](https://app-simple.de)**, a software studio in Hutthurm near Passau and the company behind **[Vereinscockpit](https://vereinscockpit.com)**.

Vereinscockpit is cloud-based club management software ("[Vereinssoftware in der Cloud](https://vereinscockpit.com)"). Clubs use it to manage members, billing and organisation in the browser: sports clubs, fire brigades, music and shooting clubs, support associations, umbrella organisations and other non-profits.

👉 Running a club? Have a look at **[vereinscockpit.com](https://vereinscockpit.com)**.

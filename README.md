# KinPrep

Exam coaching for Nigerian secondary-school students, paid for by the adults who fund their education.

- Product brief and rules that must never be broken: [CLAUDE.md](CLAUDE.md)
- Phase-by-phase build plan and status: [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md)

## Getting started

Requires Node.js 24 (see `.nvmrc`).

```sh
npm install
cp .env.example .env.local   # fill in values as each phase needs them
npm run db:push              # apply supabase/migrations to the Supabase project
npm run seed:dev             # fake demo data + a sponsor link to try checkout
npm run dev                  # http://localhost:3000
```

## Scripts

| Command                                    | What it does                                                                              |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `npm run dev`                              | Development server                                                                        |
| `npm run build` / `npm start`              | Production build and server                                                               |
| `npm run check`                            | Format check, lint, typecheck and all tests (run before pushing)                          |
| `npm test`                                 | Unit and database tests (Vitest; the database tests run in PGlite, no server needed)      |
| `npm run test:coverage`                    | Tests with coverage; business rules must reach 100%                                       |
| `npm run test:e2e`                         | End-to-end tests (Playwright, mobile Chrome). First run `npx playwright install chromium` |
| `npm run format`                           | Format all files with Prettier                                                            |
| `npm run db:push`                          | Apply migrations to the database in `SUPABASE_DB_URL`                                     |
| `npm run seed:dev`                         | Create fake development data and print a sponsor link                                     |
| `npm run seed:progress -- --email <email>` | Fake 8 weeks of practice for that payer's children (or all children with none)            |
| `npm run make-admin -- --email <email>`    | Give an existing account the admin role (needed for /admin)                               |
| `npm run paystack:plans`                   | Create the naira plans in Paystack and print their codes                                  |

## Layout

| Path                                                | Contents                                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/config/`                                       | Prices, trial and grace periods, pilot settings, go/stop thresholds. The only place these values live. |
| `src/lib/env.ts`                                    | Server-only environment variables, validated with Zod, grouped by integration                          |
| `src/lib/rules/`                                    | Pure business rules, fully tested. `access.ts`: when a subscription gives access                       |
| `src/lib/access.ts`                                 | `isStudentActive(studentId)`: the single source of truth for access                                    |
| `src/lib/payments/`                                 | `PaymentProvider` interface with Stripe, Paystack and Manual implementations; webhook handling         |
| `src/app/api/webhooks/`                             | Stripe and Paystack webhook endpoints                                                                  |
| `src/app/sponsor/[code]/`                           | "Get sponsored" page: starts Stripe Checkout for one student                                           |
| `src/app/page.tsx`                                  | Landing page: tagline, prices by region, free trial, FAQ                                               |
| `src/app/app/`                                      | Payer app: sign-in, onboarding, children, plans, dashboard, weekly report, settings, groups            |
| `src/app/consent/[token]/`, `src/app/join/[token]/` | Public pages: guardian consent, joining a group by invite link                                         |
| `src/lib/rules/progress.ts`                         | Dots, streak, accuracy trend, weakest topics, weekly report and its WhatsApp text                      |
| `src/proxy.ts`                                      | Refreshes the Supabase session and guards /app                                                         |
| `src/lib/whatsapp/`                                 | WhatsApp bot: webhook parsing, job table, bot logic, outbox (24-hour window, STOP), simulator          |
| `src/app/api/whatsapp/`                             | Meta webhook (verification and inbound messages)                                                       |
| `src/app/admin/dev/whatsapp/`                       | WhatsApp simulator for admins                                                                          |
| `supabase/migrations/`                              | Database schema, RLS policies and billing functions                                                    |
| `test/`                                             | Database and end-to-end payment tests (PGlite), shared test helpers                                    |
| `scripts/`                                          | Database push, dev seed, Paystack plan setup                                                           |
| `e2e/`                                              | Playwright tests                                                                                       |

## Payments in one paragraph

Code outside `src/lib/payments` never talks to Stripe or Paystack. It calls `getPaymentProvider("stripe" | "paystack" | "manual")`. Each webhook is signature-checked, turned into a provider-neutral update, and applied by the Postgres function `apply_billing_event`. That function records the event id (so a replay changes nothing), updates the subscription and writes the `payments` ledger, all in one transaction. Access is decided only by `isStudentActive`, which looks at every subscription and group seat covering the student, including the 3-day grace period.

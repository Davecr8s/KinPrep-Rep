# KinPrep

Exam coaching for Nigerian secondary-school students, paid for by the adults who fund their education.

- Product brief and rules that must never be broken: [CLAUDE.md](CLAUDE.md)
- Phase-by-phase build plan: [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md)

## Getting started

Requires Node.js 24 (see `.nvmrc`).

```sh
npm install
cp .env.example .env.local   # fill in values as each phase needs them
npm run dev                  # http://localhost:3000
```

## Scripts

| Command                       | What it does                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| `npm run dev`                 | Development server                                                                        |
| `npm run build` / `npm start` | Production build and server                                                               |
| `npm run check`               | Format check, lint, typecheck and unit tests (run before pushing)                         |
| `npm test`                    | Unit tests (Vitest)                                                                       |
| `npm run test:coverage`       | Unit tests with coverage; business rules must reach 100%                                  |
| `npm run test:e2e`            | End-to-end tests (Playwright, mobile Chrome). First run `npx playwright install chromium` |
| `npm run format`              | Format all files with Prettier                                                            |

## Layout

| Path                    | Contents                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/config/`           | Prices, trial and grace periods, pilot settings, go/stop thresholds. The only place these values live. |
| `src/lib/env.ts`        | Server-only environment variables, validated with Zod, grouped by integration                          |
| `src/lib/rules/`        | Pure business rules such as `isStudentActive`, streaks and WhatsApp window checks (Phase 2)            |
| `src/app/(payer)/app/`  | Payer web app (Phase 3)                                                                                |
| `src/app/admin/`        | Admin and reviewer console (Phase 5)                                                                   |
| `src/app/p/[token]/`    | Web practice page for junior students (Phase 6)                                                        |
| `src/app/api/webhooks/` | Stripe, Paystack and WhatsApp webhooks (Phases 4 and 8)                                                |
| `supabase/`             | Database config and migrations (Phase 1)                                                               |
| `e2e/`                  | Playwright tests                                                                                       |

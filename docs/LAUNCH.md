# KinPrep launch guide

How to take KinPrep from "all tests pass" to a live pilot: the accounts it needs, every environment variable, deployment to Vercel (production and previews), monitoring, backups, and the legal steps. The rules in [CLAUDE.md](../CLAUDE.md) apply throughout.

Work through the sections in order. Anything marked **Needs a real account** can only be done by the founder; everything else is already in the code.

## 1. What still needs real accounts

| #   | Item                                                                                                                                                | Why                                                                                                                                                                | Lead time     | Cost (approx.)                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ----------------------------------------------------------- |
| 1   | **Supabase production project** (London region), on the **Pro plan**                                                                                | The live database and sign-in. Pro gives daily backups and point-in-time recovery, and the project never pauses. The free plan pauses after a week without visits. | Minutes       | USD 25 a month (+ USD 100 a month for 7-day PITR, optional) |
| 2   | **Vercel Pro**                                                                                                                                      | The Hobby plan is for non-commercial use only. Pro also allows cron jobs more often than daily and more function time.                                             | Minutes       | USD 20 a month per seat                                     |
| 3   | **Stripe account** (UK entity), activated for live payments                                                                                         | Card payments abroad in GBP, USD and CAD. KYC review before live mode.                                                                                             | Days          | Per-transaction fees                                        |
| 4   | **Paystack account** (Nigerian business, CAC documents), activated                                                                                  | Naira payments by card, transfer and USSD; ambassador payouts by Paystack Transfers.                                                                               | Days to weeks | Per-transaction fees                                        |
| 5   | **Meta Business verification, WhatsApp Business number, approved message templates**                                                                | The bot and every scheduled message. Templates are in `src/config/templates.ts`.                                                                                   | Days to weeks | Per-conversation fees (Meta rate card)                      |
| 6   | **Resend account** and a verified sending domain (e.g. `kinprep.ng`)                                                                                | Emails to payers not on WhatsApp, and the sign-in emails (Supabase's built-in email allows only a few messages an hour).                                           | 1 day (DNS)   | Free up to 3,000 emails a month                             |
| 7   | **Anthropic API key** (console.anthropic.com)                                                                                                       | "Explain another way" and AI question drafts.                                                                                                                      | Minutes       | About USD 0.003 per explanation                             |
| 8   | **Sentry project** (sentry.io, EU region)                                                                                                           | Error monitoring and alerts.                                                                                                                                       | Minutes       | Free plan is enough for the pilot                           |
| 9   | **Off-site backup bucket**: Cloudflare R2 or any S3-compatible bucket                                                                               | The second, encrypted copy of the database (section 8). This repository is public, so its artifacts are not a safe place on their own.                             | Minutes       | Free up to 10 GB (R2)                                       |
| 10  | **Domain** (e.g. `kinprep.ng` or `kinprep.co.uk`)                                                                                                   | The live address, the sending domain and the Meta templates' links.                                                                                                | 1 day         | Registrar fees                                              |
| 11  | **A lawyer** to review the privacy notice and terms (`/privacy`, `/terms`, wording in `src/content/legal.ts`)                                       | They are placeholders. Fill every `[square bracket]`.                                                                                                              | 1-3 weeks     | Fixed fee                                                   |
| 12  | **NDPC registration** (Nigeria Data Protection Commission) if KinPrep is a data controller of major importance, and a named Data Protection Officer | Nigeria Data Protection Act 2023.                                                                                                                                  | Weeks         | Registration fee by tier                                    |
| 13  | **ICO registration** (UK Information Commissioner's Office)                                                                                         | UK GDPR: organisations processing personal data pay the data protection fee.                                                                                       | Minutes       | GBP 52 a year (tier 1)                                      |
| 14  | **Reviewers and 600 approved questions** (150 per subject)                                                                                          | Enough for 8 weeks at 10 a day without repeats.                                                                                                                    | Weeks         | Reviewer pay                                                |

## 2. Environments

| Environment    | Git branch         | Address                                                  | Database                                                | Keys                                               |
| -------------- | ------------------ | -------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| **Production** | `main`             | the domain (until then `https://kinprep-rep.vercel.app`) | Supabase production project (new, London)               | Live: `sk_live_...`, live Paystack, real WhatsApp  |
| **Preview**    | every other branch | `https://kinprep-rep-git-<branch>-<team>.vercel.app`     | Supabase dev project `ngfioqnicgtwyfxpzkvm` (test data) | Test: `sk_test_...`, Paystack test, simulator only |
| **Local**      | any                | `http://localhost:3000`                                  | the dev project, from `.env.local`                      | Test                                               |

Rules:

- Production and Preview never share a database or a secret. A preview must not be able to message a real student or charge a real card.
- Vercel runs cron jobs **only on the production deployment**. Previews never send scheduled messages.
- Leave the WhatsApp variables unset on Preview. The bot then runs only through the simulator (`/admin/dev/whatsapp`), and queued messages wait instead of being sent.

## 3. Production Supabase project

1. [supabase.com](https://supabase.com) > New project: name `kinprep-production`, region **London (eu-west-2)**, a strong database password (in the password manager). Upgrade to Pro.
2. Apply the migrations. Put the production connection string in a file that git ignores, then run the migration script with it:
   ```sh
   # .env.production.local (ignored by git: .env* is in .gitignore)
   SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@aws-0-eu-west-2.pooler.supabase.com:6543/postgres
   node --env-file=.env.production.local scripts/db-push.mjs
   ```
   Don't run `seed:dev` on production: seed data is fake.
3. Authentication > URL Configuration: Site URL = the live address; Redirect URLs = `https://<live address>/**`.
4. Authentication > Email Templates > Magic Link: the link `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email`, and show the code `{{ .Token }}` in the email too.
5. Authentication > SMTP: use Resend's SMTP (host `smtp.resend.com`, port 465, user `resend`, password = a Resend API key), sender `KinPrep <hello@<domain>>`. The built-in sender is limited to a few emails an hour.
6. Authentication > Rate Limits: keep the defaults. The app adds its own per-IP and per-email limits (`src/config/security.ts`).
7. Database > Backups: check daily backups are listed (Pro). Optional: enable point-in-time recovery.
8. Sign in once on the live site, then make yourself admin:
   ```sh
   node --env-file=.env.production.local scripts/make-admin.ts --email <you>
   ```
   (`.env.production.local` needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` for this.)
9. Add the real questions through `/admin/questions` (or CSV import) and approve them.

## 4. Vercel

1. The project is linked to `github.com/Davecr8s/KinPrep-Rep`: `main` deploys to production, and every other branch gets a preview. Upgrade the team to Pro before taking payments.
2. Settings > Functions > Function region: **London (lhr1)**, next to the database.
3. Settings > Environment Variables: add every variable in section 5, with the **Production** and **Preview** values in their own environments. Secrets are server-only: never prefix one with `NEXT_PUBLIC_`.
4. Settings > Deployment Protection: keep Vercel Authentication on for **Preview** deployments. Under "Protection Bypass for Automation", create a secret and save it as the GitHub secret `VERCEL_AUTOMATION_BYPASS_SECRET` (section 9). Production stays public.
5. Settings > Domains: add the domain; then set `NEXT_PUBLIC_APP_URL` (Production) to `https://<domain>` and redeploy.
6. Crons: `vercel.json` (generated from `cronSchedule()` in `src/config/messaging.ts`) holds every schedule, including the 03:00 Lagos maintenance job (retention clean-up). Check them under Settings > Cron Jobs after the first production deploy.
7. Deploy: merge to `main`. The "Preview checks" workflow smoke-tests every deployment Vercel reports to GitHub.

## 5. Environment variables

Every variable the app reads. All are validated by Zod in `src/lib/env.ts`, listed in `.env.example`, and checked by `test/security.test.ts`, so a new one can't be added without a line here. **Secret** means it must never be shared, committed or put in a `NEXT_PUBLIC_` variable.

| Variable                               | Secret | What it is, where to get it                                                                                          | Production          | Preview                                        |
| -------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`                  | no     | The site's own address (links in messages, Stripe return URLs).                                                      | `https://<domain>`  | the preview branch URL, or leave the dev value |
| `CRON_SECRET`                          | yes    | 32+ random characters. Vercel Cron sends it as `Authorization: Bearer ...`; also unlocks the detailed `/api/health`. | own value           | different value                                |
| `NEXT_PUBLIC_SUPABASE_URL`             | no     | Supabase > Project Settings > API.                                                                                   | production project  | dev project                                    |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | no     | Supabase > API Keys > publishable key (RLS applies).                                                                 | production project  | dev project                                    |
| `SUPABASE_SECRET_KEY`                  | yes    | Supabase > API Keys > secret key (bypasses RLS: server only).                                                        | production project  | dev project                                    |
| `SUPABASE_DB_URL`                      | yes    | Supabase > Connect > **Transaction pooler** (port 6543) URI, with the database password.                             | production project  | dev project                                    |
| `SUPABASE_DB_POOL_MAX`                 | no     | Optional. Connections per server instance (default 3).                                                               | unset               | unset                                          |
| `PRACTICE_LINK_SECRET`                 | yes    | 32+ random characters; signs the web practice links. Changing it invalidates every link already sent.                | own value           | different value                                |
| `RATE_LIMIT_SECRET`                    | yes    | 32+ random characters; scrambles IPs and emails in the rate-limit counters. Falls back to `CRON_SECRET`.             | own value           | different value                                |
| `STRIPE_SECRET_KEY`                    | yes    | Stripe > Developers > API keys.                                                                                      | `sk_live_...`       | `sk_test_...`                                  |
| `STRIPE_WEBHOOK_SECRET`                | yes    | Stripe > Developers > Webhooks > the endpoint's signing secret (section 6).                                          | live endpoint       | test endpoint                                  |
| `PAYSTACK_SECRET_KEY`                  | yes    | Paystack > Settings > API Keys & Webhooks. Also verifies webhook signatures.                                         | `sk_live_...`       | `sk_test_...`                                  |
| `PAYSTACK_PLAN_NIGERIA_WEEKLY`         | no     | Plan code from `npm run paystack:plans` (run once per Paystack mode).                                                | live plan           | test plan                                      |
| `PAYSTACK_PLAN_NIGERIA_MONTHLY`        | no     | As above.                                                                                                            | live plan           | test plan                                      |
| `WHATSAPP_ACCESS_TOKEN`                | yes    | Meta Business > System users > permanent token with `whatsapp_business_messaging`.                                   | real                | **unset** (simulator only)                     |
| `WHATSAPP_PHONE_NUMBER_ID`             | no     | WhatsApp Manager > Phone numbers.                                                                                    | real                | unset                                          |
| `WHATSAPP_APP_SECRET`                  | yes    | Meta app > App settings > Basic > App secret (verifies `X-Hub-Signature-256`).                                       | real                | unset                                          |
| `WHATSAPP_VERIFY_TOKEN`                | yes    | 16+ random characters; the same value in Meta's webhook settings.                                                    | own value           | unset                                          |
| `WHATSAPP_GRAPH_VERSION`               | no     | Graph API version, default `v23.0`.                                                                                  | `v23.0`             | unset                                          |
| `WHATSAPP_BUSINESS_ACCOUNT_ID`         | no     | WhatsApp Manager > Account tools; only for `npm run meta:templates` and the admin messages page.                     | real                | unset                                          |
| `RESEND_API_KEY`                       | yes    | resend.com > API Keys (sending access only).                                                                         | real                | a separate key, or unset (emails wait)         |
| `EMAIL_FROM`                           | no     | Sender on the verified domain, e.g. `KinPrep <reports@kinprep.ng>`.                                                  | real                | same                                           |
| `LLM_API_KEY`                          | yes    | console.anthropic.com > API keys. Use a workspace spend limit.                                                       | real                | a separate key with a low limit, or unset      |
| `LLM_MODEL`                            | no     | e.g. `claude-sonnet-5-5` (prices in `src/config/ai.ts`).                                                             | `claude-sonnet-5-5` | `claude-haiku-4-5-20251001`                    |
| `SENTRY_DSN`                           | no\*   | Sentry > Project settings > Client keys (DSN). \*Not a password, but keep it out of the repo to avoid junk reports.  | the project's DSN   | same DSN                                       |
| `SENTRY_ENVIRONMENT`                   | no     | Optional; defaults to Vercel's `production` / `preview`.                                                             | unset               | unset                                          |

Set by the platform (don't set them yourself): `VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA`, `NODE_ENV`, `NEXT_RUNTIME`.

Making random secrets:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## 6. Webhooks

| Provider        | Production URL                                                          | Preview (test mode)                                                                                                             | Events / fields                                                                                                                                                            |
| --------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe          | `https://<domain>/api/webhooks/stripe`                                  | `https://<preview>/api/webhooks/stripe?x-vercel-protection-bypass=<bypass secret>` in **test mode**, or `stripe listen` locally | `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`. API version `2026-09-30.endive`. |
| Paystack        | `https://<domain>/api/webhooks/paystack`                                | Test webhook URL, the same way                                                                                                  | Paystack sends every event; the app uses `charge.success`, `subscription.create`, `subscription.disable`.                                                                  |
| Meta (WhatsApp) | `https://<domain>/api/whatsapp`, verify token = `WHATSAPP_VERIFY_TOKEN` | none (use the simulator)                                                                                                        | Subscribe to `messages`.                                                                                                                                                   |

All three are signature-checked, idempotent (each event or message id is stored once) and rate-limited per IP (`webhook` in `src/config/security.ts`, generous: providers retry a 429). A `GET` on the Stripe or Paystack route answers 200 when its keys are set and 503 when they're missing; the uptime check uses this.

## 7. Monitoring and alerts

- **Errors**: every uncaught server error (pages, routes, server actions) goes through `src/instrumentation.ts`; caught failures that matter (payment webhooks, WhatsApp processing, checkout and deletion errors) call `reportError` directly. Both go to the Vercel logs and, with `SENTRY_DSN` set, to Sentry. Emails, phone numbers, tokens and query strings are removed first, and request bodies are never sent.
  - In Sentry: Alerts > create an issue alert "A new issue is created" → email the founder. Add a second rule for tag `where` starting with `webhook:` → email immediately.
- **Uptime**: `.github/workflows/uptime.yml` runs every 15 minutes once you set repository **variable** `PRODUCTION_URL` (GitHub > Settings > Secrets and variables > Actions > Variables). It checks `/api/health` (site and database), the Stripe, Paystack and WhatsApp webhook routes, and, with secret `PRODUCTION_CRON_SECRET` (= production `CRON_SECRET`), the webhook backlogs: payment events stuck for 15+ minutes, failed or stuck WhatsApp messages, or 10+ failed sends in a day. Set variable `UPTIME_REQUIRE` to `stripe,paystack,whatsapp` once all three are live, so missing keys also fail the check. A failure emails whoever last edited the workflow's schedule. For text-message alerts as well, add a free UptimeRobot monitor on `https://<domain>/api/health`.
- **Pilot health** day to day is in `/admin` (overview, messages log, bank health, AI costs).

## 8. Backups

1. **First copy: Supabase** (Pro plan): daily backups kept 7 days, restorable from Dashboard > Database > Backups. Optional point-in-time recovery.
2. **Second copy: `.github/workflows/backup.yml`**, daily at 03:30 Lagos. It dumps the `public` schema and the sign-in accounts (`auth.users`, `auth.identities`), checks the archive lists the key tables, encrypts it with AES-256 (`gpg`), and stores it in your S3-compatible bucket, plus a 7-day GitHub artifact. Repository secrets:
   - `BACKUP_DATABASE_URL`: production **Session pooler** (port 5432) URI with the password. `pg_dump` can't use the transaction pooler.
   - `BACKUP_PASSPHRASE`: a long random passphrase. Keep a copy in the password manager: without it the backups can't be opened.
   - `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT` (e.g. `https://<account>.r2.cloudflarestorage.com`), `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`. Set a lifecycle rule on the bucket to delete objects after 30 days (the privacy notice says 30).
   - Check `PG_MAJOR` in the workflow matches the project's Postgres version.
   - The repository is **public**: its artifacts can be downloaded by anyone signed in to GitHub. They're encrypted, but make the S3 copy the real one, or make the repository private.
3. **Restore drill (do it once before launch, then every 3 months)**: download a backup, then:
   ```sh
   gpg --decrypt kinprep-db-<stamp>.tar.gpg | tar -xf -        # asks for the passphrase
   # into a NEW, empty Supabase project (never over production):
   pg_restore --no-owner --no-privileges --dbname "<new project session-pooler URI>" public.dump
   pg_restore --no-owner --no-privileges --data-only --dbname "<same URI>" auth.dump
   ```
   Then point a preview at it and sign in. Note how long it took.

## 9. Preview end-to-end test

`e2e/launch-journey.spec.ts` runs the whole launch journey on a deployed preview: a sponsor signs up, adds a child, pays in Stripe test mode, the child completes a day in the WhatsApp simulator, and the weekly report is generated (a dry run of the real job: nothing is sent). It runs from `.github/workflows/preview.yml` after each preview deploy once these are set:

1. Vercel **Preview** environment: all the Preview values from section 5 (the dev Supabase project, Stripe test keys, no WhatsApp keys).
2. The dev Supabase project: migrations applied (`npm run db:push`) and approved questions (`npm run seed:dev`); Redirect URLs include `https://*-<team>.vercel.app/**`.
3. A Stripe **test-mode** webhook endpoint pointing at the branch's preview URL with the bypass parameter (section 6), its signing secret as Preview `STRIPE_WEBHOOK_SECRET`. A branch's URL stays the same across deploys (`kinprep-rep-git-<branch>-<team>.vercel.app`).
4. GitHub repository **secrets**: `VERCEL_AUTOMATION_BYPASS_SECRET`, `PREVIEW_SUPABASE_URL`, `PREVIEW_SUPABASE_SECRET_KEY`, `PREVIEW_STRIPE_SECRET_KEY` (`sk_test_...`; the test refuses to run with anything else), `PREVIEW_CRON_SECRET` (= Preview `CRON_SECRET`). Then the **variable** `E2E_PREVIEW` = `1`.
5. Push a branch (or Actions > Preview checks > Run workflow with the URL). Locally: `npm run dev` with `stripe listen --forward-to localhost:3000/api/webhooks/stripe`, then
   ```sh
   E2E_FULL=1 node --env-file=.env.local node_modules/@playwright/test/cli.js test e2e/launch-journey.spec.ts
   ```

The smoke test (`node scripts/check-site.mjs --url <deployment> --smoke`) runs on every deployment without any of this: pages, security headers, health, webhook routes, and that the jobs, practice, explain and admin routes refuse what they should.

## 10. Security and privacy, as built

- **Routes**: each API route and server action has its guard (admin or reviewer role, signed-in payer who owns the child, cron secret, provider signature, or signed practice link), checked by `test/security.test.ts`. Every input is validated with Zod.
- **Rate limits** (`src/config/security.ts`): sign-in by IP and by email, the 6-digit code, sponsor links (viewing and checkout), class invites, consent links, the practice page, "Explain another way", and webhooks. They're counted in Postgres (shared by all servers), keyed by an HMAC of the IP or email, and let traffic through if the counter itself fails.
- **Headers**: HSTS, `nosniff`, no framing, a strict referrer policy and no camera, microphone or location access on every page (`next.config.ts`). The practice page also has a strict Content-Security-Policy.
- **Secrets**: server-only modules are marked `server-only`; client components can't import them (tested). CI fails if a key-like string is committed (`scripts/scan-secrets.mjs`) or a shipped dependency has a high-severity advisory (`npm audit`).
- **Consent and under-13s**: enforced where recipients are chosen (jobs, bot) and again at send time in the outbox (`src/lib/rules/messaging.ts`), and in the database (no WhatsApp number for a student who might be under 13). Covered by `test/privacy.test.ts`.
- **Data rights**: "Download data" and "Delete" in Settings (and in `/admin`) cover every table that holds student data. A test fails if a new table isn't covered. Deletion also removes that WhatsApp number's message history, unless a sibling still uses the number.
- **Retention**: the 03:00 maintenance job deletes message logs after 180 days, processed inbound jobs after 30, old queue items after 90, dry runs after 14, and raw payment payloads after 400 (`RETENTION_DAYS`).

## 11. Legal and compliance (before the first real family)

1. Lawyer reviews `/privacy` and `/terms` (`src/content/legal.ts`) and the guardian consent wording (`src/lib/consent.ts`; bump `CONSENT_TEXT_VERSION` if it changes). Fill every `[bracket]`: company name and number, address, contact emails, DPO, NDPC registration, transfer mechanism, refund policy, liability, governing law, and backup retention. Then remove `LEGAL_DRAFT_NOTICE`.
2. Sign the data processing agreements with Supabase, Vercel, Stripe, Paystack, Meta, Resend, Anthropic and Sentry (most are click-through in each dashboard).
3. NDPC: decide whether KinPrep is a data controller of major importance; if so, register and file the annual compliance audit. Name a Data Protection Officer.
4. ICO: pay the data protection fee.
5. Meta templates: submit `src/config/templates.ts` exactly as written; check categories with `npm run meta:templates`.
6. Write the breach plan: who decides, and how to notify NDPC and the ICO within 72 hours.

## 12. Go-live checklist

- [ ] Sections 3 to 8 done; production deploy is green; `node scripts/check-site.mjs --url https://<domain> --smoke` passes.
- [ ] `PRODUCTION_URL`, `PRODUCTION_CRON_SECRET` and `UPTIME_REQUIRE` set; the Uptime workflow is green.
- [ ] A test error shows up in Sentry and emails you.
- [ ] The first backup ran, and the restore drill worked.
- [ ] Live Stripe payment of GBP 6 with your own card, then a refund from the Stripe dashboard; the student's access follows.
- [ ] Live Paystack payment of NGN 500 by transfer; access follows.
- [ ] Your own phone, as a senior student: START, a full set, STOP, START.
- [ ] A junior's practice link arrives on the parent's phone, never the child's.
- [ ] "Download data" and "Delete" on a test child; check `/admin/students` afterwards.
- [ ] At least 150 approved questions per pilot subject.
- [ ] Legal items in section 11 done; the draft notice removed.
- [ ] Soft launch with 2 or 3 friendly families for a week (Phase 12), then open to the pilot target.

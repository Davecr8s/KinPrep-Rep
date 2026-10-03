# KinPrep Phase 1: Build Plan

Phase-by-phase plan to take KinPrep from an empty folder to a running pilot. The rules in [CLAUDE.md](../CLAUDE.md) apply to every phase. Each phase ends with a "Done when" check. Don't start the next phase until it passes.

## Status

| Phase                                       | State                                                              | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Tooling and foundations                  | Done (2026-10-02)                                                  | Repo: github.com/Davecr8s/KinPrep-Rep · Live: kinprep-rep.vercel.app · CI green                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 1. Data model and security                  | Mostly done                                                        | Core, consent, audit, billing, payer-app and practice-data tables (topics, questions, sessions, answers) with RLS. WhatsApp tables come with Phase 8. Not yet applied to the hosted project.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 3. Payer app                                | Code done (2026-10-02); live check deferred                        | Landing, PWA, magic-link sign-in, onboarding, add child with guardian consent, plans, dashboard, weekly report, settings, co-sponsors, data export/delete, groups. Offline tests pass; the Done-when journey (`e2e/payer-journey.spec.ts`) needs Supabase + Stripe test keys (see "Payer app setup").                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 4. Payments                                 | Code done (2026-10-02); live check deferred                        | Stripe, Paystack and Manual behind one interface; sponsor links; referral codes. "Done when" proven offline with signed webhooks. Deferred until keys are added: `db:push`, `seed:dev` and a Stripe test-mode checkout (see "Payments setup").                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2/6. Daily-set engine (`src/lib/engine`)    | Done (2026-10-03)                                                  | `buildDailySet` (about 60% weakest topics, 20% spaced review at 1/3/7 days, 20% unseen topics; nothing answered correctly in the last 30 days until the bank runs out, then review top-ups with a `bank_shortage` event per topic), `recordAttempt` (weighted rolling `topic_mastery`, `next_review_at`), `bankRunway`, streak threshold as a setting. Pure decisions fully unit-tested; `npm run simulate:engine` runs 30 days for one student on the real schema (Done-when). Questions now carry `classes`.                                                                                                                                                                                                                                                                                                                                                    |
| 5. Question bank (`/admin/questions`)       | Code done (2026-10-03); live check deferred                        | Syllabus manager (topics mapped to JAMB and WAEC), editor with live WhatsApp and web previews (the bot's and the page's own code), English and Pidgin explanations, "original, not from a past paper" tick, "Draft 10 questions with AI" (status draft, source ai_draft), review queue (approve, edit and approve, reject with reason; AI drafts need answer and explanation confirmed, enforced by the database too), weekly counts per reviewer, CSV import (always drafts) and export, bank health (runway per subject, topics under 10 in red, recent shortages, low correct rates to re-check). Done-when proven in `test/question-bank.test.ts`; needs Supabase keys to sign in, and `LLM_API_KEY`/`LLM_MODEL` for AI drafts.                                                                                                                               |
| 6. Web practice page                        | Code done (2026-10-02); live check deferred                        | `/p/<token>`: signed 24-hour link per student and day, same engine as the bot (sessions with channel `web`), a few KB of plain HTML per load, each answer saved on tap and resent after a dropped connection, junior mode (no leagues with strangers), "Practise now" on the payer dashboard, admin "Today's links" (now in the pilot console, `/admin/pilot`). Done-when proven on a Pixel 7 profile in Playwright against the real schema (`e2e/practice.spec.ts`) and in `test/web-practice.test.ts`; needs `PRACTICE_LINK_SECRET` and the database keys to use on the live site (see "Web practice setup").                                                                                                                                                                                                                                                   |
| 7. AI "Explain another way" (`src/lib/ai`)  | Code done (2026-10-04); live check deferred                        | One question only (strict request: question, student, language, chosen option; free text never reaches the model, and free text in the bot gets the menu), only approved questions from the student's own sets, prompt holds the question, options, answer, approved explanation and topic (nothing about the student), under 120 words, never changes the answer (replies checked; failures fall back to the teacher's explanation). Daily limit per student (setting, default 5), cache per question, language and wrong option, every request logged with prompt version, tokens and cost; admin flags remove one from the cache (`/admin/ai`); editing a question clears its cache. `POST /api/explain` with the practice-link token. Done-when proven in `test/ai-explain.test.ts`; needs `LLM_API_KEY`/`LLM_MODEL` (until then, the teacher's explanation). |
| 8. WhatsApp bot (+ daily sets from Phase 6) | Code done (2026-10-02); live check deferred                        | Webhook with job table, household numbers and "Who's practising today?", daily sets, marking, explanations, commands, STOP, sponsor links, morning template cron, message log, admin simulator. Done-when proven through the simulator path in tests (`test/whatsapp-bot.test.ts`); needs Supabase keys to use the simulator page, and Meta setup for real WhatsApp (see "WhatsApp setup").                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 9/12. Scheduled jobs and message queue      | Code done (2026-10-03); live check deferred                        | `/api/jobs/*` (Vercel Cron, `Authorization: Bearer CRON_SECRET`): 07:00 morning message and junior links, 18:00 reminder (`reminder_enabled`), 21:00 missed-days alerts (WhatsApp/email + dashboard), weekly reports Saturday evening to Sunday at each payer's hour in their timezone (WhatsApp or email). Queue with dedupe keys (one send per student per day per job), per-second and per-day limits (settings), retries with backoff, expiry, every send logged with template, category and estimated cost. Templates in `src/config/templates.ts`; `npm run meta:templates` shows Meta's status and category. Done-when proven in `test/jobs.test.ts` (`npm run jobs:demo` prints every run); on the live seed: `npm run jobs -- <job> --dry-run`.                                                                                                          |
| 11. Admin console (`/admin`)                | Code done (2026-10-03); live check deferred                        | Overview (active students, payers by type, MRR in GBP and NGN separately, trial conversions, 5+ days a week, renewals, churn, messages and WhatsApp cost), pilot go/stop measures, students and payers (search, view, pause, change class, merge duplicates, export, delete), payments (ledger, failed, record Manual, refund links), pilot console (wa.me links for practice links, Sunday reports and missed-day alerts; mark as sent; same dedupe keys as the jobs), ambassadors (codes, referrals, 20% of first three months, monthly payout batches paid by Paystack Transfers or Stripe Connect Express, or by hand), settings (questions per day, reminder, streak, prices, grace days, sending limits), messages (log viewer, template status). Every change in audit_log. Done-when proven in `test/admin.test.ts` against the seed.                     |
| 12. Hardening and launch                    | Code done (2026-10-04); preview end-to-end run waits for test keys | Rate limits on public routes and webhooks (Postgres counters, HMAC-keyed), route and server-action guards checked by a test, security headers, secret scan and `npm audit` in CI. Consent and the under-13 rule re-checked at send time in the outbox. Complete data export and deletion (a test fails if a new table holding student data isn't covered), daily retention clean-up. Placeholder privacy notice and terms (`/privacy`, `/terms`) for a lawyer to review. Error reporting to Sentry (scrubbed), `/api/health`, uptime and backup workflows, smoke test on every deploy, and the full launch journey in Playwright (`e2e/launch-journey.spec.ts`). See [LAUNCH.md](LAUNCH.md).                                                                                                                                                                      |

Launch: every account, environment variable, webhook, backup and legal step is in [docs/LAUNCH.md](LAUNCH.md).

## Start these now (they take weeks and don't depend on code)

| Item                                                                               | Why it's slow                                                                                                                |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Meta Business verification, WhatsApp number, message template approval             | Verification and template review can take days to weeks. The bot can't go live without them.                                 |
| Stripe account (UK entity) and Paystack account (Nigerian business, CAC documents) | KYC review before live payments.                                                                                             |
| Reviewers recruited; question writing started                                      | The pilot needs about **150 approved questions per subject (600 in total)**, enough for 8 weeks at 10 a day without repeats. |
| Privacy policy, terms, guardian consent wording                                    | Needed by the sign-up flow (Phase 3) and the Meta templates. Must cover NDPA 2023 and UK GDPR.                               |

## Decisions needed before the phases that use them

1. **Under-13 rule with birth year only (Phase 1).** We store the birth year, not a full date, so a child born in 2013 could be 12 or 13 during 2026. Recommendation: treat a student as 13+ only when `current_year - birth_year >= 14`. Otherwise they are junior: web page only, no WhatsApp. _Implemented as recommended (database trigger on `students`); still awaiting confirmation._
2. **Naira renewals by transfer or USSD (Phase 4).** _Decided 2026-10-02: pay-per-period._ Cards renew through Paystack subscriptions; each transfer or USSD payment buys one week or month, and the 3-day grace period covers late payers. Renewal reminders come with the payer app.
3. **Payer sign-in (Phase 3).** _Decided 2026-10-02: email magic link_, with the 6-digit code from the same email as a fallback for in-app browsers.
4. **AI explanations (Phase 7).** Generate them live, or generate them ahead of time so a teacher approves them alongside the question (safer, cheaper, works offline from the LLM). Also pick the LLM provider.
5. **Local database (Phase 0).** _Decided 2026-10-02: hosted Supabase dev project_ (`ngfioqnicgtwyfxpzkvm`). Tests run the migrations in PGlite, an in-process Postgres, so they need no database.
6. **USD and CAD price points, and the time on Sunday that payer reports go out (Phase 9).** _Prices: the provisional ones in `src/config/pricing.ts` are in use for now._ Report time still open.
7. **Free trial for naira payers (Phase 3).** _Implemented 2026-10-02:_ a 7-day no-card trial starts when a naira payer adds a child (provider `trial`, one per student, no grace period when it ends). Stripe sponsors get theirs in Checkout. Confirm this is wanted.

## AI explanation setup

1. `LLM_API_KEY` (Anthropic) and `LLM_MODEL` (e.g. `claude-sonnet-5-5`) in Vercel. Until set, "Explain another way" shows the teacher's explanation in the other language.
2. Settings: "AI explanations per student per day" (default 5; 0 turns the AI off).
3. `/admin/ai`: today's requests (new, cached, over the limit, refused, teacher's instead), this month's cost and tokens, recent explanations; "Flag and remove" takes a bad one out of the cache.
4. Changing the prompt (`src/lib/ai/rules.ts`)? Bump `EXPLAIN_PROMPT_VERSION` (`src/config/ai.ts`) so old cached answers aren't reused. Prices per model are there too.

## Admin console setup

1. Sign in, then `npm run make-admin -- --email <you>`. `/admin` is admin-only; reviewers see only `/admin/questions`.
2. Pilot console (`/admin/pilot`), before the Cloud API is live: "Make today's practice links", then "Send on WhatsApp" on each (opens WhatsApp Business with the message ready) and "Mark as sent". The same for Sunday reports and missed-day alerts. When the Cloud API takes over, the scheduled jobs skip anything already sent by hand.
3. Ambassadors: Nigerian accounts are registered with Paystack (bank code + account number, Paystack keeps the details; we keep only the recipient code and last four digits) and paid by Paystack Transfers; turn off transfer OTP in Paystack, or approve each transfer there (the payout shows "waiting for Paystack approval"). UK accounts use Stripe Connect Express: enable Connect in Stripe, "Create Stripe Express account", send the link to the ambassador. Or pay by hand and "Mark as paid".
4. Payouts: each month, "Prepare the batch" (commission on payments not paid out yet), check it, then "Confirm and pay". A payment's commission is only ever paid once.
5. Settings: prices apply to new checkouts and every page at once; Paystack's recurring card plans keep their own amount, so after changing a naira price create new plans (`npm run paystack:plans`) and update `PAYSTACK_PLAN_*`. Grace days apply to new failures and late renewals.
6. Refunds: the ledger links each Stripe or Paystack payment to its page in their dashboard; Manual payments are refunded by bank transfer.

## Question bank setup

1. Make someone a reviewer: `update profiles set role = 'reviewer' where id = '<user id>'` (after they sign in once), or `npm run make-admin` for an admin. Reviewers see only `/admin/questions`.
2. Admin: add each subject's topics in Syllabus, with their JAMB and WAEC references.
3. AI drafts: `LLM_API_KEY` (Anthropic) and `LLM_MODEL` (e.g. `claude-sonnet-5-5`) in Vercel. "Draft 10 questions with AI" on a topic saves 10 drafts to the review queue; nothing reaches a student until a reviewer approves it, ticking that the answer and both explanations are right and the question is original.
4. Pay reviewers from Reviewers: approvals, edit-and-approvals and rejections per week (Monday to Sunday, Lagos).
5. CSV: export, edit in a spreadsheet, import: every imported row is a new draft for review. Topics must exist first.
6. Bank health: runway per subject (red under 14 days), topics with fewer than 10 approved questions in red, the last 14 days of bank shortages, and approved questions with unusually low correct rates; "Flag for re-checking" takes one out of new sets until a reviewer clears, fixes or retires it.

## Daily-set engine notes

- Settings (table `settings`): `questions_per_day` (default 10, max 20) and `streak_day_threshold` (default 5). Mix and timings are in `src/config/pilot.ts` (`DAILY_SET_MIX`).
- Each question has `classes` (default: all). Set them when questions are written (Phase 5), or juniors and seniors will share questions.
- `bank_shortage` events (`engine_events`) and `bankRunway(subject)` are for the pilot console (Phase 11): they tell the content team which topics need questions next.
- Spaced review counts each interval from the day the question was actually answered: 1 day after a wrong answer, then 3 days, then 7.
- Mastery starts empty: answers recorded before this change (e.g. `seed:progress` data) don't count towards weak topics.

## Scheduled jobs setup

1. Vercel environment: `CRON_SECRET` (32+ random characters; Vercel sends it as `Authorization: Bearer ...`), plus the database, practice-link and WhatsApp keys. For email to payers not on WhatsApp: a Resend account, a verified sending domain, `RESEND_API_KEY` and `EMAIL_FROM`. Until WhatsApp or email is set up, those messages wait in the queue (and expire after 12 hours or at the end of the Lagos day).
2. Templates: submit each one in `src/config/templates.ts` in WhatsApp Manager, exactly as written (`{APP_URL}` = the live site). Then `npm run meta:templates` (needs `WHATSAPP_BUSINESS_ACCOUNT_ID`) shows each one's approval status, and flags any Meta classed as **marketing** (dearer, and needs marketing opt-in).
3. Settings (table `settings`): `reminder_enabled` (off by default), `wa_messages_per_second` (default 10), `wa_messages_per_day` (default 250, Meta's starting limit for a new number).
4. Schedule (`vercel.json`, generated from `cronSchedule()` in `src/config/messaging.ts`, which a test keeps in step): 07:00 morning and junior links, 08:30 retries, 18:00 reminder, 21:00 missed days (Lagos), and weekly reports hourly from Saturday 18:00 Lagos to Sunday 21:00 US west coast. Every entry runs at most once a day, so it deploys on Vercel Hobby, where a job may start up to 59 minutes late; reports catch up, so a late run still sends them.
5. Try it: `npm run jobs -- morning --dry-run` (any job; `--at <ISO time>` to pretend it's another time, e.g. a Sunday for reports). A dry run records what it would send, so a second dry run shows nothing new, and never stops the real run.
6. Opt-ins: seniors get the morning message and reminder only if opted in (parent ticks the box when adding them, or the student sends START); STOP stops everything. Payers get WhatsApp only if they ticked "Send KinPrep messages to me on WhatsApp" in settings; otherwise email.
7. Costs: estimates per message are in `message_log` and `outbound_queue` (`META_PRICE_USD` in `src/config/messaging.ts`; check Meta's rate card). Utility templates inside a person's 24-hour window are free.

## Web practice setup

1. `.env.local` and Vercel: `PRACTICE_LINK_SECRET` (32+ random characters; use a different one on Vercel) plus the database keys from "WhatsApp setup" step 1. Changing the secret invalidates every link already sent.
2. Juniors: the parent opens today's link from the child's dashboard ("Open Kemi's practice") and hands over the phone. Seniors get a "Practise on the web" button there too, for when WhatsApp is down.
3. Admin: the pilot console (`/admin/pilot`) makes today's link for every active student in one click, each with a one-tap "Send on WhatsApp" (wa.me) button; juniors' go to the parent, never the child. Mark each one as sent.
4. Links are signed, not stored, so one can't be revoked on its own: it expires after 24 hours, and deleting the student kills it at once. (This replaces the "revocable token" in the original Phase 6 plan, as the Prompt 8 spec asked for 24-hour signed links.)
5. A senior who uses both channels on one day gets a set on each; both count towards the streak and the reports.

## WhatsApp setup

Simulator first (no Meta account needed):

1. `.env.local`: Supabase keys plus `SUPABASE_DB_URL` (transaction pooler, port 6543). `npm run db:push`, then `npm run seed:dev`.
2. Sign in at `/app/sign-in`, then `npm run make-admin -- --email <you>`.
3. Open `/admin/dev/whatsapp`: `+2348000000001` is Ada and Chidi (siblings), `+2348000000002` is Emeka (plan lapsed), anything else is an unknown number.

Real WhatsApp (Meta):

1. Meta Business verification, a WhatsApp Business number, and a Meta app with the WhatsApp product.
2. App webhook: callback URL `https://<site>/api/whatsapp`, verify token = `WHATSAPP_VERIFY_TOKEN`, subscribe to the `messages` field.
3. A permanent system-user access token, the phone number id and the app secret into Vercel's environment.
4. Message templates: submit every template in `src/config/templates.ts` exactly as written (see "Scheduled jobs setup").
5. WhatsApp's 3-button limit means 4-option questions arrive as a list ("Choose answer"); 2-3 short options arrive as reply buttons.

## Payer app setup (to finish the Phase 3 "Done when")

1. `.env.local`: add `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` as well as the payments keys below.
2. Supabase dashboard > Authentication > URL Configuration: Site URL `http://localhost:3000` (later the live URL); add `http://localhost:3000/**` and `https://kinprep-rep.vercel.app/**` to Redirect URLs.
3. Authentication > Email Templates > Magic Link: make the link `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email` and show the code `{{ .Token }}` in the email too. The link then works even if the email opens in another browser.
4. `npm run db:push`, `npm run dev`, sign up in a phone-sized window, add children, pay with Stripe test card 4242 4242 4242 4242, then `npm run seed:progress -- --email <your email>` to see progress.
5. Automated version: with `stripe listen` running, `E2E_FULL=1 npx playwright test e2e/payer-journey.spec.ts`.
6. Manual bank transfer for naira payers stays hidden until the admin stores KinPrep's account in `settings` (key `manual_bank_details`: `{"bank", "accountName", "accountNumber"}`).

## Payments setup (to finish the Phase 4 "Done when")

1. In `.env.local`: `SUPABASE_SECRET_KEY`, `SUPABASE_DB_URL`, `STRIPE_SECRET_KEY` (test mode), then `npm run db:push` and `npm run seed:dev`.
2. Local webhooks: `stripe listen --latest --forward-to localhost:3000/api/webhooks/stripe` and copy the printed `whsec_...` into `STRIPE_WEBHOOK_SECRET`. The code expects Stripe API version `2026-09-30.endive` (the SDK's), so a dashboard endpoint must use that version too.
3. `npm run dev`, open the sponsor link from `seed:dev`, pay with card 4242 4242 4242 4242: the student becomes active (trial).
4. Failed renewal: run another checkout (new seed student, or cancel the first) with card 4000 0000 0000 0341, which saves fine but fails when charged. In the Stripe dashboard open the subscription and choose "End trial now": the charge fails, the student moves to grace, and `isStudentActive` turns false 3 days later.
5. Replay: `stripe events resend <evt_id>` returns `{"status":"duplicate"}` and changes nothing.
6. Paystack (test keys): `npm run paystack:plans`, paste the printed plan codes into `.env.local`, and point the Paystack test webhook at `/api/webhooks/paystack`.

---

## Phase 0: Tooling and foundations

**Goal:** an empty but correctly configured app, deployed, with CI.

**Build**

- Install Git, Node.js LTS and the Supabase CLI (and Docker, if we use local Supabase).
- `git init`, GitHub repository, Vercel project linked to `main` with preview deploys.
- Next.js App Router, strict TypeScript, Tailwind with the brand colours as tokens (`navy #25308A`, `orange #F0A93C`), ESLint, Prettier.
- Vitest and Playwright installed, with one test each.
- `src/lib/env.ts`: Zod-validated environment variables, server-only. `.env.example` lists every secret.
- `src/config/pricing.ts` and `src/config/pilot.ts`: all prices, the trial and grace periods, the commission rate, questions per day (max 20), the streak threshold, the subject list and the go/stop thresholds. Nothing else may hard-code these.
- Folder layout: `src/app/(payer)/app`, `src/app/admin`, `src/app/p/[token]`, `src/app/api/webhooks/*`, `src/lib/rules` (pure business logic), `src/lib/db`, `supabase/migrations`.
- GitHub Actions: typecheck, lint, unit tests on every push.

**Done when:** CI is green and the Vercel URL serves a branded placeholder page.

---

## Phase 1: Data model and security

**Goal:** every table, Row Level Security policy and constraint the pilot needs, with fake seed data.

**Tables (summary)**

- `profiles`: `user_id`, `role` (payer, group_buyer, reviewer, ambassador, admin).
- `payers`: `country`, `currency`, `timezone`, `whatsapp_number`, `referred_by_ambassador_id`.
- `students`: `first_name`, `last_initial`, `class`, `birth_year`, `exam`, `subjects[]`, `whatsapp_number` (nullable), `practice_token`, `payer_id`, `group_account_id`. Nothing beyond the minimal data set.
- `guardian_consents`: `student_id`, `guardian_id`, `consent_text_version`, `consented_at`, `method`. Never updated, only appended.
- `subscriptions`: `provider`, `provider_ref`, `plan`, `status`, `trial_ends_at`, `current_period_end`, `grace_until`, `seats`.
- `payment_events`: `provider`, `event_id` (**unique**, which gives idempotency), `type`, `payload`, `processed_at`.
- `group_accounts`, `seat_assignments`.
- `questions`: `subject`, `topic`, `syllabus_ref`, `stem`, `options`, `answer`, `explanation_en`, `explanation_pcm`, `status` (draft, in_review, approved, retired), `approved_by`, `approved_at`.
- `question_reviews`.
- `practice_days` (student and Lagos date), `deliveries` (question sent), `answers`.
- `wa_contacts`: `last_inbound_at`, `opted_out_at`. Also `wa_messages` (log).
- `ambassadors`, `referrals`, `commissions`.
- `settings` (key/value pilot settings), `audit_log`, `data_requests` (export and delete).

**Database-level guarantees**

- A check constraint or trigger ensures `whatsapp_number` is null for junior students.
- Deliveries can only reference questions with `status = 'approved'` (enforced by trigger).
- All timestamps are `timestamptz` in UTC.
- RLS: payers see only their own students. Reviewers see only `questions` and `question_reviews`. Students have no Supabase login; the practice page uses server routes with a token.

**Done when:** migrations apply cleanly from scratch, seed data loads, and RLS tests prove a payer can't read another payer's students and a reviewer can't read students or payments.

---

## Phase 2: Core business rules (pure functions, fully tested)

**Goal:** every rule in the brief as a small, tested function in `src/lib/rules`, before any UI depends on it.

| Function                                           | Rule                                                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `isStudentActive(student, subscription, now)`      | The **only** access check. Covers the trial, paid period, 3-day grace period and group seats.             |
| `lagosDate(now)` and `isStreakDay(answers)`        | A student's day runs on Africa/Lagos time; a day counts at 5 answers.                                     |
| `currentStreak(practiceDays, today)`               | Consecutive qualifying days.                                                                              |
| `selectDailyQuestions(student, history, settings)` | Approved questions only, in the student's subjects, no repeats, at most `questionsPerDay` (capped at 20). |
| `canMessageOnWhatsApp(student, contact)`           | Consent recorded, student is 13+, has not opted out, and is active.                                       |
| `canSendFreeForm(lastInboundAt, now)`              | True only within 24 hours of the last inbound message. Otherwise a template is required.                  |
| `priceFor(region, plan, currency)`                 | Reads from config.                                                                                        |
| `commissionFor(referral, payments)`                | 20% of the payer's first three months.                                                                    |
| `reportWeek(payerTimezone, now)`                   | Monday to Sunday in the payer's own timezone.                                                             |

**Done when:** these have full branch coverage in Vitest, including the edge cases: around midnight Lagos time, daylight-saving changes in the UK, US and Canada, the last hour of the grace period, a student turning 13, and an `answers` count of exactly 5.

---

## Phase 3: Payer web app

**Goal:** a payer can sign up, add a child with consent, and see a dashboard (with empty data until Phases 6 and 8).

**Build**

- Supabase Auth sign-in, using the method chosen in decision 3.
- Sign-up: choose region (abroad or Nigeria), which sets the currency, and the timezone (detected, editable).
- Add a child: minimal fields only, all validated with Zod. Class and birth year decide whether the child is junior or senior. Seniors give a WhatsApp number. Guardian consent is recorded **before** the student is created as messageable.
- Dashboard per child: streak, days practised this week, accuracy by subject, recent topics.
- Privacy: request a data export (JSON) or deletion per child, logged in `data_requests`.
- Mobile-first, server components by default, and a small client JavaScript bundle on every route.

**Done when:** Playwright covers sign-up, adding a junior, adding a senior, and the consent step; a student without consent can't be created as messageable.

---

## Phase 4: Payments

**Goal:** money in, access out, decided only by webhooks.

**Build**

- **Stripe** (GBP, USD, CAD): Checkout for monthly and yearly plans with a 7-day trial, plus the Customer Portal for card changes and cancellation.
- **Paystack** (NGN): weekly and monthly plans. Card payments renew automatically; transfer and USSD renewals follow decision 2.
- **Bulk seats**: a Stripe subscription priced per seat. The group buyer assigns seats to students.
- `/api/webhooks/stripe` and `/api/webhooks/paystack`:
  1. Verify the signature, rejecting with 400 on failure.
  2. Insert into `payment_events` with `on conflict do nothing`. A duplicate means already handled, so return 200.
  3. Update `subscriptions` (including `grace_until` on a failed payment).
  4. Write to `audit_log`.
- No card data is ever stored. The app only stores provider IDs.

**Done when:** tests cover a replayed event (no double effect), out-of-order events, a bad signature, failed payment → grace period → inactive, and renewal → active again. Test-mode payments work end to end on a preview deploy.

---

## Phase 5: Admin, question bank and review

**Goal:** the founder and reviewers can produce approved questions.

**Build**

- `/admin` with role gating. Reviewers see only the question bank.
- Question editor: subject, topic, syllabus reference, stem, four options, answer, explanation in English and Pidgin.
- Review flow: draft → in review → approved or sent back (with comments). The author can't approve their own question.
- CSV import for bulk authoring, with every row validated.
- Coverage view: approved questions per subject and topic against the pilot target.
- Every admin change is written to `audit_log`.

**Done when:** a reviewer can approve a question, an unapproved question can't be delivered (database trigger plus a test), and the audit log records who did what.

---

## Phase 6: Web practice page `/p/<token>`

**Goal:** the practice engine works end to end on the web: for juniors, for the pilot, and as a fallback. It's built before WhatsApp because Meta approval may still be pending.

**Build**

- Long, random token per student that can be revoked from `/app`. No login.
- Today's questions come from `selectDailyQuestions`. One question per screen, with instant feedback and the approved explanation (English or Pidgin toggle).
- Records answers; the streak updates at 5 answers.
- Very light page: little or no client JavaScript, works on 3G, under ~50 KB of JavaScript.
- Checks `isStudentActive`. An inactive student sees a friendly "ask your parent or sponsor" screen.

**Done when:** a seeded junior can complete a day on a throttled mobile profile in Playwright, and their streak and dashboard update.

---

## Phase 7: Scoped AI explanation

**Goal:** an "Explain again" option that can only talk about the current question.

**Build**

- Server endpoint that takes only `deliveryId` and `language`. The prompt is built on the server from the question, the correct answer and the approved explanation. Students' free text is never passed in as instructions.
- Output length is capped; responses are cached per question and language; rate-limited per student per day.
- Follows decision 4: either live generation or explanations generated ahead of time and approved by a teacher.

**Done when:** tests show the endpoint refuses requests for questions not in today's deliveries, and prompt-injection attempts in student input have no effect.

---

## Phase 8: WhatsApp bot (seniors)

**Goal:** seniors practise in WhatsApp under every messaging rule.

**Build**

- `/api/webhooks/whatsapp`: the verify-token handshake plus an `X-Hub-Signature-256` check, and deduplication by message ID.
- Linking: the payer's app shows a code; the student sends it from the registered number. Only then is the contact active.
- Practice flow uses interactive buttons for A–D, feedback, and "Explain again" (Phase 7).
- **Every** outbound message goes through one `sendWhatsApp()` function that calls `canMessageOnWhatsApp` and `canSendFreeForm`. Outside the 24-hour window it can only send approved templates.
- STOP (and its common variants) sets `opted_out_at` and blocks everything. START opts back in.
- Vercel Cron sends a daily nudge template at a set Lagos time to active, consented, 13+, not-opted-out students.

**Done when:** tests prove no message can reach a junior, a student without consent, an opted-out contact, or (free-form) anyone outside the 24-hour window. A real test number completes a day's practice.

---

## Phase 9: Weekly payer report

**Goal:** "You see the proof every Sunday."

**Build**

- An hourly cron finds payers whose local time is Sunday at the chosen hour and who haven't had this week's report yet.
- Per child: days practised (out of 7), questions answered, accuracy by subject, streak, and a short plain-English note.
- Sent as a WhatsApp template to the payer, linking to the full report in `/app`.

**Done when:** tests confirm the right week and send time for London, Toronto, New York and Lagos payers around daylight-saving changes, and no payer gets two reports in a week.

---

## Phase 10: Ambassadors and referrals

**Goal:** track referrals and the commission owed.

**Build**

- Admin creates ambassadors with referral codes. A code or link is captured at payer sign-up.
- Commission is calculated from real payment events (20% of the first three months) and listed per ambassador for manual payout. Payouts are marked paid in admin and audited.

**Done when:** tests cover refunds, plan changes and payers who churn before month three.

---

## Phase 11: Admin pilot console and metrics

**Goal:** the founder can run the pilot and make the go/stop call.

**Build**

- Students and payments views, with search and status, read-mostly.
- Pilot settings (questions per day, up to 20), changes audited.
- Go/stop dashboard: each measure against its go and stop thresholds from config, coloured by status:
  - sponsors abroad paying
  - parents paying
  - % of students practising 5+ days a week
  - renewals after week 4
  - bulk enquiries
  - ambassador-referred payers
- Data requests queue: run an export, or a deletion with confirmation; both are audited.
- Audit log viewer.

**Done when:** metrics match hand-calculated values on seed data.

---

## Phase 12: Hardening and pilot launch

**Build**

- Playwright end-to-end tests for every key journey: a sponsor pays → adds a senior → the student practises on WhatsApp → the Sunday report arrives; a parent pays in naira → adds a junior → the junior practises on the web.
- Performance check on a low-end Android profile and slow 3G.
- Error monitoring and alerts on webhook failures. Database backups confirmed. Secrets audited.
- Privacy policy, terms and consent wording published; data export and deletion tested.
- Short runbook: refunds, failed webhooks, a student who stops getting messages, deletion requests.
- Soft launch with 2–3 friendly families, then open to the pilot target of 10 sponsors and 20 parents.

**Done when:** the founder can run a full week of the pilot from `/admin` without developer help.

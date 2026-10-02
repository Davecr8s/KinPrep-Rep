# KinPrep Phase 1: Build Plan

Phase-by-phase plan to take KinPrep from an empty folder to a running pilot. The rules in [CLAUDE.md](../CLAUDE.md) apply to every phase. Each phase ends with a "Done when" check. Don't start the next phase until it passes.

## Status

| Phase                      | State                 | Notes                                                                                                                                                            |
| -------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Tooling and foundations | Done (2026-10-02)     | Repo: github.com/Davecr8s/KinPrep-Rep · Live: kinprep-rep.vercel.app · CI green                                                                                  |
| 1. Data model and security | Partly done           | Core, consent, audit and billing tables with RLS. Question bank, practice and WhatsApp tables follow in their own phases. Not yet applied to the hosted project. |
| 4. Payments                | Built, offline-tested | Stripe, Paystack and Manual behind one interface; sponsor links; referral codes. Live check with test keys still to do (see "Payments setup").                   |

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
3. **Payer sign-in (Phase 3).** Email magic link (cheapest, simplest) or phone OTP (more natural in Nigeria, but costs per SMS).
4. **AI explanations (Phase 7).** Generate them live, or generate them ahead of time so a teacher approves them alongside the question (safer, cheaper, works offline from the LLM). Also pick the LLM provider.
5. **Local database (Phase 0).** _Decided 2026-10-02: hosted Supabase dev project_ (`ngfioqnicgtwyfxpzkvm`). Tests run the migrations in PGlite, an in-process Postgres, so they need no database.
6. **USD and CAD price points, and the time on Sunday that payer reports go out (Phase 9).** _Prices: the provisional ones in `src/config/pricing.ts` are in use for now._ Report time still open.
7. **Free trial for naira payers (Phase 3).** Stripe checkouts include the 7-day trial. Paystack has no built-in trial, so Nigerian payers currently pay from day one. Option: grant a 7-day app-level trial at sign-up.

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

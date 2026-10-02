@AGENTS.md

# KinPrep: Project Brief

(This file is the project brief; instructions that mention PROJECT_BRIEF.md mean this file.)

Build plan and current phase: see [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md).

## What it is

KinPrep is a digital exam-coaching service for Nigerian secondary-school students, paid for by the adults who fund their education. Students practise every day; payers get weekly proof it is working. Tagline: "They practise daily. You see the proof every Sunday."

## People and roles

- Sponsor: a relative abroad (UK, US, Canada, Ireland). Pays by card in GBP, USD or CAD.
- Parent: in Nigeria. Pays in naira by card, transfer or USSD.
- Group buyer: church, alumni association or school. Buys seats in bulk.
- Student (senior): 13 or over, SS1 to SS3 and UTME candidates. Practises on WhatsApp.
- Student (junior): under 13, JSS1 to JSS2. Practises on a web page opened from a parent's phone. Never messaged directly on WhatsApp.
- Reviewer: a paid teacher who checks and approves questions.
- Ambassador: refers payers for a commission.
- Admin: the founder.

## Entry points

1. Student: WhatsApp bot (seniors) and web practice page /p/<token> (juniors, pilot, fallback).
2. Payer: web app /app (sign-up, pay, add children, dashboard, reports) plus a weekly WhatsApp report.
3. Admin: /admin (question bank and review, students, payments, pilot console, ambassadors, metrics). Reviewers see only the question bank.

## Stack

Next.js (App Router, TypeScript strict, Tailwind) on Vercel; Supabase (Postgres, Auth, Row Level Security, Storage); WhatsApp Cloud API direct from Meta; Stripe; Paystack; an LLM API for scoped explanations; Zod for validation; Vitest and Playwright for tests.

## Prices (keep in config, never hard-code)

- Abroad: GBP 6 a month or GBP 55 a year (USD and CAD equivalents).
- Nigeria: NGN 500 a week or NGN 2,000 a month.
- Bulk seats: GBP 4 per seat per month.
- 7-day free trial. 3-day grace period after a failed payment.
- Ambassador commission: 20% of a payer's first three months.

## Rules that must never be broken

- Guardian consent is recorded before any student is messaged.
- No WhatsApp messages to students under 13.
- Only teacher-approved questions are ever sent to students. Questions are original, mapped to the published syllabus; no past exam papers.
- The AI only re-explains the current question. Students cannot chat freely with it.
- WhatsApp: free-form replies only inside the 24-hour window after the user's last message; otherwise approved templates only. STOP opts out of everything.
- Card details are never stored. Access is decided by one function (isStudentActive) based on payment webhooks. Webhooks are verified and idempotent.
- Minimal data: first name and last initial, class, birth year, exam, subjects, WhatsApp number (seniors only). Leaderboards show first name and initial only. Follow the Nigeria Data Protection Act 2023 and UK GDPR. Every student's data can be exported and deleted.
- Store times in UTC. Student days run on Africa/Lagos time. Payer reports use the payer's own timezone.

## Pilot settings

10 questions a day (setting, max 20). A day counts towards the streak at 5 answered questions. Four subjects: English, Mathematics, Physics, Biology. Pilot target: 10 sponsors abroad and 20 parents in Nigeria.

## Go / stop measures (shown in admin)

Sponsors abroad paying: go 10 of 50, stop below 3. Parents paying: go 20 of 50, stop below 5. Students practising 5+ days a week: go 70%, stop below 40%. Renewals after week 4: go 50%, stop below 25%. Bulk enquiries: go 2. Ambassador-referred payers: go 5.

## Brand

Name KinPrep. Navy #25308A, orange #F0A93C, white. Friendly, plain English; explanations also in Nigerian Pidgin. Mobile-first, fast on cheap Android phones and slow data.

## Code conventions

TypeScript strict. Validate every input with Zod. Secrets only on the server, listed in .env.example. Seed data is fake. Write tests for business rules. Every admin change goes in audit_log.

import { CURRENCIES, GRACE_DAYS, PLANS, TRIAL_DAYS, AMBASSADOR_COMMISSION } from "@/config/pricing";
import { RETENTION_DAYS } from "@/config/security";
import { CONSENT_TEXT_VERSION } from "@/lib/consent";
import { formatMoney } from "@/lib/money";

// The privacy notice and terms (/privacy, /terms). PLACEHOLDER WORDING for a lawyer to review
// before launch (docs/LAUNCH.md): it describes what the code actually does, but it is not legal
// advice. Anything in [square brackets] must be filled in. Prices, the trial, grace period and
// retention periods come from config, so the pages can't drift from what the app does.

export type LegalSection = { heading: string; paragraphs?: string[]; bullets?: string[] };
export type LegalDoc = {
  title: string;
  version: string;
  updated: string;
  summary: string[];
  sections: LegalSection[];
};

export const LEGAL_DRAFT_NOTICE =
  "Draft for legal review. This wording has not yet been checked by a lawyer and may change before KinPrep launches.";

const CONTROLLER = "[KinPrep Ltd], [company number], [registered address]";
const CONTACT = "[privacy@kinprep.ng]";

const price = (plan: keyof typeof PLANS, currency: (typeof CURRENCIES)[number]) => {
  const amount = (PLANS[plan].prices as Partial<Record<string, number>>)[currency];
  return amount === undefined ? "" : formatMoney(amount, currency);
};

export const PRIVACY: LegalDoc = {
  title: "Privacy notice",
  version: "2026-10-draft-1",
  updated: "4 October 2026",
  summary: [
    "We keep as little as we can about your child: first name and surname initial, class, birth year, exam, subjects, their answers and, only if they are 13 or over, their WhatsApp number.",
    "Nothing is sent to a child until their parent or guardian has agreed. Children under 13 never get WhatsApp messages from us.",
    "We never sell data, never show adverts, and never store card details. You can download or delete your child's data at any time from your account.",
  ],
  sections: [
    {
      heading: "Who we are",
      paragraphs: [
        `KinPrep is run by ${CONTROLLER}. We are the data controller for the information described here. Contact us about privacy at ${CONTACT}.`,
        "Our Data Protection Officer is [name], reachable at the same address. [If KinPrep is a data controller of major importance under the Nigeria Data Protection Act 2023, record the NDPC registration number here.]",
        "We follow the Nigeria Data Protection Act 2023 (NDPA) and, for payers and students in the United Kingdom, the UK General Data Protection Regulation and the Data Protection Act 2018.",
      ],
    },
    {
      heading: "What we collect",
      bullets: [
        "About each student: first name, surname initial, class, birth year (not the full date of birth), exam and exam date, subjects, preferred language, and, for students 13 or over only, their WhatsApp number. We also keep their practice: which questions they were sent, their answers, streaks and progress.",
        "About payers (parents, sponsors, group buyers): email address, the country and timezone you choose, your WhatsApp number if you give it, your report settings, and your payment history (amounts and dates, not card details).",
        "Guardian consent: who agreed, when, how (a tick box on our site, or a group's confirmation), and which version of the wording they agreed to.",
        "Messages: the WhatsApp messages and emails we send and receive, kept for a limited time (see 'How long we keep it').",
        "Technical data: to stop abuse we count requests from each connection, keeping only a scrambled code of the IP address for at most a day.",
      ],
      paragraphs: [
        "We do not collect surnames, full dates of birth, addresses, photos, school names for individual students, or anything else we don't need.",
      ],
    },
    {
      heading: "Why we use it, and our legal basis",
      bullets: [
        "To provide the coaching you signed up for: daily questions, marking, explanations, streaks and the weekly report (contract with the payer; for the child, the consent of their parent or guardian).",
        "To take payments and manage subscriptions (contract; legal obligations for financial records).",
        "To keep the service safe, prevent abuse and fix problems (legitimate interests).",
        "To show friendly leaderboards inside a class or group: first name and surname initial only, and juniors only ever see their own group (consent of the parent or guardian).",
        "We do not use children's data for marketing, profiling for adverts, or anything a parent hasn't agreed to.",
      ],
    },
    {
      heading: "Children",
      paragraphs: [
        "Under the NDPA a child is anyone under 18, so every student needs a parent's or guardian's consent before we send them anything. We record that consent before any message is sent.",
        "Students we cannot be sure are 13 or over (from their birth year) are treated as under 13: they practise on a web page their parent opens, and we never store or message a WhatsApp number for them.",
        "A parent or guardian can withdraw consent at any time. We then stop all messages to the child.",
      ],
    },
    {
      heading: "Automated decisions and AI",
      paragraphs: [
        "Our software chooses each day's questions from how the student has been doing (weaker topics come up more often). This has no legal or similarly significant effect on anyone.",
        "'Explain another way' asks an AI model (Anthropic's Claude) to re-explain one question. The model only ever sees the question, its options, the correct answer and the teacher's explanation, never the student's name, number or any other personal data. Students cannot chat with it.",
      ],
    },
    {
      heading: "Who we share it with",
      paragraphs: [
        "We never sell personal data. We share only what each of these service providers needs to run KinPrep for us, under contracts that require them to protect it:",
      ],
      bullets: [
        "Supabase (database and sign-in), hosted in [London, United Kingdom].",
        "Vercel (website hosting).",
        "Stripe (card payments in GBP, USD and CAD) and Paystack (payments in naira). They hold card details; we never see or store them.",
        "Meta (WhatsApp Business messages).",
        "Resend (emails).",
        "Anthropic (AI explanations; question text only, no personal data).",
        "Sentry (error reports, with emails, phone numbers and links removed before they are sent).",
        "The payer's co-sponsors: if you invite a relative to follow your child's progress, they see that child's progress.",
      ],
    },
    {
      heading: "International transfers",
      paragraphs: [
        "Our database is in [the United Kingdom], so information about students in Nigeria is transferred out of Nigeria. We rely on [the adequacy decision / standard contractual clauses / the consent of the parent or guardian, as permitted by sections 41 to 43 of the NDPA]. Some providers above process data in the United States under [the UK Extension to the EU-US Data Privacy Framework / international data transfer agreements].",
      ],
    },
    {
      heading: "How long we keep it",
      bullets: [
        "A student's profile, practice and consent records: while the account is open. Deleting the student deletes them at once.",
        `WhatsApp and email message logs: ${RETENTION_DAYS.messageLog} days.`,
        `Queued messages: ${RETENTION_DAYS.outboundQueue} days. Records of inbound messages being processed: ${RETENTION_DAYS.waJobs} days.`,
        `Raw payment notifications from Stripe and Paystack: ${RETENTION_DAYS.billingEvents} days.`,
        "Payment records (amounts and dates): [6] years, for tax and accounting law. After a student is deleted these no longer link to them.",
        "A record that a data request was made (its date and type, no personal details), so we can show we handled it.",
        "Backups: encrypted, kept for [30] days, then deleted.",
      ],
    },
    {
      heading: "Your rights",
      paragraphs: [
        "You (and, for a child, their parent or guardian) have the right to: be told how data is used (this notice); get a copy of it; have it corrected; have it deleted; restrict or object to how it is used; take it elsewhere (data portability); and withdraw consent at any time.",
        "From your account: Settings has 'Download data' and 'Delete [name]'s data' for each child, which work straight away. For anything else, email us at " +
          `${CONTACT}. We reply within [30] days.`,
        "You can complain to the Nigeria Data Protection Commission (ndpc.gov.ng) or, in the UK, the Information Commissioner's Office (ico.org.uk). We'd like the chance to help first.",
      ],
    },
    {
      heading: "Security",
      paragraphs: [
        "Data is encrypted in transit and at rest. Access is limited to the KinPrep staff who need it, and every admin change is logged. Practice links expire after 24 hours. If a breach puts your data at risk we will tell you and the regulator (NDPC within 72 hours; in the UK, the ICO within 72 hours) as the law requires.",
      ],
    },
    {
      heading: "Changes",
      paragraphs: [
        `We'll tell you by email before any change that affects how we use your data. Guardian consent is recorded against the version of the consent wording shown at the time (currently ${CONSENT_TEXT_VERSION}).`,
      ],
    },
  ],
};

export const TERMS: LegalDoc = {
  title: "Terms of service",
  version: "2026-10-draft-1",
  updated: "4 October 2026",
  summary: [
    `A ${TRIAL_DAYS}-day free trial, then a weekly, monthly or yearly plan. Cancel any time; the plan runs to the end of the period you've paid for.`,
    "KinPrep is exam practice and coaching. It helps, but it cannot guarantee exam results.",
    "Questions are written for KinPrep by teachers, mapped to the published syllabus. They are not past exam papers.",
  ],
  sections: [
    {
      heading: "About these terms",
      paragraphs: [
        `These terms are an agreement between you (the payer: a parent, guardian, sponsor or group) and ${CONTROLLER} ("KinPrep", "we"). By creating an account or paying, you agree to them. Our privacy notice explains how we use personal data.`,
      ],
    },
    {
      heading: "The service",
      paragraphs: [
        "Students get a set of practice questions each day, with marking and explanations: on WhatsApp for students 13 and over, or on a web page for younger students. Payers get a weekly progress report.",
        "We aim to run every day but can't promise the service will never be interrupted (for example if WhatsApp or our hosting providers have problems).",
      ],
    },
    {
      heading: "Accounts and consent",
      bullets: [
        "You must be 18 or over to create an account and pay.",
        "Before a student can use KinPrep, their parent or legal guardian must agree on their behalf. If you are not the child's parent or guardian, we send them a link to agree; nothing reaches the child until they do.",
        "Give accurate details, particularly the child's birth year: it decides whether they may use WhatsApp.",
        "Keep access to your email account safe; it's how you sign in.",
      ],
    },
    {
      heading: "Plans, payment and the free trial",
      bullets: [
        `From abroad: ${price("abroad_monthly", "GBP")} a month or ${price("abroad_yearly", "GBP")} a year (or the USD and CAD prices shown at checkout), by card through Stripe.`,
        `In Nigeria: ${price("nigeria_weekly", "NGN")} a week or ${price("nigeria_monthly", "NGN")} a month, by card, bank transfer or USSD through Paystack.`,
        `Groups: ${price("bulk_seat_monthly", "GBP")} per seat per month.`,
        `Each student can have one ${TRIAL_DAYS}-day free trial.`,
        "Card plans renew automatically until cancelled. Transfer and USSD payments buy one week or month at a time and don't renew by themselves.",
        `If a renewal payment fails, the student keeps access for a ${GRACE_DAYS}-day grace period while you update your payment.`,
        "We'll tell you at least [30] days before a price change, and it applies from your next renewal.",
      ],
    },
    {
      heading: "Cancelling and refunds",
      paragraphs: [
        "Cancel any time from Settings. Your plan stays active until the end of the period you've paid for, then stops; you won't be charged again.",
        "[Refund policy for the lawyer to confirm, including the UK 14-day cancellation right for digital services and how it applies after the free trial.] Ask at [support@kinprep.ng] and we'll treat every request fairly.",
      ],
    },
    {
      heading: "Using KinPrep fairly",
      bullets: [
        "Use KinPrep only for the students you signed up, and don't share practice links outside the family.",
        "Don't try to break, overload, copy or resell the service or its questions.",
        "Students can send STOP on WhatsApp at any time to stop all messages, and START to begin again.",
        "We may pause or close an account that breaks these terms, after telling you why where we can.",
      ],
    },
    {
      heading: "Questions, explanations and AI",
      paragraphs: [
        "Every question is checked and approved by a teacher before any student sees it. If you think an answer is wrong, tell us and a teacher will re-check it.",
        "'Explain another way' uses an AI model to re-explain a question the teacher has already approved. It cannot change the answer, and students can't chat with it. AI explanations can still be imperfect; the teacher's explanation is always shown too.",
        "The questions, explanations and software belong to KinPrep. You may use them for your students' own practice.",
      ],
    },
    {
      heading: "Ambassadors and groups",
      paragraphs: [
        `Ambassadors who refer payers earn ${AMBASSADOR_COMMISSION.rateBps / 100}% of each referred payer's first ${AMBASSADOR_COMMISSION.firstMonths} months of payments, under separate ambassador terms. Groups (churches, alumni associations, schools) buying seats are responsible for collecting each child's guardian consent through their invite link.`,
      ],
    },
    {
      heading: "Our responsibility to you",
      paragraphs: [
        "We provide KinPrep with reasonable care and skill. We are not responsible for exam results, or for losses we couldn't reasonably have foreseen. Nothing in these terms limits liability that the law doesn't allow us to limit, or your rights as a consumer. [Liability cap and wording for the lawyer to confirm.]",
      ],
    },
    {
      heading: "Changes and the law",
      paragraphs: [
        "We'll email you before changing these terms in a way that affects you. If you don't agree, you can cancel before the change applies.",
        "[Governing law and courts, for the lawyer to decide: e.g. the laws of England and Wales for payers abroad and of the Federal Republic of Nigeria for payers in Nigeria, without taking away any consumer protections where you live.]",
        `Questions about these terms: ${CONTACT}.`,
      ],
    },
  ],
};

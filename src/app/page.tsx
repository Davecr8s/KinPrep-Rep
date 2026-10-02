import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { STREAK_DAY_THRESHOLD, QUESTIONS_PER_DAY } from "@/config/pilot";
import { PLANS, TRIAL_DAYS } from "@/config/pricing";
import { styles } from "@/components/ui";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = {
  title: { absolute: "KinPrep: daily exam practice, weekly proof" },
};

type Region = "abroad" | "nigeria";

function pickRegion(query: string | string[] | undefined, country: string | null): Region {
  if (query === "abroad" || query === "nigeria") return query;
  return country === "NG" ? "nigeria" : "abroad";
}

const FAQ = [
  {
    q: "How does it work?",
    a: `Your child gets ${QUESTIONS_PER_DAY.default} exam questions a day on WhatsApp (or on a web page from your phone if they're under 13). Every question is written for the WAEC, NECO, JAMB or BECE syllabus and checked by a teacher. If they get one wrong, KinPrep explains it again, in English or Pidgin. Every Sunday you get a report showing which days they practised and what they need to work on.`,
  },
  {
    q: "Can I cancel any time?",
    a: "Yes. Cancel from your settings in two taps. You keep access until the end of the time you've paid for, and you're never charged again.",
  },
  {
    q: "Is my child's data safe?",
    a: "We collect the minimum: first name, surname initial, class, birth year, exam and subjects, plus a WhatsApp number for children 13 and over. We never message children under 13 on WhatsApp, and never message any child before a parent or guardian agrees. Card details go straight to Stripe or Paystack; we never see or store them. You can download or delete your child's data at any time. We follow the Nigeria Data Protection Act 2023 and UK GDPR.",
  },
  {
    q: "What counts as a day of practice?",
    a: `Answering at least ${STREAK_DAY_THRESHOLD} questions in a day (Lagos time). That keeps their streak going and fills in a dot in your report.`,
  },
  {
    q: "Can a church, school or alumni group pay for students?",
    a: `Yes. Buy seats at ${formatMoney(PLANS.bulk_seat_monthly.prices.GBP, "GBP")} per student per month, share one link with your students, and see a class leaderboard (first names only).`,
  },
];

export default async function Home({ searchParams }: PageProps<"/">) {
  const query = await searchParams;
  const region = pickRegion(query.region, (await headers()).get("x-vercel-ip-country"));
  const prices =
    region === "abroad"
      ? [
          { amount: formatMoney(PLANS.abroad_monthly.prices.GBP, "GBP"), per: "a month" },
          { amount: formatMoney(PLANS.abroad_yearly.prices.GBP, "GBP"), per: "a year" },
        ]
      : [
          { amount: formatMoney(PLANS.nigeria_weekly.prices.NGN, "NGN"), per: "a week" },
          { amount: formatMoney(PLANS.nigeria_monthly.prices.NGN, "NGN"), per: "a month" },
        ];

  return (
    <main className="flex flex-1 flex-col">
      <section className="bg-navy px-4 pt-10 pb-12 text-white">
        <div className="mx-auto max-w-md">
          <p className="text-lg font-bold">
            Kin<span className="text-orange">Prep</span>
          </p>
          <h1 className="mt-6 text-4xl leading-tight font-bold">
            They practise daily. You see the proof every Sunday.
          </h1>
          <p className="mt-4 text-lg text-white/90">
            Daily WAEC, NECO and JAMB practice for your child on WhatsApp, checked by teachers. A
            clear weekly report for you, wherever you live.
          </p>
          <Link
            href={`/app/sign-in?region=${region}`}
            className={`${styles.primaryButton} mt-8 w-full text-lg`}
          >
            Start your {TRIAL_DAYS}-day free trial
          </Link>
          <p className="mt-3 text-center text-sm text-white/80">Cancel any time.</p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-md px-4 py-10" aria-labelledby="prices">
        <h2 id="prices" className="text-2xl font-bold text-navy-dark">
          Prices
        </h2>
        <div className="mt-3 flex gap-2" role="group" aria-label="Where do you live?">
          {(["abroad", "nigeria"] as const).map((r) => (
            <Link
              key={r}
              href={`/?region=${r}#prices`}
              scroll={false}
              aria-current={r === region ? "true" : undefined}
              className={`rounded-full border-2 px-4 py-2 font-semibold ${
                r === region ? "border-navy bg-navy text-white" : "border-navy/30 text-navy"
              }`}
            >
              {r === "abroad" ? "I live abroad" : "I live in Nigeria"}
            </Link>
          ))}
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          {prices.map((p) => (
            <div key={p.per} className={styles.card}>
              <p className="text-3xl font-bold text-navy-dark">{p.amount}</p>
              <p className="text-navy-dark/70">{p.per}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm text-navy-dark/70">
          {region === "abroad"
            ? "Pay by card in pounds, dollars or Canadian dollars."
            : "Pay by card, bank transfer or USSD."}{" "}
          First {TRIAL_DAYS} days free.
        </p>
      </section>

      <section className="mx-auto w-full max-w-md px-4 pb-10" aria-labelledby="how">
        <h2 id="how" className="text-2xl font-bold text-navy-dark">
          How it works
        </h2>
        <ol className="mt-4 flex flex-col gap-4">
          {[
            ["Sign up and add your child", "First name, class and exam. It takes two minutes."],
            [
              "They practise every day",
              "Short sets of exam questions, with explanations in English or Pidgin.",
            ],
            [
              "You see the proof every Sunday",
              "Days practised, accuracy and the topics to work on, on WhatsApp or in the app.",
            ],
          ].map(([title, body], i) => (
            <li key={title} className="flex gap-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-orange font-bold text-navy-dark">
                {i + 1}
              </span>
              <span>
                <span className="block font-semibold text-navy-dark">{title}</span>
                <span className="text-navy-dark/80">{body}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto w-full max-w-md px-4 pb-12" aria-labelledby="faq">
        <h2 id="faq" className="text-2xl font-bold text-navy-dark">
          Questions
        </h2>
        <div className="mt-4 flex flex-col gap-2">
          {FAQ.map((item) => (
            <details key={item.q} className="group rounded-lg border border-navy/15 px-4 py-3">
              <summary className="cursor-pointer list-none font-semibold text-navy-dark marker:hidden">
                <span className="flex items-center justify-between gap-4">
                  {item.q}
                  <span aria-hidden className="text-xl text-navy transition group-open:rotate-45">
                    +
                  </span>
                </span>
              </summary>
              <p className="mt-2 text-navy-dark/80">{item.a}</p>
            </details>
          ))}
        </div>
        <Link
          href={`/app/sign-in?region=${region}`}
          className={`${styles.primaryButton} mt-8 w-full`}
        >
          Start your free trial
        </Link>
        <p className="mt-6 text-center text-sm text-navy-dark/70">
          Buying for a group?{" "}
          <Link href="/app/sign-in?region=abroad&group=1" className={styles.link}>
            Sign up as a group
          </Link>
        </p>
      </section>
    </main>
  );
}

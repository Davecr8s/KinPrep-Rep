import {
  TEMPLATES,
  renderTemplate,
  type TemplateDefinition,
  type TemplateKey,
} from "@/config/templates";
import { getStudentAccess } from "@/lib/access";
import type { Sql } from "@/lib/db/sql";
import { streakThreshold } from "@/lib/engine";
import { practiceUrl, signPracticeLink } from "@/lib/practice/links";
import { accessStore, answerHistory } from "@/lib/practice/repo";
import { addDays, lagosDay, lagosDayStart } from "@/lib/rules/days";
import type { Outbound, TemplateButtonValue } from "@/lib/whatsapp/messages";
import type { EmailMessage } from "./email";
import { enqueue, type QueueItem } from "./queue";
import { joinNames, missedDaysInARow, reportDue, weeklyReportValues, weeklySummary } from "./rules";

// The scheduled jobs. Each one works out who should get what right now and adds those messages to
// the queue (src/lib/jobs/queue.ts) under a dedupe key, so running a job twice adds nothing the
// second time. In a dry run the messages are recorded as dry runs only and nothing is sent.

export const JOBS = [
  "morning",
  "junior-links",
  "reminder",
  "missed-days",
  "weekly-reports",
] as const;
export type JobName = (typeof JOBS)[number];

export type JobContext = {
  sql: Sql;
  now: Date;
  dryRun: boolean;
  appUrl: string;
  practiceSecret: string;
};

export type Planned = {
  channel: "whatsapp" | "email";
  to: string;
  /** Template name, or the email subject. */
  message: string;
  /** Which student(s) it's about. */
  about: string;
  preview: string;
  /** False when this exact message was already queued or sent by an earlier run. */
  queued: boolean;
};

export type JobReport = {
  job: JobName;
  day: string;
  at: Date;
  dryRun: boolean;
  planned: Planned[];
  skipped: { who: string; reason: string }[];
  note?: string;
};

type Message = Pick<
  QueueItem,
  "channel" | "recipient" | "template" | "category" | "payload" | "preview"
>;

function templateMessage(
  ctx: JobContext,
  key: TemplateKey,
  to: string,
  values: string[],
  urlSuffix?: string,
): Message {
  const t: TemplateDefinition = TEMPLATES[key];
  const buttons: TemplateButtonValue[] = (t.buttons ?? []).map((b, index) =>
    b.type === "quick_reply"
      ? { index, type: "quick_reply", payload: b.payload }
      : { index, type: "url", text: urlSuffix ?? "" },
  );
  const payload: Outbound = {
    kind: "template",
    name: t.name,
    language: t.language,
    body: values,
    buttons,
  };
  const button = t.buttons?.[0];
  const label = button
    ? button.type === "url"
      ? ` [${button.text}: ${button.url.replace("{APP_URL}", ctx.appUrl).replace("{{1}}", urlSuffix ?? "")}]`
      : ` [${button.text}]`
    : "";
  return {
    channel: "whatsapp",
    recipient: to,
    template: t.name,
    category: t.category,
    payload,
    preview: renderTemplate(key, values) + label,
  };
}

function emailMessage(to: string, subject: string, lines: string[]): Message {
  const payload: EmailMessage = { to, subject, text: lines.join("\n") };
  return {
    channel: "email",
    recipient: to,
    template: null,
    category: "email",
    payload,
    preview: `${subject}: ${lines.join(" ")}`,
  };
}

type PayerContact = {
  id: string;
  whatsapp: string | null;
  opted_in: boolean;
  stopped: boolean;
  email: string | null;
};

/** WhatsApp if the payer opted in (and hasn't sent STOP), otherwise email, otherwise nothing. */
function payerChannel(p: PayerContact): "whatsapp" | "email" | null {
  if (p.whatsapp && p.opted_in && !p.stopped) return "whatsapp";
  return p.email ? "email" : null;
}

const PAYER_CONTACT = `p.whatsapp_number as whatsapp,
  p.whatsapp_reports_opt_in_at is not null as opted_in,
  c.opted_out_at is not null as stopped,
  u.email`;

async function accessReason(ctx: JobContext, studentId: string): Promise<string | null> {
  const access = await getStudentAccess(studentId, { now: ctx.now, store: accessStore(ctx.sql) });
  if (access.awaitingConsent) return "waiting for guardian consent";
  return access.state === "inactive" ? "plan not active" : null;
}

class Collector {
  planned: Planned[] = [];
  skipped: { who: string; reason: string }[] = [];
  constructor(private ctx: JobContext) {}

  async add(
    item: Omit<QueueItem, keyof Message> & { message: Message; about: string },
  ): Promise<void> {
    const { message, about, ...rest } = item;
    const queued = await enqueue(this.ctx.sql, { ...rest, ...message }, this.ctx);
    this.planned.push({
      channel: message.channel,
      to: message.recipient,
      message:
        message.channel === "email" ? (message.payload as EmailMessage).subject : message.template!,
      about,
      preview: message.preview,
      queued,
    });
  }

  skip(who: string, reason: string) {
    this.skipped.push({ who, reason });
  }
}

const endOfLagosDay = (day: string) => lagosDayStart(addDays(day, 1));

type SeniorRow = {
  id: string;
  first_name: string;
  phone: string;
  opt_in: boolean;
  stopped: boolean;
  started: boolean;
};

/** Seniors with a WhatsApp number, grouped by number, who may get a business-started message. */
async function seniorHouseholds(
  ctx: JobContext,
  out: Collector,
  options: { notStartedOnly: boolean },
): Promise<Map<string, SeniorRow[]>> {
  const day = lagosDay(ctx.now);
  const rows = await ctx.sql.query<SeniorRow>(
    `select s.id::text, s.first_name, s.whatsapp_number as phone,
            s.whatsapp_opt_in_at is not null as opt_in,
            c.opted_out_at is not null as stopped,
            exists (select 1 from public.practice_sessions ps
                    where ps.student_id = s.id and ps.lagos_day = $1) as started
     from public.students s
     left join public.wa_contacts c on c.phone = s.whatsapp_number
     where s.whatsapp_number is not null and public.is_senior_birth_year(s.birth_year)
     order by s.whatsapp_number, s.created_at`,
    [day],
  );
  const households = new Map<string, SeniorRow[]>();
  for (const s of rows) {
    const reason = !s.opt_in
      ? "hasn't opted in to WhatsApp messages"
      : s.stopped
        ? "sent STOP"
        : options.notStartedOnly && s.started
          ? "already started today"
          : await accessReason(ctx, s.id);
    if (reason) {
      out.skip(s.first_name, reason);
      continue;
    }
    households.set(s.phone, [...(households.get(s.phone) ?? []), s]);
  }
  return households;
}

/** 07:00 Lagos: "Your practice is ready, tap Start" to opted-in active seniors. */
async function morning(ctx: JobContext, out: Collector): Promise<void> {
  const day = lagosDay(ctx.now);
  for (const [phone, students] of await seniorHouseholds(ctx, out, { notStartedOnly: false })) {
    const names = joinNames(students.map((s) => s.first_name));
    await out.add({
      job: "morning",
      dedupeKey: `morning:${day}:${phone}`,
      studentId: students[0]!.id,
      lagosDay: day,
      expiresAt: endOfLagosDay(day),
      message: templateMessage(ctx, "morningPractice", phone, [names]),
      about: names,
    });
  }
}

/** 18:00 Lagos: a reminder to opted-in seniors who haven't started, if reminders are on. */
async function reminder(ctx: JobContext, out: Collector): Promise<string | undefined> {
  const [setting] = await ctx.sql.query<{ value: unknown }>(
    "select value from public.settings where key = 'reminder_enabled'",
  );
  if (setting?.value !== true && setting?.value !== "true") {
    return "Reminders are off (settings.reminder_enabled). Nothing to send.";
  }
  const day = lagosDay(ctx.now);
  for (const [phone, students] of await seniorHouseholds(ctx, out, { notStartedOnly: true })) {
    const names = joinNames(students.map((s) => s.first_name));
    await out.add({
      job: "reminder",
      dedupeKey: `reminder:${day}:${phone}`,
      studentId: students[0]!.id,
      lagosDay: day,
      expiresAt: endOfLagosDay(day),
      message: templateMessage(ctx, "practiceReminder", phone, [names]),
      about: names,
    });
  }
}

/** 07:00 Lagos: each active junior's practice link, to the parent (never to the child). */
async function juniorLinks(ctx: JobContext, out: Collector): Promise<void> {
  const day = lagosDay(ctx.now);
  const rows = await ctx.sql.query<PayerContact & { student_id: string; first_name: string }>(
    `select s.id::text as student_id, s.first_name, s.owner_id::text as id, ${PAYER_CONTACT}
     from public.students s
     left join public.payers p on p.id = s.owner_id
     left join auth.users u on u.id = s.owner_id
     left join public.wa_contacts c on c.phone = p.whatsapp_number
     where not public.is_senior_birth_year(s.birth_year)
     order by s.created_at`,
  );
  for (const r of rows) {
    const reason = await accessReason(ctx, r.student_id);
    if (reason) {
      out.skip(r.first_name, reason);
      continue;
    }
    const channel = payerChannel(r);
    if (!channel) {
      out.skip(r.first_name, "parent has no WhatsApp opt-in and no email");
      continue;
    }
    const token = signPracticeLink(
      { studentId: r.student_id, issuedAt: ctx.now },
      ctx.practiceSecret,
    );
    const url = practiceUrl(ctx.appUrl, token);
    const message =
      channel === "whatsapp"
        ? templateMessage(ctx, "juniorPracticeLink", r.whatsapp!, [r.first_name], token)
        : emailMessage(r.email!, `${r.first_name}'s KinPrep practice for today`, [
            `Good morning! Today's KinPrep practice for ${r.first_name} is ready.`,
            `Open this link on your phone and hand it over (it works for 24 hours): ${url}`,
          ]);
    await out.add({
      job: "junior_link",
      dedupeKey: `junior_link:${day}:${r.student_id}`,
      studentId: r.student_id,
      payerId: r.id,
      lagosDay: day,
      expiresAt: endOfLagosDay(day),
      message,
      about: r.first_name,
    });
  }
}

/** 21:00 Lagos: a student has missed 2 days in a row: tell each payer once, flag the dashboard. */
async function missedDays(ctx: JobContext, out: Collector): Promise<void> {
  const day = lagosDay(ctx.now);
  const students = await ctx.sql.query<{ id: string; first_name: string; created_at: Date }>(
    "select id::text, first_name, created_at from public.students order by created_at",
  );
  for (const s of students) {
    const answered = await ctx.sql.query<{ day: string }>(
      `select distinct to_char(answered_at at time zone 'Africa/Lagos', 'YYYY-MM-DD') as day
       from public.answers where student_id = $1 and answered_at >= $2`,
      [s.id, lagosDayStart(addDays(day, -60))],
    );
    const missed = missedDaysInARow(
      new Set(answered.map((a) => a.day)),
      day,
      lagosDay(new Date(s.created_at)),
    );
    if (missed.days < 2 || !missed.since) continue;
    const reason = await accessReason(ctx, s.id);
    if (reason) {
      out.skip(s.first_name, `missed ${missed.days} days, but ${reason}`);
      continue;
    }
    if (!ctx.dryRun) {
      await ctx.sql.query(
        `insert into public.student_alerts (student_id, kind, since_day, days)
         values ($1, 'missed_days', $2, $3)
         on conflict (student_id, kind, since_day) do update set days = excluded.days`,
        [s.id, missed.since, missed.days],
      );
    }
    const payers = await ctx.sql.query<PayerContact>(
      `select pr.id::text as id, ${PAYER_CONTACT}
       from public.profiles pr
       left join public.payers p on p.id = pr.id
       left join auth.users u on u.id = pr.id
       left join public.wa_contacts c on c.phone = p.whatsapp_number
       where pr.id = (select owner_id from public.students where id = $1)
          or pr.id in (select viewer_id from public.student_viewers where student_id = $1)
       order by pr.created_at`,
      [s.id],
    );
    for (const p of payers) {
      const channel = payerChannel(p);
      if (!channel) {
        out.skip(s.first_name, "a payer has no WhatsApp opt-in and no email");
        continue;
      }
      const days = String(missed.days);
      const message =
        channel === "whatsapp"
          ? templateMessage(ctx, "missedDays", p.whatsapp!, [s.first_name, days], s.id)
          : emailMessage(p.email!, `${s.first_name} hasn't practised for ${days} days`, [
              `${s.first_name} has not practised on KinPrep for ${days} days.`,
              "A short message from you can help them get back on track.",
              `See their progress: ${ctx.appUrl}/app/children/${s.id}`,
            ]);
      await out.add({
        job: "missed_days",
        dedupeKey: `missed_days:${missed.since}:${s.id}:${p.id}`,
        studentId: s.id,
        payerId: p.id,
        lagosDay: day,
        expiresAt: new Date(ctx.now.getTime() + 12 * 3600_000),
        message,
        about: s.first_name,
      });
    }
  }
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Weekly reports, due from each payer's chosen hour (Saturday evening to Sunday, their time). */
async function weeklyReports(ctx: JobContext, out: Collector): Promise<void> {
  const day = lagosDay(ctx.now);
  const threshold = await streakThreshold(ctx.sql);
  const payers = await ctx.sql.query<
    PayerContact & { timezone: string; report_weekday: number; report_hour: number }
  >(
    `select p.id::text as id, p.timezone, p.report_weekday, p.report_hour, ${PAYER_CONTACT}
     from public.payers p
     join auth.users u on u.id = p.id
     left join public.wa_contacts c on c.phone = p.whatsapp_number
     order by p.created_at`,
  );
  for (const p of payers) {
    const due = reportDue(
      { timezone: p.timezone, weekday: p.report_weekday, hour: p.report_hour },
      ctx.now,
    );
    const children = await ctx.sql.query<{ id: string; first_name: string }>(
      `select s.id::text, s.first_name from public.students s
       where s.owner_id = $1
          or s.id in (select student_id from public.student_viewers where viewer_id = $1)
       order by s.created_at`,
      [p.id],
    );
    if (children.length === 0) continue;
    const names = joinNames(children.map((c) => c.first_name));
    if (!due.due) {
      const hour = String(p.report_hour).padStart(2, "0");
      out.skip(
        `${names} (payer)`,
        `report time is ${WEEKDAY_NAMES[p.report_weekday]} ${hour}:00 ${p.timezone}`,
      );
      continue;
    }
    const channel = payerChannel(p);
    if (!channel) {
      out.skip(`${names} (payer)`, "no WhatsApp opt-in and no email");
      continue;
    }
    for (const child of children) {
      const reason = await accessReason(ctx, child.id);
      if (reason) {
        out.skip(child.first_name, reason);
        continue;
      }
      const answers = await answerHistory(
        ctx.sql,
        child.id,
        lagosDayStart(addDays(due.weekStart, -7)),
      );
      const summary = weeklySummary(answers, due.weekStart, child.first_name, threshold);
      const values = weeklyReportValues(child.first_name, summary);
      const message =
        channel === "whatsapp"
          ? templateMessage(ctx, "weeklyReport", p.whatsapp!, values, child.id)
          : emailMessage(p.email!, `${child.first_name}'s KinPrep week: ${values[1]} of 7 days`, [
              `Weekly KinPrep report for ${child.first_name} (week starting ${due.weekStart})`,
              `Practised on ${values[1]} of 7 days`,
              `Average score: ${values[2]} (${values[3]})`,
              `Topic to work on: ${values[4]}`,
              values[5]!,
              `Full report: ${ctx.appUrl}/app/children/${child.id}/report`,
            ]);
      await out.add({
        job: "weekly_report",
        dedupeKey: `weekly_report:${due.weekStart}:${child.id}:${p.id}`,
        studentId: child.id,
        payerId: p.id,
        lagosDay: day,
        expiresAt: new Date(ctx.now.getTime() + 12 * 3600_000),
        message,
        about: child.first_name,
      });
    }
  }
}

export async function runJob(job: JobName, ctx: JobContext): Promise<JobReport> {
  const out = new Collector(ctx);
  let note: string | undefined;
  if (job === "morning") await morning(ctx, out);
  else if (job === "junior-links") await juniorLinks(ctx, out);
  else if (job === "reminder") note = await reminder(ctx, out);
  else if (job === "missed-days") await missedDays(ctx, out);
  else await weeklyReports(ctx, out);
  return {
    job,
    day: lagosDay(ctx.now),
    at: ctx.now,
    dryRun: ctx.dryRun,
    planned: out.planned,
    skipped: out.skipped,
    ...(note ? { note } : {}),
  };
}

/** What a run did, for people: who gets what, what was already sent, who was left out and why. */
export function formatReport(report: JobReport): string {
  const fresh = report.planned.filter((p) => p.queued);
  const repeat = report.planned.length - fresh.length;
  const lines = [
    `${report.job} · ${report.day} (Lagos) · ${report.at.toISOString()}${report.dryRun ? " · DRY RUN (nothing sent)" : ""}`,
  ];
  if (report.note) lines.push(`  ${report.note}`);
  for (const p of fresh) {
    lines.push(
      `  ${p.channel === "whatsapp" ? "WhatsApp" : "Email   "} ${p.to.padEnd(26)} ${p.message} (${p.about})`,
      `      "${p.preview}"`,
    );
  }
  for (const s of report.skipped) lines.push(`  skipped  ${s.who}: ${s.reason}`);
  lines.push(
    `  ${fresh.length} new message${fresh.length === 1 ? "" : "s"}${repeat ? `, ${repeat} already queued or sent earlier (not sent again)` : ""}.`,
  );
  return lines.join("\n");
}

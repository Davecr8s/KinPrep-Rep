import { getStudentAccess } from "@/lib/access";
import type { Sql } from "@/lib/db/sql";
import { SUBJECT_LABELS } from "@/lib/labels";
import {
  advanceSet,
  explanationFor,
  leagueFor,
  markAnswer,
  setSummary,
  startOrResumeSet,
} from "@/lib/engine/session";
import { prewrittenAlternative, type ExplainAnotherWay } from "@/lib/practice/explain";
import {
  accessStore,
  answerHistory,
  getQuestion,
  recordedAnswer,
  sessionById,
  sponsorCode,
  takeEncouragements,
  todaySession,
  type PracticeStudent,
  type Session,
} from "@/lib/practice/repo";
import { addDays, lagosDay, lagosDayStart, weekStart } from "@/lib/rules/days";
import { currentStreak, streakThreshold, weekDots } from "@/lib/engine";
import { parseReply, parseText, replyIds, type Intent } from "./commands";
import { answerFeedback, LETTERS, nextButton, questionMessages } from "./question-format";
import { LIMITS, truncate, type Outbound } from "./messages";
import type { Outbox } from "./outbox";
import { logInbound, setActiveStudent, setOptedOut, studentsForPhone, touchContact } from "./repo";
import type { InboundMessage } from "./webhook";

export { questionMessages } from "./question-format";

// The senior-student WhatsApp bot. Students start each day themselves (START or the morning
// template's Start button), which opens the free 24-hour window; everything after that is a reply.

export type BotDeps = {
  sql: Sql;
  outbox: Outbox;
  now: Date;
  appUrl: string;
  explainAnotherWay?: ExplainAnotherWay;
  simulated?: boolean;
};

const text = (t: string): Outbound => ({ kind: "text", text: t });

export const COPY = {
  stopped:
    "You've stopped all KinPrep messages. We won't message you again.\n\nChanged your mind? Send START any time.",
  optedOut: "You've stopped KinPrep messages. Send START to begin again.",
  welcomeBack: "Welcome back to KinPrep! 👋",
  paused: (name: string) =>
    `Hi ${name}! Your KinPrep practice is paused for now. Your parent or guardian can ask us to restart it.`,
  morningOptIn:
    "I'll send you a short message each morning when your questions are ready. Send STOP any time to stop.",
  awaitingConsent:
    "Hi! Your KinPrep sign-up isn't finished yet: your parent or guardian needs to agree first. Ask them to check the link they were sent, then send START here.",
  noQuestions: "There are no questions ready for your subjects yet. Please try again later today.",
  help: [
    "KinPrep commands:",
    "START: today's questions",
    "SCORE: your score",
    "STREAK: your practice streak",
    "LEAGUE: this week's league",
    "HELP: this list",
    "STOP: stop all messages",
  ].join("\n"),
  unknown: (appUrl: string) =>
    [
      "Hello! 👋 This is KinPrep: daily WAEC, NECO and JAMB practice on WhatsApp, with a weekly progress report for your family.",
      `To start, ask your parent or guardian to sign up (the first 7 days are free): ${appUrl}/?ref=whatsapp`,
      "Once they've added you, send START here.",
    ].join("\n\n"),
  sponsor: (name: string, link: string) =>
    [
      `Hi ${name}! Your KinPrep practice is paused because your plan isn't active right now.`,
      `Forward this link to a parent, aunt, uncle or anyone who'd like to sponsor your exam practice:\n${link}`,
    ].join("\n\n"),
};

function endOfLagosDay(now: Date): Date {
  return lagosDayStart(addDays(lagosDay(now), 1));
}

function intentOf(message: InboundMessage): Intent {
  if (message.kind === "text") return parseText(message.text ?? "");
  if (message.kind === "reply") return parseReply(message.replyId ?? "");
  return { type: "unknown" };
}

export async function handleInbound(message: InboundMessage, deps: BotDeps): Promise<void> {
  const { sql, outbox, now } = deps;
  const phone = message.from;
  const contact = await touchContact(sql, phone, new Date(message.sentAt));
  const students = await studentsForPhone(sql, phone);
  const intent = intentOf(message);
  await logInbound(sql, {
    phone,
    studentId: contact.active_student_id ?? (students.length === 1 ? students[0]!.id : null),
    waId: message.id,
    kind: message.kind,
    body: message,
    simulated: deps.simulated ?? false,
  });
  const send = (msg: Outbound, studentId?: string) => outbox.send(phone, msg, { studentId });

  // STOP works for everyone, every time, and is always confirmed.
  if (intent.type === "command" && intent.command === "STOP") {
    await setOptedOut(sql, phone, now);
    await setActiveStudent(sql, phone, null, null);
    await send(text(COPY.stopped));
    return;
  }
  if (contact.opted_out_at) {
    if (!(intent.type === "command" && intent.command === "START")) {
      await send(text(COPY.optedOut));
      return;
    }
    await setOptedOut(sql, phone, null);
    await send(text(COPY.welcomeBack));
  }

  // Unknown number: the free-trial offer for their parent. Never collect a child's details here.
  if (students.length === 0) {
    await send(text(COPY.unknown(deps.appUrl)));
    return;
  }

  const store = accessStore(sql);
  const statuses = await Promise.all(
    students.map(async (s) => ({ s, access: await getStudentAccess(s.id, { now, store }) })),
  );
  const consented = statuses.filter((x) => !x.access.awaitingConsent);
  if (consented.length === 0) {
    await send(text(COPY.awaitingConsent));
    return;
  }
  const active = consented.filter((x) => x.access.state !== "inactive").map((x) => x.s);
  const isActive = (s: PracticeStudent) => active.some((a) => a.id === s.id);

  if (intent.type === "command" && intent.command === "HELP") {
    await send(text(COPY.help));
    return;
  }

  const sendSponsorLink = async (s: PracticeStudent) => {
    // Paused by KinPrep (a family's request): no sponsor link, just say so.
    if (statuses.find((x) => x.s.id === s.id)?.access.paused) {
      await send(text(COPY.paused(s.first_name)), s.id);
      return;
    }
    const code = await sponsorCode(sql, s.id);
    await send(text(COPY.sponsor(s.first_name, `${deps.appUrl}/sponsor/${code}`)), s.id);
  };

  // Which student is this?
  let student: PracticeStudent | undefined;
  let starting = intent.type === "command" && intent.command === "START";
  if (intent.type === "pick") {
    student = consented.find((x) => x.s.id === intent.studentId)?.s;
    starting = true;
  } else if (contact.active_student_id && contact.active_until && contact.active_until > now) {
    student = consented.find((x) => x.s.id === contact.active_student_id)?.s;
  }
  if (!student) {
    if (active.length === 1) student = active[0]!;
    else if (active.length > 1) {
      await send({
        kind: "list",
        text: "Who's practising today?",
        button: "Choose name",
        rows: active.slice(0, LIMITS.listRows).map((s) => ({
          id: replyIds.pick(s.id),
          title: truncate(`${s.first_name} ${s.last_initial}.`, LIMITS.rowTitle),
          description: s.class,
        })),
      });
      return;
    } else {
      for (const x of consented) await sendSponsorLink(x.s);
      return;
    }
  }
  if (!isActive(student)) {
    await sendSponsorLink(student);
    return;
  }
  await setActiveStudent(sql, phone, student.id, endOfLagosDay(now));

  const day = lagosDay(now);
  const current: PracticeStudent = student;
  const ctx = { ...deps, phone, student: current, day, send: (m: Outbound) => send(m, current.id) };

  if (starting) return startOrResume(ctx);
  switch (intent.type) {
    case "answer": {
      const session = await todaySession(sql, student.id, "whatsapp", day);
      if (session && !session.completed_at && session.awaiting === "answer") {
        return answer(ctx, session, session.position, intent.option);
      }
      return resume(ctx, session);
    }
    case "answerReply":
    case "next":
    case "explainAgain": {
      const session = await sessionById(sql, intent.sessionId, student.id);
      const current = session && !session.completed_at && intent.position === session.position;
      if (intent.type === "answerReply" && current && session.awaiting === "answer") {
        return answer(ctx, session, intent.position, intent.option);
      }
      if (intent.type === "next" && current && session.awaiting === "next")
        return advance(ctx, session);
      if (intent.type === "explainAgain" && session && intent.position <= session.position) {
        return explainAgain(ctx, session, intent.position);
      }
      // An old button: carry on from where they really are.
      return resume(ctx, await todaySession(sql, student.id, "whatsapp", day));
    }
    case "command":
      if (intent.command === "SCORE") return score(ctx);
      if (intent.command === "STREAK") return streak(ctx);
      if (intent.command === "LEAGUE") return showLeague(ctx);
      return startOrResume(ctx);
    default:
      await ctx.send({
        kind: "buttons",
        text: "Sorry, I didn't get that. What would you like to do?",
        buttons: [
          { id: replyIds.command("START"), title: "Start practice" },
          { id: replyIds.command("SCORE"), title: "My score" },
          { id: replyIds.command("HELP"), title: "Help" },
        ],
      });
  }
}

type Ctx = BotDeps & {
  phone: string;
  student: PracticeStudent;
  day: string;
  send: (m: Outbound) => Promise<unknown>;
};

async function startOrResume(ctx: Ctx): Promise<void> {
  const { sql, student, day, now } = ctx;
  const notes = await takeEncouragements(sql, student.id, now);
  if (notes.length > 0) {
    await ctx.send(text(`💬 A message from home:\n\n${notes.map((n) => `"${n}"`).join("\n\n")}`));
  }
  const set = await startOrResumeSet(sql, student, "whatsapp", day, now);
  if (set.kind === "noQuestions") {
    await ctx.send(text(COPY.noQuestions));
    return;
  }
  if (set.kind === "started") {
    // Sending START is the student's own opt-in to the morning message (and reminder).
    const [optedIn] = await sql.query(
      "update public.students set whatsapp_opt_in_at = $2 where id = $1 and whatsapp_opt_in_at is null returning id",
      [student.id, now],
    );
    await ctx.send(
      text(
        `Hi ${student.first_name}! Today's set has ${set.session.question_ids.length} questions. Let's go 💪` +
          (optedIn ? `\n\n${COPY.morningOptIn}` : ""),
      ),
    );
  }
  return resume(ctx, set.session);
}

async function resume(ctx: Ctx, session: Session | null): Promise<void> {
  if (!session) return startOrResume(ctx);
  if (session.completed_at) {
    const [r] = await ctx.sql.query<{ correct: number; answered: number }>(
      "select (count(*) filter (where correct))::int as correct, count(*)::int as answered from public.answers where session_id = $1",
      [session.id],
    );
    await ctx.send(
      text(
        `You've finished today's set, ${ctx.student.first_name}: ${r!.correct}/${r!.answered}. 🎉 Come back tomorrow for a new one!`,
      ),
    );
    await setActiveStudent(ctx.sql, ctx.phone, null, null);
    return;
  }
  if (session.awaiting === "next") {
    await ctx.send({
      kind: "buttons",
      text: `Ready for question ${Math.min(session.position + 2, session.question_ids.length)}?`,
      buttons: [nextButton(session)],
    });
    return;
  }
  return sendQuestion(ctx, session, session.position);
}

async function sendQuestion(ctx: Ctx, session: Session, position: number): Promise<void> {
  const q = await getQuestion(ctx.sql, session.question_ids[position]!);
  for (const m of questionMessages(q, session, position)) await ctx.send(m);
}

async function answer(ctx: Ctx, session: Session, position: number, option: number): Promise<void> {
  const marked = await markAnswer(ctx.sql, {
    session,
    studentId: ctx.student.id,
    position,
    option,
    now: ctx.now,
  });
  if (marked.kind === "stale") {
    return resume(ctx, await todaySession(ctx.sql, ctx.student.id, "whatsapp", ctx.day));
  }
  const q = marked.question;
  if (marked.kind === "invalidOption") {
    await ctx.send(text(`Please choose ${LETTERS.slice(0, q.options.length).join(", ")}.`));
    return;
  }
  await ctx.send(
    answerFeedback(
      q,
      { ...session, position },
      marked.correct,
      explanationFor(q, ctx.student.language),
    ),
  );
}

async function explainAgain(ctx: Ctx, session: Session, position: number): Promise<void> {
  const q = await getQuestion(ctx.sql, session.question_ids[position]!);
  const explain = ctx.explainAnotherWay ?? prewrittenAlternative;
  const chosen = await recordedAnswer(ctx.sql, session.id, q.id);
  const body = await explain({
    question: q,
    language: ctx.student.language,
    studentId: ctx.student.id,
    chosenIndex: chosen?.chosen ?? null,
  });
  const current = await sessionById(ctx.sql, session.id, ctx.student.id);
  await ctx.send(
    current && current.awaiting === "next" && current.position === position && !current.completed_at
      ? { kind: "buttons", text: truncate(body, LIMITS.body), buttons: [nextButton(current)] }
      : text(body),
  );
}

async function advance(ctx: Ctx, session: Session): Promise<void> {
  const moved = await advanceSet(ctx.sql, session, session.position, ctx.now);
  if (moved.kind === "stale") {
    return resume(ctx, await todaySession(ctx.sql, ctx.student.id, "whatsapp", ctx.day));
  }
  if (moved.kind === "question") return sendQuestion(ctx, moved.session, moved.session.position);
  // Free the number for a sibling.
  await setActiveStudent(ctx.sql, ctx.phone, null, null);
  const summary = await setSummary(ctx.sql, ctx.student.id, session.id, ctx.day);
  const lines = [
    `🎉 Well done, ${ctx.student.first_name}! You finished today's set.`,
    "",
    `Score: ${summary.correct}/${summary.answered}`,
    `Streak: ${summary.streak} ${summary.streak === 1 ? "day" : "days"} 🔥`,
  ];
  if (summary.focus) {
    lines.push(
      `Tomorrow's focus: ${summary.focus.topic} (${SUBJECT_LABELS[summary.focus.subject]})`,
    );
  }
  lines.push("", "Send LEAGUE to see how you rank this week.");
  await ctx.send(text(lines.join("\n")));
}

async function score(ctx: Ctx): Promise<void> {
  const monday = weekStart(ctx.day);
  const history = await answerHistory(ctx.sql, ctx.student.id, lagosDayStart(monday));
  const today = history.filter((a) => lagosDay(a.answeredAt) === ctx.day);
  const pct = (rows: typeof history) =>
    rows.length === 0
      ? "–"
      : `${Math.round((rows.filter((a) => a.correct).length / rows.length) * 100)}%`;
  await ctx.send(
    text(
      [
        `📊 ${ctx.student.first_name}'s score`,
        `Today: ${today.filter((a) => a.correct).length}/${today.length} (${pct(today)})`,
        `This week: ${history.filter((a) => a.correct).length}/${history.length} (${pct(history)})`,
      ].join("\n"),
    ),
  );
}

async function streak(ctx: Ctx): Promise<void> {
  const history = await answerHistory(
    ctx.sql,
    ctx.student.id,
    lagosDayStart(addDays(ctx.day, -120)),
  );
  const threshold = await streakThreshold(ctx.sql);
  const days = currentStreak(history, ctx.day, threshold);
  const dots = weekDots(history, ctx.day, threshold)
    .map((d, i) => `${"MTWTFSS"[i]}${d.practised ? "✅" : d.future ? "▫️" : "⬜"}`)
    .join(" ");
  await ctx.send(text(`🔥 Streak: ${days} ${days === 1 ? "day" : "days"}\n\nThis week: ${dots}`));
}

async function showLeague(ctx: Ctx): Promise<void> {
  const result = await leagueFor(ctx.sql, ctx.student, ctx.day);
  if (!result) return; // juniors only; they never reach the bot
  const { rows, scope } = result;
  const lines = rows
    .slice(0, 5)
    .map((r, i) => `${i + 1}. ${r.first_name} ${r.last_initial}. – ${r.correct} correct`);
  const myRank = rows.findIndex((r) => r.student_id === ctx.student.id);
  if (myRank >= 5) lines.push("…", `${myRank + 1}. You – ${rows[myRank]!.correct} correct`);
  await ctx.send(text(`🏆 This week's league (${scope})\n\n${lines.join("\n")}`));
}

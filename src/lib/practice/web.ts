import { z } from "zod";
import { getStudentAccess } from "@/lib/access";
import type { Sql } from "@/lib/db/sql";
import { lagosDay } from "@/lib/rules/days";
import {
  advanceSet,
  explanationFor,
  leagueFor,
  markAnswer,
  setSummary,
  startOrResumeSet,
} from "@/lib/engine/session";
import { prewrittenAlternative, type ExplainAnotherWay } from "./explain";
import { verifyPracticeLink, type PracticeLink } from "./links";
import {
  accessStore,
  getQuestion,
  pendingEncouragements,
  practiceStudent,
  questionsPerDay,
  recordedAnswer,
  sponsorCode,
  takeEncouragements,
  todaySession,
  type PracticeStudent,
} from "./repo";
import { CONTENT_SECURITY_POLICY } from "./web-csp";
import {
  feedbackScreen,
  messagePage,
  questionScreen,
  startScreen,
  summaryScreen,
} from "./web-html";

// The web practice page at /p/<token>: the second student entry point (juniors always; seniors
// as a fallback when WhatsApp is unavailable). Same engine as the bot; sessions are channel "web".

export type WebDeps = {
  sql: Sql;
  secret: string;
  appUrl: string;
  now: Date;
  explainAnotherWay?: ExplainAnotherWay;
};

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": CONTENT_SECURITY_POLICY,
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex",
    },
  });
}

type Loaded =
  | { kind: "ok"; link: PracticeLink; student: PracticeStudent }
  | { kind: "stop"; response: Response };

/** Checks the link, the student, consent and the plan. Anything else ends at a message page. */
async function load(token: string, deps: WebDeps): Promise<Loaded> {
  const stop = (response: Response): Loaded => ({ kind: "stop", response });
  const link = verifyPracticeLink(token, deps.secret, deps.now);
  if (!link.ok && link.reason === "expired") {
    return stop(
      html(
        messagePage({
          title: "This link has expired",
          lines: [
            "Practice links work for 24 hours.",
            "Ask your parent or guardian for today's link.",
          ],
        }),
        410,
      ),
    );
  }
  const student = link.ok ? await practiceStudent(deps.sql, link.studentId) : null;
  if (!link.ok || !student) {
    return stop(
      html(
        messagePage({
          title: "This link doesn't work",
          lines: [
            "Check you have the whole link, or ask your parent or guardian for today's link.",
          ],
        }),
        404,
      ),
    );
  }
  const access = await getStudentAccess(student.id, {
    now: deps.now,
    store: accessStore(deps.sql),
  });
  const firstName = student.first_name;
  if (access.awaitingConsent) {
    return stop(
      html(
        messagePage({
          firstName,
          title: "Almost ready",
          lines: [
            `${firstName}'s sign-up isn't finished yet: a parent or guardian needs to agree first.`,
            "Once they have, open this link again.",
          ],
        }),
        403,
      ),
    );
  }
  if (access.paused) {
    return stop(
      html(
        messagePage({
          firstName,
          title: "Practice is paused",
          lines: [
            `${firstName}'s KinPrep practice is paused for now. A parent or guardian can ask us to restart it.`,
          ],
        }),
        403,
      ),
    );
  }
  if (access.state === "inactive") {
    if (student.junior) {
      return stop(
        html(
          messagePage({
            firstName,
            title: "Practice is paused",
            lines: [
              `${firstName}'s KinPrep plan isn't active right now.`,
              "Parents: you can restart it in the KinPrep app.",
            ],
            link: { href: `${deps.appUrl}/app`, label: "Open the KinPrep app" },
          }),
          402,
        ),
      );
    }
    const code = await sponsorCode(deps.sql, student.id);
    return stop(
      html(
        messagePage({
          firstName,
          title: "Practice is paused",
          lines: [
            `Hi ${firstName}! Your KinPrep practice is paused because your plan isn't active right now.`,
            "Share your sponsor link with a parent, aunt, uncle or anyone who'd like to sponsor your exam practice:",
            `${deps.appUrl}/sponsor/${code}`,
          ],
          link: { href: `${deps.appUrl}/sponsor/${code}`, label: "Open my sponsor link" },
        }),
        402,
      ),
    );
  }
  return { kind: "ok", link, student };
}

/** GET /p/<token>: whatever the student should see right now. */
export async function practiceGet(token: string, url: URL, deps: WebDeps): Promise<Response> {
  const loaded = await load(token, deps);
  if (loaded.kind === "stop") return loaded.response;
  const { link, student } = loaded;
  const { sql } = deps;
  const firstName = student.first_name;
  const session = await todaySession(sql, student.id, "web", link.day);

  if (!session) {
    if (link.day !== lagosDay(deps.now)) {
      return html(
        messagePage({
          firstName,
          title: "This link was for another day",
          lines: ["Ask your parent or guardian for today's link."],
        }),
        410,
      );
    }
    return html(
      startScreen({
        firstName,
        count: await questionsPerDay(sql),
        messages: await pendingEncouragements(sql, student.id),
        junior: student.junior,
      }),
    );
  }

  if (session.completed_at) {
    return html(
      summaryScreen({
        firstName,
        studentId: student.id,
        summary: await setSummary(sql, student.id, session.id, link.day),
        league: await leagueFor(sql, student, link.day),
        junior: student.junior,
        oldLink: link.day !== lagosDay(deps.now),
      }),
    );
  }

  const position = session.position;
  const question = await getQuestion(sql, session.question_ids[position]!);
  const total = session.question_ids.length;
  if (session.awaiting === "answer") {
    return html(questionScreen({ firstName, question, position, total }));
  }
  const answer = await recordedAnswer(sql, session.id, question.id);
  const wantsAlt = url.searchParams.get("alt") === String(position);
  const explain = deps.explainAnotherWay ?? prewrittenAlternative;
  return html(
    feedbackScreen({
      firstName,
      question,
      position,
      total,
      chosen: answer?.chosen ?? -1,
      correct: answer?.correct ?? false,
      explanation: explanationFor(question, student.language),
      alternative: wantsAlt ? await explain({ question, language: student.language }) : undefined,
    }),
  );
}

const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({
    action: z.literal("answer"),
    position: z.coerce.number().int().min(0).max(99),
    option: z.coerce.number().int().min(0).max(9),
  }),
  z.object({ action: z.literal("next"), position: z.coerce.number().int().min(0).max(99) }),
]);

/**
 * POST /p/<token>: start, answer or next. Each is saved straight away and is safe to repeat;
 * the response is a redirect back to the page (post/redirect/get, so a reload never resubmits).
 */
export async function practicePost(
  token: string,
  form: URLSearchParams,
  deps: WebDeps,
): Promise<Response> {
  const loaded = await load(token, deps);
  if (loaded.kind === "stop") return loaded.response;
  const { link, student } = loaded;
  const { sql, now } = deps;
  const parsed = ActionSchema.safeParse(Object.fromEntries(form));
  if (parsed.success) {
    const action = parsed.data;
    const session = await todaySession(sql, student.id, "web", link.day);
    if (action.action === "start" && !session && link.day === lagosDay(now)) {
      const set = await startOrResumeSet(sql, student, "web", link.day, now);
      if (set.kind === "noQuestions") {
        return html(
          messagePage({
            firstName: student.first_name,
            title: "No questions yet",
            lines: [
              "There are no questions ready for your subjects yet. Please try again later today.",
            ],
          }),
        );
      }
      await takeEncouragements(sql, student.id, now);
    } else if (action.action === "answer" && session) {
      await markAnswer(sql, {
        session,
        studentId: student.id,
        position: action.position,
        option: action.option,
        now,
      });
    } else if (action.action === "next" && session) {
      await advanceSet(sql, session, action.position, now);
    }
  }
  return new Response(null, {
    status: 303,
    headers: { location: `/p/${token}`, "cache-control": "no-store" },
  });
}

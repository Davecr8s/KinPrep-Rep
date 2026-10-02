import { createHash } from "node:crypto";
import { SUBJECT_LABELS } from "@/lib/labels";
import type { WeekDot } from "@/lib/rules/progress";
import type { League, SetSummary } from "./engine";
import type { Question } from "./repo";

// The web practice page's HTML. Hand-written, with inline CSS and ~1 KB of script, so a load is
// a few KB on slow data with no framework to download. Every action is a plain form POST, so it
// works without JavaScript; the script only makes taps instant and, if the connection drops,
// keeps the tap on the phone and resends it when the phone is back online. The server ignores
// repeats, so resending is always safe.

const LETTERS = ["A", "B", "C", "D", "E"];

export function esc(value: string | number): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Plain text (explanations) as paragraphs. */
function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replaceAll("\n", "<br>")}</p>`)
    .join("");
}

const CSS = `
:root{--navy:#25308A;--navy-dark:#1b2468;--orange:#F0A93C;--orange-light:#fbe7c4;--ink:#161a33;--muted:#575d78;--line:#dcdfec;--bg:#f4f5fa;--ok:#17703f;--ok-bg:#e2f3e9;--bad:#b42318;--bad-bg:#fdeceb}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:18px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{background:var(--navy);color:#fff;padding:12px 16px;display:flex;justify-content:space-between;align-items:center}
header b{font-size:20px}header b span{color:var(--orange)}
main{max-width:560px;margin:0 auto;padding:16px 16px 32px}
h1{font-size:24px;line-height:1.3;margin:0 0 8px}
p{margin:0 0 12px}
.card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:20px 16px;margin:0 0 16px}
.meta{display:flex;justify-content:space-between;gap:8px;color:var(--muted);font-size:15px}
progress{display:block;width:100%;height:8px;margin:8px 0 16px;border:0;border-radius:4px;background:var(--line);overflow:hidden;-webkit-appearance:none;appearance:none}
progress::-webkit-progress-bar{background:var(--line)}
progress::-webkit-progress-value{background:var(--orange)}
progress::-moz-progress-bar{background:var(--orange)}
.stem{font-size:20px;font-weight:600;margin:0 0 16px;white-space:pre-line}
form{margin:0}
.opt{display:flex;gap:12px;align-items:center;width:100%;min-height:60px;padding:12px 14px;margin:0 0 10px;border:2px solid var(--line);border-radius:14px;background:#fff;color:inherit;font:inherit;text-align:left;cursor:pointer;touch-action:manipulation}
.opt .l{flex:none;width:34px;height:34px;border-radius:50%;background:var(--orange-light);color:var(--navy-dark);font-weight:700;display:flex;align-items:center;justify-content:center}
button.opt:active,.opt.picked{border-color:var(--navy);background:#eef0fb}
.opt.right{border-color:var(--ok);background:var(--ok-bg)}
.opt.right .l{background:var(--ok);color:#fff}
.opt.wrong{border-color:var(--bad);background:var(--bad-bg)}
.opt.wrong .l{background:var(--bad);color:#fff}
.opt.dim{opacity:.6}
.opt .tag{margin-left:auto;font-size:14px;font-weight:700;white-space:nowrap}
.verdict{font-size:22px;font-weight:700;margin:4px 0 8px}
.verdict.ok{color:var(--ok)}.verdict.bad{color:var(--bad)}
.btn{display:block;width:100%;min-height:56px;padding:14px 16px;border:2px solid var(--navy);border-radius:14px;background:var(--navy);color:#fff;font:inherit;font-weight:700;text-align:center;text-decoration:none;cursor:pointer;margin:12px 0 0;touch-action:manipulation}
.btn.alt{background:#fff;color:var(--navy)}
.btn:active{background:var(--navy-dark);color:#fff}
.alt-box{border-left:4px solid var(--orange);background:#fffaf0;border-radius:8px;padding:12px 14px;margin:12px 0 0}
.big{font-size:44px;font-weight:800;line-height:1.1;color:var(--navy)}
.stats{display:flex;gap:12px;margin:12px 0}
.stats>div{flex:1;background:var(--bg);border-radius:12px;padding:12px;text-align:center}
.stats small{display:block;color:var(--muted);font-size:14px}
.week{display:flex;justify-content:space-between;gap:4px;margin:8px 0 4px;padding:0;list-style:none}
.week li{flex:1;text-align:center;font-size:13px;color:var(--muted)}
.week i{display:block;width:30px;height:30px;margin:0 auto 4px;border-radius:50%;border:2px solid var(--line);background:#fff;font-style:normal;line-height:26px;color:#fff;font-weight:700}
.week .on i{background:var(--orange);border-color:var(--orange)}
.week .today i{border-color:var(--navy)}
ol.league{margin:8px 0 0;padding-left:24px}
ol.league li{padding:4px 0}
ol.league .me{font-weight:700;color:var(--navy)}
.msg{background:var(--orange-light);border-radius:12px;padding:12px 14px;margin:0 0 12px}
.muted{color:var(--muted);font-size:15px}
.note{display:none;background:#fff4e0;border:2px solid var(--orange);border-radius:12px;padding:12px 14px;margin:0 0 16px;font-size:16px}
.offline .note{display:block}
.busy button,.busy .btn{opacity:.6;pointer-events:none}
a{color:var(--navy)}
`.replace(/\n/g, "");

const SCRIPT = `(function(){var K="kp:"+location.pathname,busy=0,R=document.documentElement;
function get(){try{return JSON.parse(localStorage.getItem(K)||"null")}catch(e){return null}}
function put(v){try{v?localStorage.setItem(K,JSON.stringify(v)):localStorage.removeItem(K)}catch(e){}}
function send(d){if(busy)return;busy=1;R.classList.add("busy");R.classList.remove("offline");
fetch(location.pathname,{method:"POST",body:new URLSearchParams(d),credentials:"omit"}).then(function(r){if(r.status>=500)throw 0;return r.text()}).then(function(h){put(null);var n=new DOMParser().parseFromString(h,"text/html");document.title=n.title;document.body.replaceWith(n.body);scrollTo(0,0)},function(){put(d);R.classList.add("offline")}).then(function(){busy=0;R.classList.remove("busy")})}
document.addEventListener("submit",function(e){if(!window.fetch||!window.URLSearchParams||!window.DOMParser)return;e.preventDefault();var f=e.target,d={},i,b=f.querySelector("button");for(i=0;i<f.elements.length;i++)if(f.elements[i].name)d[f.elements[i].name]=f.elements[i].value;if(b)b.classList.add("picked");send(d)});
function retry(){var d=get();if(d)send(d)}addEventListener("online",retry);addEventListener("pageshow",retry)})();`;

const hash = (s: string) => `'sha256-${createHash("sha256").update(s).digest("base64")}'`;

/** Only our own inline style and script may run; nothing loads from anywhere else. */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  `style-src ${hash(CSS)}`,
  `script-src ${hash(SCRIPT)}`,
  "connect-src 'self'",
  "form-action 'self'",
  "img-src data:",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

const OFFLINE_NOTE =
  '<p class="note" role="status">No connection right now. Your answer is kept on this phone and will be sent as soon as you are back online.</p>';

export function page(input: { firstName?: string; body: string }): string {
  const name = input.firstName ? `<span>${esc(input.firstName)}</span>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><meta name="theme-color" content="#25308A"><title>Today's practice · KinPrep</title><link rel="icon" href="data:,"><style>${CSS}</style><script>${SCRIPT}</script></head><body><header><b>Kin<span>Prep</span></b>${name}</header><main>${OFFLINE_NOTE}${input.body}</main></body></html>`;
}

/** A message page: expired link, plan paused, and so on. */
export function messagePage(input: {
  firstName?: string;
  title: string;
  lines: string[];
  link?: { href: string; label: string };
}): string {
  const link = input.link
    ? `<a class="btn" href="${esc(input.link.href)}">${esc(input.link.label)}</a>`
    : "";
  return page({
    firstName: input.firstName,
    body: `<div class="card"><h1>${esc(input.title)}</h1>${input.lines.map((l) => `<p>${esc(l)}</p>`).join("")}${link}</div>`,
  });
}

function hidden(fields: Record<string, string | number>): string {
  return Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("");
}

export function startScreen(input: {
  firstName: string;
  count: number;
  messages: string[];
  junior: boolean;
}): string {
  const notes = input.messages
    .map((m) => `<div class="msg">💬 <b>A message from home:</b><br>“${esc(m)}”</div>`)
    .join("");
  const intro = input.junior
    ? `<p>Today's set has ${input.count} questions. Take your time: each answer is saved as soon as you tap it.</p>`
    : `<p>Today's set has ${input.count} questions. Each answer is saved as soon as you tap it, so you can stop and come back to this link any time today.</p>`;
  return page({
    firstName: input.firstName,
    body: `<div class="card"><h1>Hi ${esc(input.firstName)}! 👋</h1>${notes}${intro}<form method="post">${hidden({ action: "start" })}<button class="btn">Start today's questions</button></form></div>`,
  });
}

/** "Question 3 of 10" and a progress bar of how many are answered so far. */
function header(question: Question, position: number, total: number, answered: number): string {
  return `<div class="meta"><span>Question ${position + 1} of ${total}</span><span>${esc(SUBJECT_LABELS[question.subject])}</span></div><progress max="${total}" value="${answered}"></progress>`;
}

export function questionScreen(input: {
  firstName: string;
  question: Question;
  position: number;
  total: number;
}): string {
  const { question, position } = input;
  const options = question.options
    .map(
      (o, i) =>
        `<form method="post">${hidden({ action: "answer", position, option: i })}<button class="opt"><span class="l">${LETTERS[i]}</span> <span>${esc(o)}</span></button></form>`,
    )
    .join("");
  return page({
    firstName: input.firstName,
    body: `<div class="card">${header(question, position, input.total, position)}<p class="stem">${esc(question.stem)}</p>${options}</div>`,
  });
}

export function feedbackScreen(input: {
  firstName: string;
  question: Question;
  position: number;
  total: number;
  chosen: number;
  correct: boolean;
  explanation: string;
  /** "Explain another way", once asked for. */
  alternative?: string;
}): string {
  const { question, position } = input;
  const options = question.options
    .map((o, i) => {
      const right = i === question.answer_index;
      const mine = i === input.chosen;
      const cls = right ? "right" : mine ? "wrong" : "dim";
      const tag = right ? "✓ Answer" : mine ? "✗ Yours" : "";
      return `<div class="opt ${cls}"><span class="l">${LETTERS[i]}</span> <span>${esc(o)}</span>${tag ? `<span class="tag">${tag}</span>` : ""}</div>`;
    })
    .join("");
  const verdict = input.correct
    ? '<p class="verdict ok">✅ Correct!</p>'
    : `<p class="verdict bad">❌ Not quite. The answer is ${LETTERS[question.answer_index]}.</p>`;
  const last = position >= input.total - 1;
  const alternative = input.alternative
    ? `<div class="alt-box" id="alt">${paragraphs(input.alternative)}</div>`
    : `<a class="btn alt" href="?alt=${position}#alt">Explain another way</a>`;
  return page({
    firstName: input.firstName,
    body: `<div class="card">${header(question, position, input.total, position + 1)}<p class="stem">${esc(question.stem)}</p>${options}${verdict}${paragraphs(input.explanation)}${alternative}<form method="post">${hidden({ action: "next", position })}<button class="btn">${last ? "See my score ▶" : "Next question ▶"}</button></form></div>`,
  });
}

function weekRow(week: WeekDot[]): string {
  return `<ul class="week" aria-label="This week">${week
    .map(
      (d, i) =>
        `<li class="${d.practised ? "on" : ""}${d.today ? " today" : ""}"><i>${d.practised ? "✓" : ""}</i>${"MTWTFSS"[i]}</li>`,
    )
    .join("")}</ul>`;
}

export function summaryScreen(input: {
  firstName: string;
  studentId: string;
  summary: SetSummary;
  league: League | null;
  junior: boolean;
  /** The link was for an earlier day. */
  oldLink: boolean;
}): string {
  const { summary } = input;
  const focus = summary.focus
    ? `<p><b>Tomorrow's focus:</b> ${esc(summary.focus.topic)} (${esc(SUBJECT_LABELS[summary.focus.subject])})</p>`
    : "";
  let league = "";
  if (input.league && input.league.rows.length > 0) {
    const rows = input.league.rows.slice(0, 5);
    const myRank = input.league.rows.findIndex((r) => r.student_id === input.studentId);
    const items = rows.map((r) =>
      r.student_id === input.studentId
        ? `<li class="me">You: ${r.correct} correct</li>`
        : `<li>${esc(r.first_name)} ${esc(r.last_initial)}.: ${r.correct} correct</li>`,
    );
    if (myRank >= 5) {
      items.push(
        `<li value="${myRank + 1}" class="me">You: ${input.league.rows[myRank]!.correct} correct</li>`,
      );
    }
    league = `<div class="card"><h1>🏆 This week's league</h1><p class="muted">${esc(input.league.scope)}</p><ol class="league">${items.join("")}</ol></div>`;
  }
  const after = input.oldLink
    ? "<p>This link was for an earlier day. Ask for today's link to practise again.</p>"
    : input.junior
      ? "<p>See you tomorrow! You can hand the phone back now. 🙂</p>"
      : "<p>Come back tomorrow for a new set!</p>";
  return page({
    firstName: input.firstName,
    body: `<div class="card"><h1>🎉 Well done, ${esc(input.firstName)}!</h1><p>You finished today's set.</p><div class="stats"><div><span class="big">${summary.correct}/${summary.answered}</span><small>Score</small></div><div><span class="big">${summary.streak}</span><small>${summary.streak === 1 ? "day" : "days"} streak 🔥</small></div></div>${weekRow(summary.week)}${focus}${after}</div>${league}`,
  });
}

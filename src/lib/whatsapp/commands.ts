// What the student meant: a command, an answer letter, or a tapped button/row.

export const COMMANDS = ["START", "SCORE", "STREAK", "LEAGUE", "HELP", "STOP"] as const;
export type Command = (typeof COMMANDS)[number];

// WhatsApp expects common opt-out words to work, not just STOP.
const SYNONYMS: Record<string, Command> = {
  START: "START",
  BEGIN: "START",
  GO: "START",
  PRACTICE: "START",
  PRACTISE: "START",
  SCORE: "SCORE",
  STREAK: "STREAK",
  LEAGUE: "LEAGUE",
  HELP: "HELP",
  MENU: "HELP",
  STOP: "STOP",
  UNSUBSCRIBE: "STOP",
  CANCEL: "STOP",
  QUIT: "STOP",
  END: "STOP",
  "STOP ALL": "STOP",
};

export type Intent =
  | { type: "command"; command: Command }
  | { type: "answer"; option: number }
  | { type: "pick"; studentId: string }
  | { type: "answerReply"; sessionId: string; position: number; option: number }
  | { type: "next"; sessionId: string; position: number }
  | { type: "explainAgain"; sessionId: string; position: number }
  | { type: "unknown" };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Reply ids KinPrep puts on buttons and list rows. */
export const replyIds = {
  command: (c: Command) => `cmd:${c}`,
  pick: (studentId: string) => `pick:${studentId}`,
  answer: (sessionId: string, position: number, option: number) =>
    `ans:${sessionId}:${position}:${option}`,
  next: (sessionId: string, position: number) => `next:${sessionId}:${position}`,
  explainAgain: (sessionId: string, position: number) => `alt:${sessionId}:${position}`,
};

export function parseText(text: string): Intent {
  const clean = text
    .trim()
    .toUpperCase()
    .replace(/[.!?)\s]+$/, "")
    .replace(/\s+/g, " ");
  const command = SYNONYMS[clean];
  if (command) return { type: "command", command };
  const letter = /^\(?([A-E])$/.exec(clean);
  if (letter) return { type: "answer", option: letter[1]!.charCodeAt(0) - 65 };
  return { type: "unknown" };
}

export function parseReply(id: string): Intent {
  let m: RegExpExecArray | null;
  if ((m = /^cmd:([A-Z]+)$/.exec(id)) && COMMANDS.includes(m[1] as Command)) {
    return { type: "command", command: m[1] as Command };
  }
  // Template quick-reply buttons carry a bare payload such as "START".
  if (COMMANDS.includes(id.toUpperCase() as Command))
    return { type: "command", command: id.toUpperCase() as Command };
  if ((m = new RegExp(`^pick:(${UUID})$`).exec(id))) return { type: "pick", studentId: m[1]! };
  if ((m = new RegExp(`^ans:(${UUID}):(\\d{1,2}):(\\d)$`).exec(id))) {
    return { type: "answerReply", sessionId: m[1]!, position: Number(m[2]), option: Number(m[3]) };
  }
  if ((m = new RegExp(`^next:(${UUID}):(\\d{1,2})$`).exec(id)))
    return { type: "next", sessionId: m[1]!, position: Number(m[2]) };
  if ((m = new RegExp(`^alt:(${UUID}):(\\d{1,2})$`).exec(id)))
    return { type: "explainAgain", sessionId: m[1]!, position: Number(m[2]) };
  return { type: "unknown" };
}

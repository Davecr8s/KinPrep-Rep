// The last check before any WhatsApp message about a student leaves KinPrep (CLAUDE.md):
// guardian consent first, and nothing ever to a child under 13. The jobs and the bot already
// choose recipients this way; the outbox checks again at send time, so a bug elsewhere can't
// message a child.

export type StudentAtNumber = {
  /** The student this message is about (its studentId), or another student on the same number. */
  about: boolean;
  /** The recipient's number is this student's own WhatsApp number. */
  ownNumber: boolean;
  senior: boolean;
  consented: boolean;
  /** The recipient's number belongs to this student's payer or a co-sponsor. */
  payerNumber: boolean;
};

/**
 * Why a message must not be sent, or null if it may. `students` are every student the message
 * is about plus every student whose own number is the recipient. `businessInitiated` is true for
 * messages KinPrep starts; replies to someone who just wrote in are false.
 */
export function studentMessageProblem(
  students: readonly StudentAtNumber[],
  businessInitiated: boolean,
): string | null {
  for (const s of students) {
    // A child under 13 never receives WhatsApp messages (the database also refuses their number).
    if (s.ownNumber && !s.senior) return "student is under 13";
  }
  const about = students.find((s) => s.about);
  if (about) {
    if (!about.consented) return "no guardian consent";
    // About a student, to a number that is neither theirs nor their payer's: refuse. (A junior's
    // practice link goes to the parent, never to anyone else.)
    if (!about.ownNumber && !about.payerNumber) return "not the student's or payer's number";
    return null;
  }
  // Not about a named student, but to a student's own number: KinPrep may start a conversation
  // only if at least one student on that number has consent. Replies (e.g. "ask your guardian")
  // to someone who wrote in are allowed.
  const own = students.filter((s) => s.ownNumber);
  if (businessInitiated && own.length > 0 && !own.some((s) => s.consented)) {
    return "no guardian consent";
  }
  return null;
}

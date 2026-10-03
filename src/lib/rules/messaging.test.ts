import { describe, expect, it } from "vitest";
import { studentMessageProblem, type StudentAtNumber } from "./messaging";

const senior = (o: Partial<StudentAtNumber> = {}): StudentAtNumber => ({
  about: true,
  ownNumber: true,
  senior: true,
  consented: true,
  payerNumber: false,
  ...o,
});

describe("messages about a student (CLAUDE.md: consent first, nothing to under-13s)", () => {
  it("go to a consented senior's own number, or to their payer's", () => {
    expect(studentMessageProblem([senior()], true)).toBeNull();
    expect(studentMessageProblem([senior()], false)).toBeNull();
    // A junior's practice link to the parent.
    const junior = senior({ ownNumber: false, senior: false, payerNumber: true });
    expect(studentMessageProblem([junior], true)).toBeNull();
  });

  it("never go without guardian consent, even as a reply", () => {
    expect(studentMessageProblem([senior({ consented: false })], true)).toBe("no guardian consent");
    expect(studentMessageProblem([senior({ consented: false })], false)).toBe(
      "no guardian consent",
    );
  });

  it("never go to a child under 13's own number", () => {
    expect(studentMessageProblem([senior({ senior: false })], false)).toBe("student is under 13");
    // Even when the message is about someone else on that number.
    const sibling = senior({ about: false, senior: false });
    expect(
      studentMessageProblem([senior({ ownNumber: false, payerNumber: true }), sibling], true),
    ).toBe("student is under 13");
  });

  it("never go to a number that is neither the student's nor their payer's", () => {
    const junior = senior({ ownNumber: false, senior: false, payerNumber: false });
    expect(studentMessageProblem([junior], true)).toBe("not the student's or payer's number");
  });
});

describe("messages not about a named student", () => {
  it("may start a conversation on a student's number only if someone there has consent", () => {
    const ada = senior({ about: false });
    const chidi = senior({ about: false, consented: false });
    expect(studentMessageProblem([ada, chidi], true)).toBeNull();
    expect(studentMessageProblem([chidi], true)).toBe("no guardian consent");
    // A reply to someone who wrote in ("ask your guardian to agree first") is fine.
    expect(studentMessageProblem([chidi], false)).toBeNull();
  });

  it("are unaffected when no student is involved (a payer, an unknown number)", () => {
    expect(studentMessageProblem([], true)).toBeNull();
  });
});

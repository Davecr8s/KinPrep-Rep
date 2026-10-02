import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { SUBJECTS } from "@/config/pilot";
import { CURRENCIES } from "@/config/pricing";
import {
  asUser,
  createGroup,
  createStudent,
  createTestDb,
  createUser,
  JUNIOR_BIRTH_YEAR,
  SENIOR_BIRTH_YEAR,
} from "./harness";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

async function enumValues(name: string): Promise<string[]> {
  const { rows } = await db.query<{ v: string }>(
    "select unnest(enum_range(null::public." + name + "))::text as v",
  );
  return rows.map((r) => r.v);
}

describe("schema", () => {
  it("enables row level security on every public table", async () => {
    const { rows } = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("keeps the subject and currency enums in step with config", async () => {
    expect(await enumValues("subject")).toEqual([...SUBJECTS]);
    expect(await enumValues("currency")).toEqual([...CURRENCIES]);
  });

  it("lets only the service role call the billing functions", async () => {
    const userId = await createUser(db);
    await expect(
      asUser(db, userId, (tx) => tx.query("select public.apply_billing_event('{}'::jsonb)")),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, userId, (tx) =>
        tx.query("select * from public.student_coverages(gen_random_uuid())"),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("students", () => {
  it("refuses a WhatsApp number for a student who may be under 13", async () => {
    const owner = await createUser(db);
    await expect(
      createStudent(db, owner, { birthYear: JUNIOR_BIRTH_YEAR, whatsapp: "+2348012345678" }),
    ).rejects.toThrow(/under 13/);
    // Same rule when a number is added later.
    const junior = await createStudent(db, owner, { birthYear: JUNIOR_BIRTH_YEAR });
    await expect(
      db.query("update public.students set whatsapp_number = '+2348012345679' where id = $1", [
        junior,
      ]),
    ).rejects.toThrow(/under 13/);
  });

  it("accepts a WhatsApp number for a senior", async () => {
    const owner = await createUser(db);
    await expect(
      createStudent(db, owner, { birthYear: SENIOR_BIRTH_YEAR, whatsapp: "+2348099999999" }),
    ).resolves.toBeTruthy();
  });

  it("rejects data beyond the minimal set's formats", async () => {
    const owner = await createUser(db);
    await expect(
      db.query(
        `insert into public.students (owner_id, first_name, last_initial, class, birth_year, exam, subjects)
         values ($1, 'Ada', 'Okafor', 'SS1', 2010, 'WASSCE', '{english}')`,
        [owner],
      ),
    ).rejects.toThrow(/last_initial/);
  });
});

describe("append-only tables", () => {
  it("never lets consent history be edited", async () => {
    const owner = await createUser(db);
    const student = await createStudent(db, owner);
    await db.query(
      `insert into public.guardian_consents (student_id, event, method, consent_text_version, given_by)
       values ($1, 'granted', 'web_checkbox', 'v1', $2)`,
      [student, owner],
    );
    await expect(
      db.query("update public.guardian_consents set event = 'withdrawn' where student_id = $1", [
        student,
      ]),
    ).rejects.toThrow(/append-only/);
  });

  it("never lets the audit log be edited or deleted", async () => {
    await db.query("insert into public.audit_log (action, entity_type) values ('test', 'test')");
    await expect(db.query("update public.audit_log set action = 'x'")).rejects.toThrow(
      /append-only/,
    );
    await expect(db.query("delete from public.audit_log")).rejects.toThrow(/append-only/);
  });
});

describe("row level security", () => {
  let payerA: string;
  let payerB: string;
  let reviewer: string;
  let admin: string;
  let studentA: string;
  let studentB: string;

  beforeAll(async () => {
    payerA = await createUser(db);
    payerB = await createUser(db);
    reviewer = await createUser(db, "reviewer");
    admin = await createUser(db, "admin");
    studentA = await createStudent(db, payerA, { firstName: "Ada" });
    studentB = await createStudent(db, payerB, { firstName: "Bayo" });
    for (const [student, payer] of [
      [studentA, payerA],
      [studentB, payerB],
    ] as const) {
      await db.query(
        `insert into public.subscriptions (provider, provider_subscription_id, student_id, plan, currency, status, payer_id)
         values ('stripe', gen_random_uuid()::text, $1, 'abroad_monthly', 'GBP', 'active', $2)`,
        [student, payer],
      );
      await db.query(
        `insert into public.payments (provider, provider_payment_id, subscription_id, status, amount_minor, currency, occurred_at)
         select 'stripe', gen_random_uuid()::text, id, 'succeeded', 600, 'GBP', now()
         from public.subscriptions where student_id = $1`,
        [student],
      );
    }
  });

  const visibleStudents = (userId: string) =>
    asUser(db, userId, async (tx) => {
      const { rows } = await tx.query<{ id: string }>("select id from public.students");
      return rows.map((r) => r.id);
    });

  const count = (userId: string, table: string) =>
    asUser(db, userId, async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `select count(*)::int as n from public.${table}`,
      );
      return rows[0]!.n;
    });

  it("shows payers only their own students", async () => {
    expect(await visibleStudents(payerA)).toEqual([studentA]);
    expect(await visibleStudents(payerB)).toEqual([studentB]);
  });

  it("shows payers only their own subscriptions and payments", async () => {
    expect(await count(payerA, "subscriptions")).toBe(1);
    expect(await count(payerA, "payments")).toBe(1);
  });

  it("shows reviewers no students, subscriptions or payments", async () => {
    expect(await visibleStudents(reviewer)).toEqual([]);
    expect(await count(reviewer, "subscriptions")).toBe(0);
    expect(await count(reviewer, "payments")).toBe(0);
  });

  it("shows admins everything", async () => {
    expect(await visibleStudents(admin)).toEqual(expect.arrayContaining([studentA, studentB]));
    expect(await count(admin, "payments")).toBeGreaterThanOrEqual(2);
  });

  it("gives signed-in users no write access", async () => {
    await expect(
      asUser(db, payerA, (tx) =>
        tx.query("update public.students set first_name = 'Hacked' where id = $1", [studentB]),
      ),
    ).resolves.toMatchObject({ affectedRows: 0 });
    await expect(
      asUser(db, payerA, (tx) =>
        tx.query(
          `insert into public.subscriptions (provider, student_id, plan, currency, status)
           values ('manual', $1, 'abroad_monthly', 'GBP', 'active')`,
          [studentA],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("bulk seats", () => {
  it("never assigns more students than seats bought", async () => {
    const buyer = await createUser(db, "group_buyer");
    const group = await createGroup(db, buyer);
    const { rows } = await db.query<{ id: string }>(
      `insert into public.subscriptions (provider, provider_subscription_id, group_account_id, seats, plan, currency, status)
       values ('stripe', gen_random_uuid()::text, $1, 2, 'bulk_seat_monthly', 'GBP', 'active') returning id`,
      [group],
    );
    const subscription = rows[0]!.id;
    const assign = (student: string) =>
      db.query(
        "insert into public.seat_assignments (subscription_id, student_id) values ($1, $2)",
        [subscription, student],
      );
    await assign(await createStudent(db, buyer));
    await assign(await createStudent(db, buyer));
    await expect(assign(await createStudent(db, buyer))).rejects.toThrow(/seats are in use/);
  });
});

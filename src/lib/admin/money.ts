import { z } from "zod";
import { AMBASSADOR_COMMISSION, type Currency } from "@/config/pricing";
import type { Sql } from "@/lib/db/sql";
import { lagosDayStart } from "@/lib/rules/days";
import { audit, AdminError, type Admin } from "./common";
import { monthBounds, payoutLines, type CommissionPayment } from "./rules";

// Money for admins: the payments ledger, ambassadors and their monthly commission payouts.

export type LedgerRow = {
  id: string;
  provider: string;
  provider_payment_id: string;
  status: string;
  amount_minor: number;
  currency: Currency;
  occurred_at: Date;
  channel: string | null;
  note: string | null;
  student: string | null;
  student_id: string | null;
  payer_email: string | null;
  ambassador: string | null;
};

export async function ledger(
  sql: Sql,
  filter: { status?: string; provider?: string; limit?: number } = {},
): Promise<LedgerRow[]> {
  return sql.query<LedgerRow>(
    `select p.id::text, p.provider::text, p.provider_payment_id, p.status::text, p.amount_minor::int8,
            p.currency::text, p.occurred_at, p.channel, p.note,
            st.first_name || ' ' || st.last_initial || '.' as student, st.id::text as student_id,
            coalesce(s.payer_email, u.email) as payer_email, a.name as ambassador
     from public.payments p
     left join public.subscriptions s on s.id = p.subscription_id
     left join public.students st on st.id = s.student_id
     left join auth.users u on u.id = coalesce(s.payer_id, st.owner_id)
     left join public.ambassadors a on a.id = p.ambassador_id
     where ($1::text is null or p.status::text = $1) and ($2::text is null or p.provider::text = $2)
     order by p.occurred_at desc
     limit $3`,
    [filter.status ?? null, filter.provider ?? null, filter.limit ?? 200],
  );
}

// ---- Ambassadors ------------------------------------------------------------------------

export const AmbassadorInputSchema = z
  .object({
    name: z.string().trim().min(2, "Enter their name.").max(80),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{4,16}$/, "Codes are 4-16 letters and numbers."),
    email: z
      .union([z.literal(""), z.email("Check the email address.")])
      .transform((v) => v || null),
    payoutCountry: z.enum(["NG", "GB"]),
    payoutMethod: z.enum(["paystack", "stripe_connect", "manual"]),
    active: z.boolean(),
  })
  .refine((v) => v.payoutMethod !== "paystack" || v.payoutCountry === "NG", {
    message: "Paystack Transfers are for Nigerian bank accounts.",
    path: ["payoutMethod"],
  })
  .refine((v) => v.payoutMethod !== "stripe_connect" || v.payoutCountry === "GB", {
    message: "Stripe Connect payouts are for UK accounts.",
    path: ["payoutMethod"],
  });
export type AmbassadorInput = z.output<typeof AmbassadorInputSchema>;

export async function saveAmbassador(
  sql: Sql,
  admin: Admin,
  input: AmbassadorInput,
  id?: string,
): Promise<string> {
  const clash = await sql.query(
    "select 1 from public.ambassadors where code = $1 and id is distinct from $2::uuid",
    [input.code, id ?? null],
  );
  if (clash.length) throw new AdminError(`The code ${input.code} is taken.`);
  const values = [
    input.name,
    input.code,
    input.email,
    input.payoutCountry,
    input.payoutMethod,
    input.active,
  ];
  let saved: string;
  if (id) {
    const rows = await sql.query<{ id: string }>(
      `update public.ambassadors set name = $2, code = $3, email = $4, payout_country = $5,
         payout_method = $6, active = $7, updated_at = now() where id = $1 returning id::text`,
      [id, ...values],
    );
    if (!rows.length) throw new AdminError("That ambassador doesn't exist.");
    saved = id;
  } else {
    const [row] = await sql.query<{ id: string }>(
      `insert into public.ambassadors (name, code, email, payout_country, payout_method, active)
       values ($1, $2, $3, $4, $5, $6) returning id::text`,
      values,
    );
    saved = row!.id;
  }
  await audit(sql, admin, id ? "ambassador.updated" : "ambassador.created", "ambassador", saved, {
    ...input,
  });
  return saved;
}

/** Stores the payout destination once the provider has created it (recipient or account). */
export async function setPayoutDestination(
  sql: Sql,
  admin: Admin,
  id: string,
  destination:
    | { kind: "paystack"; recipientCode: string; bankName: string; accountLast4: string }
    | { kind: "stripe_connect"; accountId: string },
): Promise<void> {
  if (destination.kind === "paystack") {
    await sql.query(
      `update public.ambassadors set paystack_recipient_code = $2, bank_name = $3, account_last4 = $4,
         payout_method = 'paystack', updated_at = now() where id = $1`,
      [id, destination.recipientCode, destination.bankName, destination.accountLast4],
    );
  } else {
    await sql.query(
      `update public.ambassadors set stripe_account_id = $2, payout_method = 'stripe_connect',
         updated_at = now() where id = $1`,
      [id, destination.accountId],
    );
  }
  await audit(sql, admin, "ambassador.payout_destination", "ambassador", id, {
    kind: destination.kind,
  });
}

export type AmbassadorRow = {
  id: string;
  name: string;
  code: string;
  email: string | null;
  active: boolean;
  payout_country: "NG" | "GB";
  payout_method: "paystack" | "stripe_connect" | "manual";
  paystack_recipient_code: string | null;
  bank_name: string | null;
  account_last4: string | null;
  stripe_account_id: string | null;
  referred_payers: number;
  /** Commission earned so far, per currency, minor units. */
  earned: Partial<Record<Currency, number>>;
  /** Commission paid out so far, per currency. */
  paid: Partial<Record<Currency, number>>;
};

/** Every payment by a referred payer, with the payer's first payment date, for commission. */
async function commissionPayments(
  sql: Sql,
  before: Date,
): Promise<(CommissionPayment & { paid: boolean })[]> {
  const rows = await sql.query<{
    payment_id: string;
    ambassador_id: string;
    currency: Currency;
    amount_minor: number;
    occurred_at: Date;
    first_paid: Date;
    paid: boolean;
  }>(
    `with paid as (
       select p.*, coalesce(s.payer_id, st.owner_id) as payer
       from public.payments p
       join public.subscriptions s on s.id = p.subscription_id
       left join public.students st on st.id = s.student_id
       where p.status = 'succeeded' and p.provider <> 'trial'
     ),
     firsts as (select payer, min(occurred_at) as first_paid from paid group by payer)
     select paid.id::text as payment_id, paid.ambassador_id::text, paid.currency::text,
            paid.amount_minor::int8 as amount_minor, paid.occurred_at, firsts.first_paid,
            exists (select 1 from public.commission_items c where c.payment_id = paid.id) as paid
     from paid join firsts on firsts.payer = paid.payer
     where paid.ambassador_id is not null and paid.occurred_at < $1
     order by paid.occurred_at`,
    [before],
  );
  return rows.map((r) => ({
    paymentId: r.payment_id,
    ambassadorId: r.ambassador_id,
    currency: r.currency,
    amountMinor: Number(r.amount_minor),
    occurredAt: new Date(r.occurred_at),
    payerFirstPaidAt: new Date(r.first_paid),
    paid: r.paid,
  }));
}

export async function listAmbassadors(sql: Sql, now: Date): Promise<AmbassadorRow[]> {
  const ambassadors = await sql.query<Omit<AmbassadorRow, "earned" | "paid">>(
    `select a.id::text, a.name, a.code, a.email, a.active, a.payout_country, a.payout_method,
            a.paystack_recipient_code, a.bank_name, a.account_last4, a.stripe_account_id,
            (select count(distinct coalesce(s.payer_id, st.owner_id))::int from public.subscriptions s
             left join public.students st on st.id = s.student_id where s.ambassador_id = a.id) as referred_payers
     from public.ambassadors a order by a.created_at`,
  );
  const payments = await commissionPayments(sql, now);
  const earned = payoutLines(payments);
  const paid = payoutLines(payments.filter((p) => p.paid));
  const sum = (lines: typeof earned, id: string) =>
    Object.fromEntries(
      lines.filter((l) => l.ambassadorId === id).map((l) => [l.currency, l.amountMinor]),
    );
  return ambassadors.map((a) => ({ ...a, earned: sum(earned, a.id), paid: sum(paid, a.id) }));
}

// ---- Payout batches ---------------------------------------------------------------------

export type PayoutRow = {
  id: string;
  ambassador_id: string;
  name: string;
  code: string;
  currency: Currency;
  amount_minor: number;
  method: "paystack" | "stripe_connect" | "manual";
  status: "prepared" | "sending" | "paid" | "failed";
  provider_ref: string | null;
  error: string | null;
  destination: string | null;
  payments: number;
};

export type Batch = {
  id: string;
  month: string;
  status: "prepared" | "confirmed";
  created_at: Date;
  confirmed_at: Date | null;
  payouts: PayoutRow[];
};

/**
 * The payout list for a month: commission (20% of each referred payer's first three months) on
 * payments made before the month ended and not paid out yet, per ambassador and currency.
 */
export async function payoutPreview(sql: Sql, month: string) {
  const { next } = monthBounds(month);
  const unpaid = (await commissionPayments(sql, lagosDayStart(next))).filter((p) => !p.paid);
  return payoutLines(unpaid);
}

export async function prepareBatch(sql: Sql, admin: Admin, month: string): Promise<string> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new AdminError("Choose a month.");
  return sql.transaction(async (tx) => {
    const [open] = await tx.query<{ id: string }>(
      "select id::text from public.payout_batches where status = 'prepared'",
    );
    if (open) throw new AdminError("Confirm or discard the prepared batch first.");
    const lines = await payoutPreview(tx, month);
    if (lines.length === 0)
      throw new AdminError("No commission is waiting to be paid for that month.");
    const [batch] = await tx.query<{ id: string }>(
      "insert into public.payout_batches (month, created_by) values ($1, $2) returning id::text",
      [`${month}-01`, admin.id],
    );
    for (const line of lines) {
      const [amb] = await tx.query<{ payout_method: PayoutRow["method"] }>(
        "select payout_method from public.ambassadors where id = $1",
        [line.ambassadorId],
      );
      const [payout] = await tx.query<{ id: string }>(
        `insert into public.ambassador_payouts (batch_id, ambassador_id, currency, amount_minor, method)
         values ($1, $2, $3, $4, $5) returning id::text`,
        [batch!.id, line.ambassadorId, line.currency, line.amountMinor, amb!.payout_method],
      );
      for (const item of line.items) {
        await tx.query(
          "insert into public.commission_items (payment_id, payout_id, amount_minor) values ($1, $2, $3)",
          [item.paymentId, payout!.id, item.amountMinor],
        );
      }
    }
    await audit(tx, admin, "payout_batch.prepared", "payout_batch", batch!.id, {
      month,
      lines: lines.length,
      rate_bps: AMBASSADOR_COMMISSION.rateBps,
    });
    return batch!.id;
  });
}

export async function getBatch(sql: Sql, id: string): Promise<Batch | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [batch] = await sql.query<Omit<Batch, "payouts">>(
    `select id::text, to_char(month, 'YYYY-MM') as month, status, created_at, confirmed_at
     from public.payout_batches where id = $1`,
    [id],
  );
  if (!batch) return null;
  const payouts = await sql.query<PayoutRow>(
    `select o.id::text, o.ambassador_id::text, a.name, a.code, o.currency::text, o.amount_minor::int8,
            o.method, o.status, o.provider_ref, o.error,
            case o.method
              when 'paystack' then a.paystack_recipient_code
              when 'stripe_connect' then a.stripe_account_id
              else null end as destination,
            (select count(*)::int from public.commission_items c where c.payout_id = o.id) as payments
     from public.ambassador_payouts o join public.ambassadors a on a.id = o.ambassador_id
     where o.batch_id = $1 order by a.name, o.currency`,
    [id],
  );
  return {
    ...batch,
    payouts: payouts.map((p) => ({ ...p, amount_minor: Number(p.amount_minor) })),
  };
}

export async function listBatches(sql: Sql): Promise<Omit<Batch, "payouts">[]> {
  return sql.query<Omit<Batch, "payouts">>(
    `select id::text, to_char(month, 'YYYY-MM') as month, status, created_at, confirmed_at
     from public.payout_batches order by created_at desc limit 24`,
  );
}

/** A prepared batch can be thrown away (its payments go back to "waiting"). */
export async function discardBatch(sql: Sql, admin: Admin, id: string): Promise<void> {
  const rows = await sql.query(
    "delete from public.payout_batches where id = $1 and status = 'prepared' returning id",
    [id],
  );
  if (!rows.length) throw new AdminError("Only a prepared batch can be discarded.");
  await audit(sql, admin, "payout_batch.discarded", "payout_batch", id);
}

/** Sends money to ambassadors. Real versions call Paystack and Stripe; tests use fakes. */
export interface PayoutClients {
  /** Paystack Transfer to a Nigerian bank account; `reference` makes a retry safe. */
  paystackTransfer(t: {
    amountMinor: number;
    recipientCode: string;
    reference: string;
    reason: string;
  }): Promise<{ status: "paid" | "sending"; ref: string }>;
  /** Stripe Connect transfer to an Express account; `idempotencyKey` makes a retry safe. */
  stripeTransfer(t: {
    amountMinor: number;
    currency: Currency;
    accountId: string;
    idempotencyKey: string;
    description: string;
  }): Promise<{ ref: string }>;
}

/**
 * The admin has checked the batch: pay it. Paystack lines become Paystack Transfers, Stripe
 * Connect lines Stripe transfers; manual lines wait for "Mark as paid". A failed line can be
 * retried or paid by hand; it never blocks the others.
 */
export async function confirmBatch(
  sql: Sql,
  admin: Admin,
  id: string,
  clients: PayoutClients | null,
): Promise<{ paid: number; sending: number; manual: number; failed: number }> {
  const batch = await getBatch(sql, id);
  if (!batch) throw new AdminError("That batch doesn't exist.");
  if (batch.status !== "prepared") throw new AdminError("This batch has already been confirmed.");
  const claimed = await sql.query(
    `update public.payout_batches set status = 'confirmed', confirmed_by = $2, confirmed_at = now()
     where id = $1 and status = 'prepared' returning id`,
    [id, admin.id],
  );
  if (!claimed.length) throw new AdminError("This batch has already been confirmed.");
  const result = { paid: 0, sending: 0, manual: 0, failed: 0 };
  const label = `KinPrep ambassador commission, ${batch.month}`;
  for (const p of batch.payouts) {
    if (p.method === "manual") {
      result.manual += 1;
      continue;
    }
    try {
      if (!clients) throw new Error("Payouts aren't set up (Paystack and Stripe keys).");
      if (!p.destination) throw new Error("No payout account on file for this ambassador.");
      if (p.method === "paystack") {
        if (p.currency !== "NGN") throw new Error("Paystack Transfers pay naira only.");
        const sent = await clients.paystackTransfer({
          amountMinor: p.amount_minor,
          recipientCode: p.destination,
          reference: p.id,
          reason: label,
        });
        await sql.query(
          `update public.ambassador_payouts set status = $2, provider_ref = $3, error = null,
             paid_at = case when $2 = 'paid' then now() else null end, paid_by = $4 where id = $1`,
          [p.id, sent.status, sent.ref, admin.id],
        );
        result[sent.status] += 1;
      } else {
        const sent = await clients.stripeTransfer({
          amountMinor: p.amount_minor,
          currency: p.currency,
          accountId: p.destination,
          idempotencyKey: p.id,
          description: label,
        });
        await sql.query(
          `update public.ambassador_payouts set status = 'paid', provider_ref = $2, error = null,
             paid_at = now(), paid_by = $3 where id = $1`,
          [p.id, sent.ref, admin.id],
        );
        result.paid += 1;
      }
    } catch (error) {
      await sql.query(
        "update public.ambassador_payouts set status = 'failed', error = $2 where id = $1",
        [p.id, String(error instanceof Error ? error.message : error).slice(0, 500)],
      );
      result.failed += 1;
    }
  }
  await audit(sql, admin, "payout_batch.confirmed", "payout_batch", id, result);
  return result;
}

/** For manual payouts (or a transfer finished in the provider's dashboard). */
export async function markPayoutPaid(
  sql: Sql,
  admin: Admin,
  payoutId: string,
  reference: string,
): Promise<void> {
  const ref = reference.trim();
  if (ref.length < 2) throw new AdminError("Enter the transfer reference.");
  const rows = await sql.query(
    `update public.ambassador_payouts o set status = 'paid', provider_ref = $2, paid_at = now(), paid_by = $3
     from public.payout_batches b
     where o.id = $1 and b.id = o.batch_id and b.status = 'confirmed' and o.status <> 'paid'
     returning o.id`,
    [payoutId, ref, admin.id],
  );
  if (!rows.length)
    throw new AdminError("Confirm the batch first, or this payout is already paid.");
  await audit(sql, admin, "payout.marked_paid", "ambassador_payout", payoutId, { reference: ref });
}

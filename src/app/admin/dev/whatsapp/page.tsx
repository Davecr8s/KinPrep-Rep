import type { Metadata } from "next";
import Link from "next/link";
import { styles } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { appSql } from "@/lib/db/postgres";
import { normalizePhone } from "@/lib/phone";
import type { Outbound } from "@/lib/whatsapp/messages";
import { conversation } from "@/lib/whatsapp/simulator";
import { resetSimulatedNumber, simulateTap, simulateText } from "./actions";

export const metadata: Metadata = {
  title: "WhatsApp simulator",
  robots: { index: false, follow: false },
};

const QUICK = ["START", "SCORE", "STREAK", "LEAGUE", "HELP", "STOP"];

export default async function WhatsAppSimulator({
  searchParams,
}: PageProps<"/admin/dev/whatsapp">) {
  await requireAdmin("/admin/dev/whatsapp");
  const query = await searchParams;
  const phone = typeof query.phone === "string" ? normalizePhone(query.phone, "NG") : null;
  const sql = appSql();
  const numbers = await sql.query<{ phone: string; names: string }>(
    `select whatsapp_number as phone, string_agg(first_name || ' ' || last_initial || '.', ', ' order by first_name) as names
     from public.students where whatsapp_number is not null group by whatsapp_number order by 1 limit 30`,
  );
  const messages = phone ? await conversation(sql, phone) : [];

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-4 py-6">
      <header>
        <p className="text-sm font-semibold text-navy uppercase">Admin · dev</p>
        <h1 className="text-2xl font-bold text-navy-dark">WhatsApp simulator</h1>
        <p className="text-sm text-navy-dark/70">
          Fakes Meta&apos;s webhook and runs the real bot. Replies are logged, never sent to
          WhatsApp.
        </p>
      </header>

      <form className="flex gap-2" action="/admin/dev/whatsapp">
        <input
          name="phone"
          defaultValue={phone ?? ""}
          placeholder="+2348012345678"
          className={styles.input}
          aria-label="Phone number"
        />
        <button className={styles.secondaryButton}>Open</button>
      </form>
      {query.error === "phone" && (
        <p className="font-semibold text-red-700">Enter a valid phone number.</p>
      )}
      {numbers.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-navy">
            Test numbers ({numbers.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {numbers.map((n) => (
              <li key={n.phone}>
                <Link href={`?phone=${encodeURIComponent(n.phone)}`} className={styles.link}>
                  {n.phone}
                </Link>{" "}
                <span className="text-navy-dark/70">{n.names}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {phone && (
        <>
          <section
            className="flex flex-col gap-2 rounded-2xl bg-[#e9e3d8] p-3"
            aria-label={`Chat with ${phone}`}
          >
            {messages.length === 0 && (
              <p className="text-center text-sm text-navy-dark/60">No messages yet. Send START.</p>
            )}
            {messages.map((m) =>
              m.direction === "in" ? (
                <div
                  key={m.id}
                  className="ml-auto max-w-[80%] rounded-lg bg-[#d9fdd3] px-3 py-2 text-sm whitespace-pre-wrap"
                >
                  {"replyTitle" in m.body && m.body.replyTitle
                    ? `▸ ${m.body.replyTitle}`
                    : ("text" in m.body && m.body.text) || `[${m.body.kind}]`}
                </div>
              ) : (
                <Bubble key={m.id} message={m.body as Outbound} status={m.status} phone={phone} />
              ),
            )}
            <span id="end" />
          </section>

          <div className="flex flex-wrap gap-2">
            {QUICK.map((c) => (
              <form key={c} action={simulateText}>
                <input type="hidden" name="phone" value={phone} />
                <input type="hidden" name="text" value={c} />
                <button className="rounded-full border-2 border-navy/30 px-3 py-1 text-sm font-semibold text-navy">
                  {c}
                </button>
              </form>
            ))}
          </div>
          <form action={simulateText} className="flex gap-2">
            <input type="hidden" name="phone" value={phone} />
            <input
              name="text"
              required
              autoComplete="off"
              placeholder="Type a message"
              className={styles.input}
              aria-label="Message"
            />
            <button className={styles.primaryButton}>Send</button>
          </form>
          <form action={resetSimulatedNumber.bind(null, phone)}>
            <button className="text-sm text-red-700 underline">
              Reset today&apos;s practice and chat for this number
            </button>
            {query.error === "prod" && (
              <span className="ml-2 text-sm">Not available on the live site.</span>
            )}
          </form>
        </>
      )}
    </main>
  );
}

function Bubble({ message, status, phone }: { message: Outbound; status: string; phone: string }) {
  const blocked = status === "blocked" || status === "failed";
  return (
    <div
      className={`mr-auto max-w-[85%] rounded-lg bg-white px-3 py-2 text-sm shadow-sm ${blocked ? "opacity-50" : ""}`}
    >
      {blocked && <p className="mb-1 text-xs font-bold text-red-700 uppercase">{status}</p>}
      {message.kind === "template" ? (
        <p className="italic">[Template: {message.name}]</p>
      ) : (
        <p className="whitespace-pre-wrap">{message.text}</p>
      )}
      {message.kind === "buttons" && (
        <div className="mt-2 flex flex-col gap-1 border-t border-navy/10 pt-2">
          {message.buttons.map((b) => (
            <form key={b.id} action={simulateTap.bind(null, phone, b.id, b.title, "button")}>
              <button className="w-full rounded py-1 text-center font-semibold text-[#027eb5] hover:bg-navy/5">
                {b.title}
              </button>
            </form>
          ))}
        </div>
      )}
      {message.kind === "list" && (
        <details className="mt-2 border-t border-navy/10 pt-2">
          <summary className="cursor-pointer text-center font-semibold text-[#027eb5]">
            ☰ {message.button}
          </summary>
          <div className="mt-1 flex flex-col">
            {message.rows.map((r) => (
              <form key={r.id} action={simulateTap.bind(null, phone, r.id, r.title, "list")}>
                <button className="w-full rounded px-2 py-1 text-left hover:bg-navy/5">
                  <span className="block font-semibold">{r.title}</span>
                  {r.description && (
                    <span className="text-xs text-navy-dark/70">{r.description}</span>
                  )}
                </button>
              </form>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

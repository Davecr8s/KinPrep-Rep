import type { Metadata } from "next";
import Link from "next/link";
import { Notice, styles } from "@/components/ui";
import { searchPayers, searchStudents } from "@/lib/admin/students";
import { requireAdmin } from "@/lib/auth";
import { appSql } from "@/lib/db/postgres";

export const metadata: Metadata = { title: "Students and payers" };

export default async function StudentsPage({ searchParams }: PageProps<"/admin/students">) {
  await requireAdmin("/admin/students");
  const query = await searchParams;
  const q = typeof query.q === "string" ? query.q.slice(0, 100) : "";
  const sql = appSql();
  const [students, payers] = await Promise.all([searchStudents(sql, q), searchPayers(sql, q)]);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-navy-dark">Students and payers</h1>
      {typeof query.done === "string" && <Notice tone="good">{query.done}</Notice>}
      <form action="/admin/students" className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="First name, “Ada O”, email, WhatsApp number or id"
          aria-label="Search"
          className={styles.input}
        />
        <button className={styles.secondaryButton}>Search</button>
      </form>
      <section aria-labelledby="students">
        <h2 id="students" className="mb-2 text-lg font-bold text-navy-dark">
          Students ({students.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-navy-dark/70">
              <tr>
                <th className="py-2 pr-3">Student</th>
                <th className="py-2 pr-3">Class</th>
                <th className="py-2 pr-3">WhatsApp</th>
                <th className="py-2 pr-3">Payer</th>
                <th className="py-2">Added</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id} className="border-t border-navy/10">
                  <td className="py-2 pr-3">
                    <Link href={`/admin/students/${s.id}`} className={styles.link}>
                      {s.first_name} {s.last_initial}.
                    </Link>
                    {s.paused_at && (
                      <span className="ml-2 text-xs font-bold text-red-700">Paused</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">{s.class}</td>
                  <td className="py-2 pr-3">{s.whatsapp_number ?? "–"}</td>
                  <td className="py-2 pr-3">
                    {s.owner_email ?? s.owner_id} {s.owner_type && `(${s.owner_type})`}
                  </td>
                  <td className="py-2">{new Date(s.created_at).toISOString().slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section aria-labelledby="payers">
        <h2 id="payers" className="mb-2 text-lg font-bold text-navy-dark">
          Payers ({payers.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-navy-dark/70">
              <tr>
                <th className="py-2 pr-3">Email</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Timezone</th>
                <th className="py-2 pr-3">WhatsApp</th>
                <th className="py-2">Children</th>
              </tr>
            </thead>
            <tbody>
              {payers.map((p) => (
                <tr key={p.id} className="border-t border-navy/10">
                  <td className="py-2 pr-3">
                    <Link
                      href={`/admin/students?q=${encodeURIComponent(p.email ?? p.id)}`}
                      className={styles.link}
                    >
                      {p.email ?? p.id}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">
                    {p.payer_type} ({p.region})
                  </td>
                  <td className="py-2 pr-3">{p.timezone}</td>
                  <td className="py-2 pr-3">
                    {p.whatsapp_number ?? "–"} {p.whatsapp_opt_in ? "· opted in" : ""}
                  </td>
                  <td className="py-2">{p.students}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

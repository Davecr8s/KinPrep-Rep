import Link from "next/link";
import { LEGAL_DRAFT_NOTICE, type LegalDoc } from "@/content/legal";
import { Notice } from "@/components/ui";

/** The privacy notice and terms, rendered from src/content/legal.ts. */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-10">
      <Link href="/" className="text-lg font-bold text-navy">
        Kin<span className="text-orange">Prep</span>
      </Link>
      <h1 className="mt-8 text-3xl font-bold text-navy-dark">{doc.title}</h1>
      <p className="mt-1 text-sm text-navy-dark/70">
        Last updated {doc.updated} · version {doc.version}
      </p>
      <div className="mt-4">
        <Notice tone="warn">{LEGAL_DRAFT_NOTICE}</Notice>
      </div>
      <section aria-labelledby="in-short" className="mt-6 rounded-lg bg-navy/5 p-4">
        <h2 id="in-short" className="font-bold text-navy-dark">
          In short
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {doc.summary.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>
      {doc.sections.map((section) => (
        <section key={section.heading} className="mt-8">
          <h2 className="text-xl font-bold text-navy-dark">{section.heading}</h2>
          {section.paragraphs?.map((p) => (
            <p key={p} className="mt-3 leading-relaxed">
              {p}
            </p>
          ))}
          {section.bullets && (
            <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed">
              {section.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </main>
  );
}

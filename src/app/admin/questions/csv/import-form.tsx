"use client";

import { useActionState } from "react";
import { Notice, styles } from "@/components/ui";
import type { ImportState } from "../actions";

export function ImportForm({
  action,
}: {
  action: (state: ImportState, formData: FormData) => Promise<ImportState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="file" name="file" accept=".csv,text/csv" required className={styles.input} />
      <button disabled={pending} className={styles.primaryButton}>
        {pending ? "Importing…" : "Import as drafts"}
      </button>
      {state.error && <Notice tone="warn">{state.error}</Notice>}
      {state.created !== undefined && (
        <Notice tone={state.errors?.length ? "warn" : "good"}>
          {state.created} question{state.created === 1 ? "" : "s"} imported as drafts for review.
          {state.errors?.length ? ` ${state.errors.length} rows skipped:` : ""}
        </Notice>
      )}
      {state.errors && state.errors.length > 0 && (
        <ul className="text-sm text-red-800">
          {state.errors.map((e) => (
            <li key={e.line}>
              Line {e.line}: {e.message}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

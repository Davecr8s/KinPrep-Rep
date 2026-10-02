"use client";

import { useActionState } from "react";
import { ChildFields, type ChildFormState } from "@/components/child-fields";
import { FieldError, styles } from "@/components/ui";
import { CONSENT_POINTS } from "@/lib/consent";
import { joinGroup } from "./actions";

export function JoinForm({ token, lagosYear }: { token: string; lagosYear: number }) {
  const [state, action, pending] = useActionState<ChildFormState, FormData>(
    joinGroup.bind(null, token),
    {
      errors: {},
      values: {},
    },
  );
  return (
    <form action={action} className="mt-6 flex flex-col gap-8">
      <ChildFields state={state} lagosYear={lagosYear} />
      <fieldset className="flex flex-col gap-3 rounded-2xl border-2 border-navy/15 p-4">
        <legend className={`${styles.label} px-1 text-lg`}>Parent or guardian consent</legend>
        <ul className="list-disc pl-5 text-navy-dark/80">
          {CONSENT_POINTS.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <label className="flex cursor-pointer gap-3">
          <input type="checkbox" name="consent" className="mt-1 size-5 shrink-0 accent-navy" />
          <span className="font-semibold">
            I am this child&apos;s parent or legal guardian and I agree.
          </span>
        </label>
        <FieldError message={state.errors.consent} />
      </fieldset>
      <button type="submit" disabled={pending} className={styles.primaryButton}>
        {pending ? "Joining..." : "Join"}
      </button>
    </form>
  );
}

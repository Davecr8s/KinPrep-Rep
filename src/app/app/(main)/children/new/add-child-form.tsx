"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ChildFields, type ChildFormState } from "@/components/child-fields";
import { FieldError, styles } from "@/components/ui";
import { CONSENT_POINTS } from "@/lib/consent";
import { addChild } from "./actions";

export function AddChildForm({ lagosYear }: { lagosYear: number }) {
  const [state, action, pending] = useActionState<ChildFormState, FormData>(addChild, {
    errors: {},
    values: {},
  });
  const [isGuardian, setIsGuardian] = useState(
    typeof state.values.isGuardian === "string" ? state.values.isGuardian : "",
  );

  return (
    <form action={action} className="flex flex-col gap-8">
      <ChildFields state={state} lagosYear={lagosYear} />

      <fieldset className="flex flex-col gap-3 rounded-2xl border-2 border-navy/15 p-4">
        <legend className={`${styles.label} px-1 text-lg`}>Parent or guardian consent</legend>
        <p>Are you this child&apos;s parent or legal guardian?</p>
        <div className="flex gap-2">
          {[
            ["yes", "Yes"],
            ["no", "No, I'm a relative or sponsor"],
          ].map(([value, label]) => (
            <label
              key={value}
              className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border-2 border-navy/20 px-3 py-2 has-checked:border-navy"
            >
              <input
                type="radio"
                name="isGuardian"
                value={value}
                checked={isGuardian === value}
                onChange={() => setIsGuardian(value!)}
                className="size-5 accent-navy"
              />
              {label}
            </label>
          ))}
        </div>
        <FieldError message={state.errors.isGuardian} />

        {isGuardian === "yes" && (
          <>
            <ul className="list-disc pl-5 text-navy-dark/80">
              {CONSENT_POINTS.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <p className="text-sm">
              How we use and protect this:{" "}
              <Link href="/privacy" target="_blank" className="underline">
                privacy notice
              </Link>
              .
            </p>
            <label className="flex cursor-pointer gap-3">
              <input type="checkbox" name="consent" className="mt-1 size-5 shrink-0 accent-navy" />
              <span className="font-semibold">
                I agree, as this child&apos;s parent or guardian.
              </span>
            </label>
            <FieldError message={state.errors.consent} />
          </>
        )}
        {isGuardian === "no" && (
          <p className="rounded-lg bg-orange-light px-4 py-3">
            Next, we&apos;ll give you a link to send to the child&apos;s parent or guardian. Your
            child can start practising as soon as they agree.
          </p>
        )}
      </fieldset>

      <button type="submit" disabled={pending} className={styles.primaryButton}>
        {pending ? "Saving..." : "Add child"}
      </button>
    </form>
  );
}

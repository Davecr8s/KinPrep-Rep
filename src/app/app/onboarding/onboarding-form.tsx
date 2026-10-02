"use client";

import { useActionState, useState } from "react";
import { FieldError, styles } from "@/components/ui";
import { completeOnboarding, type OnboardingState } from "./actions";

const TYPES = [
  {
    value: "sponsor",
    title: "I live abroad",
    body: "I pay for a child in Nigeria (by card, in £, $ or C$).",
  },
  {
    value: "parent",
    title: "I'm a parent in Nigeria",
    body: "I pay in naira by card, transfer or USSD.",
  },
  {
    value: "group",
    title: "I'm buying for a group",
    body: "A church, school or alumni association buying seats.",
  },
] as const;

const COMMON_ZONES = [
  "Africa/Lagos",
  "Europe/London",
  "Europe/Dublin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Toronto",
];

export function OnboardingForm(props: {
  defaultType: "sponsor" | "parent" | "group";
  defaultTimezone: string;
  timezones: string[];
  next: string;
}) {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(completeOnboarding, {
    errors: {},
    values: {},
  });
  const v = state.values;
  const [type, setType] = useState(v.payerType || props.defaultType);
  const [optIn, setOptIn] = useState(v.reportsOptIn === "on");
  const others = props.timezones.filter((z) => !COMMON_ZONES.includes(z));

  return (
    <form action={action} className="mt-8 flex flex-col gap-8">
      <input type="hidden" name="next" value={props.next} />

      <fieldset className="flex flex-col gap-3">
        <legend className={`${styles.label} mb-2 text-lg`}>1. Who are you?</legend>
        {TYPES.map((t) => (
          <label
            key={t.value}
            className="flex cursor-pointer gap-3 rounded-lg border-2 border-navy/20 px-4 py-3 has-checked:border-navy"
          >
            <input
              type="radio"
              name="payerType"
              value={t.value}
              checked={type === t.value}
              onChange={() => setType(t.value)}
              className="mt-1 size-5 accent-navy"
            />
            <span>
              <span className="block font-semibold">{t.title}</span>
              <span className={styles.hint}>{t.body}</span>
            </span>
          </label>
        ))}
        <FieldError message={state.errors.payerType} />
        {type === "sponsor" && (
          <label className="mt-2 flex flex-col gap-1">
            <span className={styles.label}>Pay in</span>
            <select name="currency" defaultValue={v.currency || "GBP"} className={styles.input}>
              <option value="GBP">Pounds (£)</option>
              <option value="USD">US dollars ($)</option>
              <option value="CAD">Canadian dollars (C$)</option>
            </select>
          </label>
        )}
      </fieldset>

      <label className="flex flex-col gap-1">
        <span className={`${styles.label} text-lg`}>2. Your timezone</span>
        <span className={styles.hint}>Your weekly report arrives in your time.</span>
        <select
          name="timezone"
          defaultValue={v.timezone || props.defaultTimezone}
          className={styles.input}
        >
          <optgroup label="Common">
            {COMMON_ZONES.map((z) => (
              <option key={z} value={z}>
                {z.replace("_", " ")}
              </option>
            ))}
          </optgroup>
          <optgroup label="All timezones">
            {others.map((z) => (
              <option key={z} value={z}>
                {z.replaceAll("_", " ")}
              </option>
            ))}
          </optgroup>
        </select>
        <FieldError message={state.errors.timezone} />
      </label>

      <fieldset className="flex flex-col gap-3">
        <legend className={`${styles.label} mb-1 text-lg`}>3. Weekly report on WhatsApp</legend>
        <label className="flex flex-col gap-1">
          <span className={styles.label}>Your WhatsApp number (optional)</span>
          <input
            name="whatsapp"
            type="tel"
            autoComplete="tel"
            defaultValue={v.whatsapp}
            placeholder={type === "parent" ? "0803 123 4567" : "+44 7700 900123"}
            className={styles.input}
          />
          <FieldError message={state.errors.whatsapp} />
        </label>
        <label className="flex cursor-pointer gap-3">
          <input
            type="checkbox"
            name="reportsOptIn"
            checked={optIn}
            onChange={(e) => setOptIn(e.target.checked)}
            className="mt-1 size-5 shrink-0 accent-navy"
          />
          <span>
            Yes, send my child&apos;s weekly report to this number on WhatsApp. I can stop any time
            by replying STOP.
          </span>
        </label>
        <p className={styles.hint}>Not ticked? You&apos;ll still see every report in the app.</p>
      </fieldset>

      <button type="submit" disabled={pending} className={styles.primaryButton}>
        {pending ? "Saving..." : "Continue"}
      </button>
    </form>
  );
}

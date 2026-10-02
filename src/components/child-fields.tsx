"use client";

import { useState } from "react";
import { SUBJECTS } from "@/config/pilot";
import { FieldError, styles } from "@/components/ui";
import {
  CLASS_LABELS,
  CLASSES,
  EXAM_LABELS,
  EXAMS,
  LANGUAGE_LABELS,
  SUBJECT_LABELS,
} from "@/lib/labels";

export type ChildFormState = {
  errors: Record<string, string>;
  values: Record<string, string | string[]>;
};

/**
 * The child's details, shared by "Add a child" and the class invite page. The server validates
 * everything again; this only shows and hides fields as the answers change.
 */
export function ChildFields({ state, lagosYear }: { state: ChildFormState; lagosYear: number }) {
  const v = state.values;
  const text = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");
  const [birthYear, setBirthYear] = useState(text("birthYear"));
  const [klass, setKlass] = useState(text("class"));
  const [exam, setExam] = useState(text("exam"));
  const [subjects, setSubjects] = useState<string[]>(
    Array.isArray(v.subjects) ? v.subjects : ["english", "mathematics"],
  );

  const year = Number(birthYear);
  const known = birthYear.length === 4 && Number.isInteger(year);
  // Same rule as the server: 13+ only if 13 even with the latest possible birthday.
  const senior = known && lagosYear - year >= 14;
  const junior = known && !senior;
  const examOptions =
    klass === "JSS1" || klass === "JSS2"
      ? ["BECE"]
      : klass === "UTME"
        ? ["UTME"]
        : EXAMS.filter((e) => e !== "BECE");

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <label className="flex flex-col gap-1">
          <span className={styles.label}>First name</span>
          <input
            name="firstName"
            required
            maxLength={40}
            defaultValue={text("firstName")}
            autoComplete="off"
            className={styles.input}
          />
          <FieldError message={state.errors.firstName} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={styles.label}>Surname initial</span>
          <input
            name="lastInitial"
            required
            maxLength={1}
            defaultValue={text("lastInitial")}
            autoComplete="off"
            className={`${styles.input} text-center uppercase`}
          />
          <FieldError message={state.errors.lastInitial} />
        </label>
      </div>
      <p className={`${styles.hint} -mt-3`}>
        We only keep a first name and initial, to protect your child&apos;s privacy.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className={styles.label}>Class</span>
          <select
            name="class"
            required
            value={klass}
            onChange={(e) => {
              setKlass(e.target.value);
              setExam("");
            }}
            className={styles.input}
          >
            <option value="" disabled>
              Choose
            </option>
            {CLASSES.map((c) => (
              <option key={c} value={c}>
                {CLASS_LABELS[c]}
              </option>
            ))}
          </select>
          <FieldError message={state.errors.class} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={styles.label}>Birth year</span>
          <input
            name="birthYear"
            required
            inputMode="numeric"
            pattern="[0-9]{4}"
            maxLength={4}
            value={birthYear}
            onChange={(e) => setBirthYear(e.target.value.replace(/\D/g, ""))}
            placeholder={String(lagosYear - 15)}
            className={styles.input}
          />
          <FieldError message={state.errors.birthYear} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className={styles.label}>Exam</span>
          <select
            name="exam"
            required
            value={exam}
            onChange={(e) => setExam(e.target.value)}
            className={styles.input}
          >
            <option value="" disabled>
              Choose
            </option>
            {examOptions.map((e) => (
              <option key={e} value={e}>
                {EXAM_LABELS[e as keyof typeof EXAM_LABELS]}
              </option>
            ))}
          </select>
          <FieldError message={state.errors.exam} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={styles.label}>Exam date</span>
          <input
            name="examDate"
            type="date"
            defaultValue={text("examDate")}
            className={styles.input}
          />
          <FieldError message={state.errors.examDate} />
        </label>
      </div>

      <fieldset>
        <legend className={styles.label}>Subjects</legend>
        <p className={styles.hint}>
          {exam === "UTME"
            ? "JAMB: English plus three subjects."
            : "Choose the ones they want to practise."}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {SUBJECTS.map((s) => (
            <label
              key={s}
              className="flex cursor-pointer items-center gap-2 rounded-lg border-2 border-navy/20 px-3 py-2 has-checked:border-navy"
            >
              <input
                type="checkbox"
                name="subjects"
                value={s}
                checked={subjects.includes(s)}
                onChange={(e) =>
                  setSubjects(e.target.checked ? [...subjects, s] : subjects.filter((x) => x !== s))
                }
                className="size-5 accent-navy"
              />
              {SUBJECT_LABELS[s]}
            </label>
          ))}
        </div>
        <FieldError message={state.errors.subjects} />
      </fieldset>

      <fieldset>
        <legend className={styles.label}>Explanations in</legend>
        <div className="mt-2 flex gap-2">
          {(["en", "pcm"] as const).map((l) => (
            <label
              key={l}
              className="flex cursor-pointer items-center gap-2 rounded-lg border-2 border-navy/20 px-3 py-2 has-checked:border-navy"
            >
              <input
                type="radio"
                name="language"
                value={l}
                defaultChecked={(text("language") || "en") === l}
                className="size-5 accent-navy"
              />
              {LANGUAGE_LABELS[l]}
            </label>
          ))}
        </div>
      </fieldset>

      {senior && (
        <label className="flex flex-col gap-1">
          <span className={styles.label}>Child&apos;s WhatsApp number</span>
          <span className={styles.hint}>
            Their daily questions arrive here. Leave blank to use the web page instead.
          </span>
          <input
            name="whatsapp"
            type="tel"
            defaultValue={text("whatsapp")}
            placeholder="0803 123 4567"
            className={styles.input}
          />
          <FieldError message={state.errors.whatsapp} />
        </label>
      )}
      {junior && (
        <div className="rounded-lg bg-navy/5 px-4 py-3">
          <p className="font-semibold">Junior mode (under 13)</p>
          <p className="mt-1 text-navy-dark/80">
            Children under 13 don&apos;t get WhatsApp messages from us. They practise on a web page
            you open for them on your phone. You&apos;ll get the link once they&apos;re set up.
          </p>
        </div>
      )}
    </div>
  );
}

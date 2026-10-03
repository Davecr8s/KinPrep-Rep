import { z } from "zod";
import { SUBJECTS } from "@/config/pilot";
import { CLASSES, EXAMS } from "@/lib/labels";
import { normalizePhone } from "@/lib/phone";
import { lagosYear } from "@/lib/rules/days";
import { isSeniorBirthYear, subjectsProblem } from "@/lib/rules/students";
import { isReportTime } from "@/lib/jobs/rules";

// Zod schemas for every payer-app form (CLAUDE.md: validate every input). They take FormData
// values (strings, "on" for ticked boxes) and enforce the business rules.

// Optional keys must be marked .optional()/.nullish() in Zod 4, not via a union with undefined.
const ticked = z
  .enum(["on", "true", ""])
  .nullish()
  .transform((v) => v === "on" || v === "true");

const optionalText = z
  .string()
  .nullish()
  .transform((v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined));

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const OnboardingSchema = z
  .object({
    payerType: z.enum(["sponsor", "parent", "group"], { error: "Tell us who you are." }),
    currency: z.enum(["GBP", "USD", "CAD"]).optional(),
    timezone: z.string().refine(validTimezone, "Choose your timezone."),
    whatsapp: optionalText,
    reportsOptIn: ticked,
  })
  .transform((v, ctx) => {
    let whatsapp: string | undefined;
    if (v.whatsapp) {
      const country = v.payerType === "parent" ? "NG" : "GB";
      whatsapp = normalizePhone(v.whatsapp, country) ?? undefined;
      if (!whatsapp) {
        ctx.addIssue({
          code: "custom",
          path: ["whatsapp"],
          message:
            "That doesn't look like a WhatsApp number. Include the country code, e.g. +44 7700 900123.",
        });
        return z.NEVER;
      }
    }
    if (v.reportsOptIn && !whatsapp) {
      ctx.addIssue({
        code: "custom",
        path: ["whatsapp"],
        message: "Add your WhatsApp number to get reports there.",
      });
      return z.NEVER;
    }
    const region = v.payerType === "parent" ? ("nigeria" as const) : ("abroad" as const);
    const currency =
      region === "nigeria" ? "NGN" : v.payerType === "group" ? "GBP" : (v.currency ?? "GBP");
    return {
      payerType: v.payerType,
      region,
      currency,
      timezone: v.timezone,
      whatsapp,
      reportsOptIn: v.reportsOptIn,
    };
  });

/** The child form, shared by "Add a child" and the class invite page. */
export function childSchema(now: Date) {
  const year = lagosYear(now);
  return z
    .object({
      firstName: z
        .string()
        .trim()
        .min(1, "Enter a first name.")
        .max(40, "Use 40 characters or fewer."),
      lastInitial: z
        .string()
        .trim()
        .transform((s) => s.slice(0, 1).toUpperCase())
        .pipe(z.string().regex(/^[A-Z]$/, "Enter the first letter of their surname.")),
      class: z.enum(CLASSES, { error: "Choose a class." }),
      birthYear: z.coerce
        .number({ error: "Enter a birth year." })
        .int()
        .min(year - 25, "Check the birth year.")
        .max(year - 8, "KinPrep is for secondary-school students (age 9 and up)."),
      exam: z.enum(EXAMS, { error: "Choose an exam." }),
      examDate: optionalText.pipe(z.iso.date({ error: "Enter a valid date." }).optional()),
      subjects: z.array(z.enum(SUBJECTS)).default([]),
      language: z.enum(["en", "pcm"]).default("en"),
      whatsapp: optionalText,
      /** The parent opts the senior in to a WhatsApp message each morning (and the reminder). */
      dailyMessages: ticked,
    })
    .superRefine((v, ctx) => {
      const problem = subjectsProblem(v.exam, v.subjects);
      if (problem) ctx.addIssue({ code: "custom", path: ["subjects"], message: problem });
      const junior = v.class === "JSS1" || v.class === "JSS2";
      if (junior && v.exam !== "BECE") {
        ctx.addIssue({ code: "custom", path: ["exam"], message: "JSS students take BECE." });
      }
      if (!junior && v.exam === "BECE") {
        ctx.addIssue({ code: "custom", path: ["exam"], message: "BECE is for JSS students." });
      }
      if (v.class === "UTME" && v.exam !== "UTME") {
        ctx.addIssue({
          code: "custom",
          path: ["exam"],
          message: "UTME candidates take UTME (JAMB).",
        });
      }
      if (v.examDate && v.examDate < now.toISOString().slice(0, 10)) {
        ctx.addIssue({
          code: "custom",
          path: ["examDate"],
          message: "The exam date is in the past.",
        });
      }
    })
    .transform((v, ctx) => {
      const senior = isSeniorBirthYear(v.birthYear, now);
      let whatsapp: string | null = null;
      if (v.whatsapp) {
        if (!senior) {
          ctx.addIssue({
            code: "custom",
            path: ["whatsapp"],
            message:
              "Children under 13 practise on a web page from your phone, not WhatsApp. Leave this blank.",
          });
          return z.NEVER;
        }
        whatsapp = normalizePhone(v.whatsapp, "NG");
        if (!whatsapp) {
          ctx.addIssue({
            code: "custom",
            path: ["whatsapp"],
            message: "That doesn't look like a WhatsApp number.",
          });
          return z.NEVER;
        }
      }
      return {
        ...v,
        examDate: v.examDate ?? null,
        whatsapp,
        senior,
        dailyMessages: whatsapp !== null && v.dailyMessages,
      };
    });
}

export type ChildInput = z.output<ReturnType<typeof childSchema>>;

export const GuardianSchema = z
  .object({
    isGuardian: z.enum(["yes", "no"], {
      error: "Tell us whether you are the child's parent or guardian.",
    }),
    consent: ticked,
  })
  .refine((v) => v.isGuardian === "no" || v.consent, {
    path: ["consent"],
    message: "Tick the box to give consent, or choose 'No' and we'll ask the guardian.",
  });

export const EncouragementSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "Write a short message.")
    .max(160, "Keep it under 160 characters."),
});

export const ReportSettingsSchema = z
  .object({
    reportWeekday: z.coerce.number().int().min(0).max(6),
    reportHour: z.coerce.number().int().min(0).max(23),
    whatsapp: optionalText,
    reportsOptIn: ticked,
    country: z.enum(["NG", "GB", "US", "CA"]).default("GB"),
  })
  .transform((v, ctx) => {
    if (!isReportTime(v.reportWeekday, v.reportHour)) {
      ctx.addIssue({
        code: "custom",
        path: ["reportTime"],
        message: "Choose a time between Saturday evening and Sunday night.",
      });
      return z.NEVER;
    }
    const whatsapp = v.whatsapp ? normalizePhone(v.whatsapp, v.country) : null;
    if (v.whatsapp && !whatsapp) {
      ctx.addIssue({
        code: "custom",
        path: ["whatsapp"],
        message: "That doesn't look like a WhatsApp number.",
      });
      return z.NEVER;
    }
    if (v.reportsOptIn && !whatsapp) {
      ctx.addIssue({
        code: "custom",
        path: ["whatsapp"],
        message: "Add your WhatsApp number to get reports there.",
      });
      return z.NEVER;
    }
    return {
      reportWeekday: v.reportWeekday,
      reportHour: v.reportHour,
      whatsapp,
      reportsOptIn: v.reportsOptIn,
    };
  });

export const GroupSchema = z.object({
  name: z.string().trim().min(2, "Enter the group's name.").max(120),
  kind: z.enum(["church", "alumni", "school", "other"]),
});

export const SeatsSchema = z.object({
  seats: z.coerce
    .number()
    .int()
    .min(1, "Buy at least one seat.")
    .max(500, "For more than 500 seats, contact us."),
});

/** Field errors keyed by field name, for redisplaying a form. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

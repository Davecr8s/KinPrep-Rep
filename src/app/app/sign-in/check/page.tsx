import type { Metadata } from "next";
import Link from "next/link";
import { FieldError, styles } from "@/components/ui";
import { safeNextPath } from "@/lib/tokens";
import { verifyCode } from "../actions";

export const metadata: Metadata = { title: "Check your email" };

export default async function CheckEmailPage({ searchParams }: PageProps<"/app/sign-in/check">) {
  const query = await searchParams;
  const email = typeof query.email === "string" ? query.email : "";
  const next = safeNextPath(query.next);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-10">
      <p className="text-lg font-bold text-navy">
        Kin<span className="text-orange">Prep</span>
      </p>
      <h1 className="mt-8 text-3xl font-bold text-navy-dark">Check your email</h1>
      <p className="mt-2 text-lg text-navy-dark/80">
        We sent a sign-in link to <strong className="text-navy-dark">{email}</strong>. Tap it to
        continue.
      </p>

      <form action={verifyCode} className="mt-8 flex flex-col gap-4">
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="next" value={next} />
        <label className="flex flex-col gap-1">
          <span className={styles.label}>Or type the code from the email</span>
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,12}"
            required
            className={`${styles.input} text-center text-2xl tracking-[0.3em]`}
          />
          <FieldError
            message={
              query.error === "code"
                ? "That code didn't work. Check it, or ask for a new email."
                : undefined
            }
          />
        </label>
        <button type="submit" className={styles.secondaryButton}>
          Sign in with code
        </button>
      </form>

      <p className="mt-8 text-sm text-navy-dark/70">
        Nothing arrived? Check spam, or{" "}
        <Link href={`/app/sign-in?next=${encodeURIComponent(next)}`} className={styles.link}>
          send another
        </Link>
        .
      </p>
    </main>
  );
}

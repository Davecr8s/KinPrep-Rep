import type { Metadata } from "next";
import Link from "next/link";
import { FieldError, Notice, styles } from "@/components/ui";
import { safeNextPath } from "@/lib/tokens";
import { sendMagicLink } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  email: "Enter a valid email address.",
  send: "We couldn't send the email. Please try again.",
  rate: "Too many attempts. Please wait a minute and try again.",
  link: "That link has expired or was already used. Enter your email for a new one.",
};

export default async function SignInPage({ searchParams }: PageProps<"/app/sign-in">) {
  const query = await searchParams;
  const region = query.region === "nigeria" ? "nigeria" : "abroad";
  const group = query.group === "1";
  // New payers go on to onboarding; returning payers are sent on from there to their app.
  const next = safeNextPath(
    query.next,
    `/app/onboarding?region=${region}${group ? "&type=group" : ""}`,
  );
  const error = typeof query.error === "string" ? ERRORS[query.error] : undefined;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-10">
      <Link href="/" className="text-lg font-bold text-navy">
        Kin<span className="text-orange">Prep</span>
      </Link>
      <h1 className="mt-8 text-3xl font-bold text-navy-dark">Sign in or sign up</h1>
      <p className="mt-2 text-navy-dark/80">We&apos;ll email you a link. No password needed.</p>
      {error && error !== ERRORS.email && (
        <div className="mt-4">
          <Notice tone="warn">{error}</Notice>
        </div>
      )}
      <form action={sendMagicLink} className="mt-6 flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <label className="flex flex-col gap-1">
          <span className={styles.label}>Email address</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            className={styles.input}
          />
          <FieldError message={error === ERRORS.email ? error : undefined} />
        </label>
        <button type="submit" className={styles.primaryButton}>
          Email me a sign-in link
        </button>
      </form>
      <p className="mt-6 text-sm text-navy-dark/70">
        By continuing you agree to KinPrep&apos;s terms and privacy policy.
      </p>
    </main>
  );
}

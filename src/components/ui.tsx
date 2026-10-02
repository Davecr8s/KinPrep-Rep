import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

// Small shared building blocks. Server components only: no client JavaScript.

export const styles = {
  primaryButton:
    "inline-flex min-h-12 items-center justify-center rounded-full bg-orange px-6 py-3 text-base font-bold text-navy-dark hover:brightness-95 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-60",
  secondaryButton:
    "inline-flex min-h-12 items-center justify-center rounded-full border-2 border-navy px-6 py-3 text-base font-semibold text-navy hover:bg-navy/5 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-navy",
  dangerButton:
    "inline-flex min-h-12 items-center justify-center rounded-full border-2 border-red-700 px-6 py-3 text-base font-semibold text-red-700 hover:bg-red-50",
  input:
    "w-full rounded-lg border-2 border-navy/30 bg-white px-4 py-3 text-base text-navy-dark focus:border-navy focus:outline-none",
  label: "font-semibold text-navy-dark",
  hint: "text-sm text-navy-dark/70",
  card: "rounded-2xl border border-navy/10 bg-white p-4 shadow-sm",
  link: "font-semibold text-navy underline underline-offset-2",
};

export function Card({ className = "", ...props }: ComponentProps<"section">) {
  return <section className={`${styles.card} ${className}`} {...props} />;
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-bold text-navy-dark sm:text-3xl">{children}</h1>
      {sub && <p className="mt-1 text-base text-navy-dark/80">{sub}</p>}
    </header>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1 text-sm font-semibold text-red-700">
      {message}
    </p>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "good";
  children: ReactNode;
}) {
  const tones = {
    info: "bg-navy/5 text-navy-dark",
    warn: "bg-orange-light text-navy-dark",
    good: "bg-green-50 text-green-900",
  };
  return <div className={`rounded-lg px-4 py-3 ${tones[tone]}`}>{children}</div>;
}

export function ButtonLink({
  variant = "primary",
  ...props
}: ComponentProps<typeof Link> & { variant?: "primary" | "secondary" }) {
  return (
    <Link
      className={variant === "primary" ? styles.primaryButton : styles.secondaryButton}
      {...props}
    />
  );
}

/** A WhatsApp share link: opens WhatsApp with the text ready to send. */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

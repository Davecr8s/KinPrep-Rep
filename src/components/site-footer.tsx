import Link from "next/link";

/** On every page: the privacy notice and terms are always one tap away. */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-navy/10 px-4 py-4 text-center text-sm text-navy-dark/70">
      <nav aria-label="Legal" className="flex justify-center gap-4">
        <Link href="/privacy" className="hover:underline">
          Privacy
        </Link>
        <Link href="/terms" className="hover:underline">
          Terms
        </Link>
      </nav>
    </footer>
  );
}

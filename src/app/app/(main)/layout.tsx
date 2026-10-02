import Link from "next/link";
import { requirePayer } from "@/lib/auth";

export default async function MainLayout({ children }: LayoutProps<"/app">) {
  const { payer } = await requirePayer();
  const links =
    payer.payer_type === "group"
      ? [
          { href: "/app/groups", label: "My group" },
          { href: "/app/settings", label: "Settings" },
        ]
      : [
          { href: "/app", label: "Children" },
          { href: "/app/settings", label: "Settings" },
        ];

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-10 bg-navy text-white">
        <nav
          className="mx-auto flex max-w-2xl items-center justify-between gap-4 px-4 py-3"
          aria-label="Main"
        >
          <Link href={links[0]!.href} className="text-lg font-bold">
            Kin<span className="text-orange">Prep</span>
          </Link>
          <ul className="flex gap-4">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="font-semibold text-white/90 hover:text-white">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}

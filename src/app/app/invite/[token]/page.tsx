import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { styles } from "@/components/ui";
import { currentPayer, requireUser } from "@/lib/auth";
import { findViewerInvite } from "@/lib/services/viewers";
import { acceptInvite } from "./actions";

export const metadata: Metadata = {
  title: "Co-sponsor invite",
  robots: { index: false, follow: false },
};

export default async function InvitePage({
  params,
  searchParams,
}: PageProps<"/app/invite/[token]">) {
  const { token } = await params;
  await requireUser();
  // New to KinPrep: a quick onboarding first, then straight back here.
  if (!(await currentPayer()))
    redirect(`/app/onboarding?next=${encodeURIComponent(`/app/invite/${token}`)}`);
  const invite = (await searchParams).gone === "1" ? null : await findViewerInvite(token);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-10">
      <p className="mb-8 text-lg font-bold text-navy">
        Kin<span className="text-orange">Prep</span>
      </p>
      {invite ? (
        <>
          <h1 className="text-3xl font-bold text-navy-dark">
            Follow {invite.firstName}&apos;s progress
          </h1>
          <p className="mt-3 text-lg">
            You&apos;ve been invited as a co-sponsor. You&apos;ll see {invite.firstName}&apos;s
            practice and weekly reports. You won&apos;t be charged anything.
          </p>
          <form action={acceptInvite.bind(null, token)} className="mt-6">
            <button className={`${styles.primaryButton} w-full`}>Accept</button>
          </form>
        </>
      ) : (
        <>
          <h1 className="text-3xl font-bold text-navy-dark">This invite has expired</h1>
          <p className="mt-3 text-lg">Ask the person who sent it for a new link.</p>
          <Link href="/app" className={`${styles.link} mt-6`}>
            Go to KinPrep
          </Link>
        </>
      )}
    </main>
  );
}

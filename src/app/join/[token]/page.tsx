import type { Metadata } from "next";
import { Notice } from "@/components/ui";
import { lagosYear } from "@/lib/rules/days";
import { findGroupInvite } from "@/lib/services/groups";
import { JoinForm } from "./join-form";

export const metadata: Metadata = {
  title: "Join a group",
  robots: { index: false, follow: false },
};

export default async function JoinPage({ params, searchParams }: PageProps<"/join/[token]">) {
  const { token } = await params;
  const query = await searchParams;
  const invite = await findGroupInvite(token);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-10">
      <p className="mb-8 text-lg font-bold text-navy">
        Kin<span className="text-orange">Prep</span>
      </p>
      {typeof query.joined === "string" ? (
        <>
          <h1 className="text-3xl font-bold text-navy-dark">{query.joined} has joined</h1>
          <div className="mt-4">
            <Notice tone={query.noseat === "1" ? "warn" : "good"}>
              {query.noseat === "1"
                ? `All of ${invite?.groupName ?? "the group"}'s seats are taken right now. ${query.joined} will start as soon as the group adds a seat.`
                : `${query.joined} can start practising. Questions arrive on WhatsApp (13 and over) or on a web page for younger children.`}
            </Notice>
          </div>
        </>
      ) : invite ? (
        <>
          <h1 className="text-3xl font-bold text-navy-dark">Join {invite.groupName} on KinPrep</h1>
          <p className="mt-3 text-lg">
            Daily exam practice for WAEC, NECO and JAMB, paid for by {invite.groupName}. A parent or
            guardian fills this in for each child.
          </p>
          <JoinForm token={token} lagosYear={lagosYear(new Date())} />
        </>
      ) : (
        <>
          <h1 className="text-3xl font-bold text-navy-dark">This link isn&apos;t working</h1>
          <p className="mt-3 text-lg">Ask the group for its latest KinPrep link.</p>
        </>
      )}
    </main>
  );
}

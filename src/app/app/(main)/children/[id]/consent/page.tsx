import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ButtonLink, Card, Notice, PageTitle, styles, whatsappShareUrl } from "@/components/ui";
import { requirePayer } from "@/lib/auth";
import { CONSENT_LINK_DAYS } from "@/lib/consent";
import { getChild, pendingConsentRequest } from "@/lib/data/children";
import { serverEnv } from "@/lib/env";
import { getBillingStore } from "@/lib/payments/server";
import { findConsentRequest } from "@/lib/services/students";
import { isTokenShape } from "@/lib/tokens";
import { newConsentLink } from "./actions";

export const metadata: Metadata = { title: "Ask the guardian" };

export default async function ConsentLinkPage({
  params,
  searchParams,
}: PageProps<"/app/children/[id]/consent">) {
  const { user } = await requirePayer();
  const { id } = await params;
  const child = await getChild(id);
  if (!child || child.owner_id !== user.id) notFound();
  if (await getBillingStore().hasGuardianConsent(id)) redirect(`/app/children/${id}`);

  const { link } = await searchParams;
  const pending = await pendingConsentRequest(id);
  const live =
    typeof link === "string" && isTokenShape(link) ? await findConsentRequest(link) : null;
  const url =
    live && live.studentId === id
      ? `${serverEnv("app").NEXT_PUBLIC_APP_URL}/consent/${link}`
      : null;
  const message = url
    ? `Hello! I'd like to sign ${child.first_name} up for KinPrep, daily exam practice for WAEC, NECO and JAMB. As their parent or guardian, please read and agree here: ${url}`
    : "";

  return (
    <>
      <PageTitle sub={`${child.first_name} can start as soon as their parent or guardian agrees.`}>
        Ask {child.first_name}&apos;s guardian
      </PageTitle>

      {url ? (
        <Card className="flex flex-col gap-4">
          <p>
            Send this link to {child.first_name}&apos;s parent or guardian. It works for{" "}
            {CONSENT_LINK_DAYS} days.
          </p>
          <a
            href={whatsappShareUrl(message)}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.primaryButton}
          >
            Send on WhatsApp
          </a>
          <label className="flex flex-col gap-1">
            <span className={styles.hint}>Or copy the link</span>
            <input
              readOnly
              value={url}
              className={`${styles.input} text-sm`}
              aria-label="Consent link"
            />
          </label>
        </Card>
      ) : (
        <Card className="flex flex-col gap-4">
          <Notice tone="warn">
            {pending
              ? "For security we only show a guardian link once. Make a new one to send it again (the old one will stop working)."
              : "There's no open link for the guardian. Make one to send."}
          </Notice>
          <form action={newConsentLink.bind(null, id)}>
            <button type="submit" className={styles.primaryButton}>
              Make a new link
            </button>
          </form>
        </Card>
      )}

      <div className="mt-6 flex flex-col gap-3">
        <ButtonLink href={`/app/children/${id}/plan`} variant="secondary">
          Choose a plan while you wait
        </ButtonLink>
        <Link href={`/app/children/${id}`} className={`${styles.link} text-center`}>
          Go to {child.first_name}&apos;s page
        </Link>
      </div>
    </>
  );
}

import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentPayer, requireUser } from "@/lib/auth";
import { safeNextPath } from "@/lib/tokens";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Welcome" };

function isTimezone(tz: string | null): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export default async function OnboardingPage({ searchParams }: PageProps<"/app/onboarding">) {
  await requireUser();
  const query = await searchParams;
  const next = safeNextPath(query.next, "");
  // Already set up: carry on to wherever they were going.
  if (await currentPayer()) redirect(next || "/app");

  const headerTz = (await headers()).get("x-vercel-ip-timezone");
  const region = query.region === "nigeria" ? "nigeria" : "abroad";
  const defaultTimezone = isTimezone(headerTz)
    ? headerTz
    : region === "nigeria"
      ? "Africa/Lagos"
      : "Europe/London";
  const defaultType =
    query.type === "group" ? "group" : region === "nigeria" ? "parent" : "sponsor";

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-10">
      <p className="text-lg font-bold text-navy">
        Kin<span className="text-orange">Prep</span>
      </p>
      <h1 className="mt-8 text-3xl font-bold text-navy-dark">Welcome to KinPrep</h1>
      <p className="mt-2 text-navy-dark/80">Three quick questions, then you can add your child.</p>
      <OnboardingForm
        defaultType={defaultType}
        defaultTimezone={defaultTimezone}
        timezones={Intl.supportedValuesOf("timeZone")}
        next={next}
      />
    </main>
  );
}

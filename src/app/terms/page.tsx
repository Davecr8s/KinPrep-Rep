import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { TERMS } from "@/content/legal";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "The terms for KinPrep's daily exam practice and weekly reports.",
};

export default function TermsPage() {
  return <LegalPage doc={TERMS} />;
}

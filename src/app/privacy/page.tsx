import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { PRIVACY } from "@/content/legal";

export const metadata: Metadata = {
  title: "Privacy notice",
  description: "How KinPrep uses and protects students' and payers' data (NDPA 2023, UK GDPR).",
};

export default function PrivacyPage() {
  return <LegalPage doc={PRIVACY} />;
}

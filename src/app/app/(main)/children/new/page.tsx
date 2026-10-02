import type { Metadata } from "next";
import { PageTitle } from "@/components/ui";
import { requirePayer } from "@/lib/auth";
import { lagosYear } from "@/lib/rules/days";
import { AddChildForm } from "./add-child-form";

export const metadata: Metadata = { title: "Add a child" };

export default async function AddChildPage() {
  await requirePayer();
  return (
    <>
      <PageTitle sub="Takes about two minutes.">Add a child</PageTitle>
      <AddChildForm lagosYear={lagosYear(new Date())} />
    </>
  );
}

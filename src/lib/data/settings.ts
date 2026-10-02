import "server-only";
import { z } from "zod";
import { adminDb } from "@/lib/db/admin";

const BankDetailsSchema = z.object({
  bank: z.string().min(2),
  accountName: z.string().min(2),
  accountNumber: z.string().regex(/^\d{10}$/),
});
export type BankDetails = z.infer<typeof BankDetailsSchema>;

/**
 * KinPrep's account for manual bank transfers, set by the admin (settings key
 * "manual_bank_details"). Null until set, and the transfer option stays hidden until then.
 */
export async function manualBankDetails(): Promise<BankDetails | null> {
  const { data, error } = await adminDb()
    .from("settings")
    .select("value")
    .eq("key", "manual_bank_details")
    .maybeSingle();
  if (error) throw new Error(`Loading settings failed: ${error.message}`);
  const parsed = BankDetailsSchema.safeParse(data?.value);
  return parsed.success ? parsed.data : null;
}

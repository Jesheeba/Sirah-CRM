"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function enrollLeadInSequence(
  leadId: string,
  sequenceId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_enroll_lead_in_sequence", {
    p_sequence_id: sequenceId,
    p_lead_id: leadId,
  });
  if (error) {
    const message = error.message.includes("duplicate key")
      ? "This lead is already actively enrolled in that sequence."
      : error.message;
    return { ok: false, error: message };
  }
  revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}

export async function stopSequenceEnrollment(
  enrollmentId: string,
  leadId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("sequence_enrollments")
    .update({ status: "stopped", stop_reason: "stopped manually" })
    .eq("id", enrollmentId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}

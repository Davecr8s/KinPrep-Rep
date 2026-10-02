import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import { STREAK_DAY_THRESHOLD } from "@/config/pilot";
import { adminDb } from "@/lib/db/admin";
import { evaluateAccess } from "@/lib/rules/access";
import { lagosDay, lagosDayStart, weekStart } from "@/lib/rules/days";
import { toCoverage } from "@/lib/payments/rows";
import { userDb } from "@/lib/supabase/server";
import { hashToken, isTokenShape, newToken } from "@/lib/tokens";

export type Group = { id: string; name: string; kind: string };

/** The signed-in group buyer's group (the first one, if they made several). */
export async function myGroup(): Promise<Group | null> {
  const db = await userDb();
  const { data, error } = await db
    .from("group_accounts")
    .select("id, name, kind")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as Group | null;
}

/** For actions: the group must belong to the user. */
export async function requireOwnedGroup(groupId: string, userId: string): Promise<Group> {
  if (!z.uuid().safeParse(groupId).success) notFound();
  const { data, error } = await adminDb()
    .from("group_accounts")
    .select("id, name, kind, owner_id")
    .eq("id", groupId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.owner_id !== userId) notFound();
  return { id: data.id as string, name: data.name as string, kind: data.kind as string };
}

export type SeatSummary = {
  subscriptionId: string | null;
  seats: number;
  used: number;
  active: boolean;
  until: Date | null;
};

/** Seats bought and in use. A group normally has one seat subscription; the newest counts. */
export async function seatSummary(groupId: string, now = new Date()): Promise<SeatSummary> {
  const db = adminDb();
  const { data, error } = await db
    .from("subscriptions")
    .select("id, provider, seats, status, current_period_end, trial_end, grace_until")
    .eq("group_account_id", groupId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { subscriptionId: null, seats: 0, used: 0, active: false, until: null };
  const { count } = await db
    .from("seat_assignments")
    .select("id", { count: "exact", head: true })
    .eq("subscription_id", data.id)
    .is("released_at", null);
  const access = evaluateAccess([toCoverage(data)], now);
  return {
    subscriptionId: data.id as string,
    seats: (data.seats as number) ?? 0,
    used: count ?? 0,
    active: access.state !== "inactive",
    until: access.until,
  };
}

/** Gives the student a seat if one is free. Returns false when the group is full or has none. */
export async function assignSeat(groupId: string, studentId: string): Promise<boolean> {
  const summary = await seatSummary(groupId);
  if (!summary.subscriptionId || summary.used >= summary.seats) return false;
  const { error } = await adminDb()
    .from("seat_assignments")
    .insert({ subscription_id: summary.subscriptionId, student_id: studentId });
  // The database trigger is the final word on seat limits (concurrent joins).
  if (error) return false;
  return true;
}

export async function seatedStudentIds(subscriptionId: string | null): Promise<Set<string>> {
  if (!subscriptionId) return new Set();
  const { data, error } = await adminDb()
    .from("seat_assignments")
    .select("student_id")
    .eq("subscription_id", subscriptionId)
    .is("released_at", null);
  if (error) throw new Error(error.message);
  return new Set(data.map((r) => r.student_id as string));
}

export async function newGroupInvite(groupId: string, userId: string): Promise<string> {
  const db = adminDb();
  await db
    .from("group_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("group_account_id", groupId)
    .is("revoked_at", null);
  const { token, hash } = newToken();
  const { error } = await db
    .from("group_invites")
    .insert({ group_account_id: groupId, token_hash: hash, created_by: userId });
  if (error) throw new Error(error.message);
  return token;
}

export async function findGroupInvite(
  token: string,
): Promise<{ groupId: string; groupName: string; ownerId: string } | null> {
  if (!isTokenShape(token)) return null;
  const { data, error } = await adminDb()
    .from("group_invites")
    .select("group_account_id, group_accounts!inner(name, owner_id)")
    .eq("token_hash", hashToken(token))
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const group = data.group_accounts as unknown as { name: string; owner_id: string };
  return {
    groupId: data.group_account_id as string,
    groupName: group.name,
    ownerId: group.owner_id,
  };
}

const StatsSchema = z.array(
  z.object({
    student_id: z.string(),
    first_name: z.string(),
    last_initial: z.string(),
    answered: z.coerce.number(),
    correct: z.coerce.number(),
    practice_days: z.coerce.number(),
  }),
);

export type LeaderboardRow = {
  studentId: string;
  name: string;
  practiceDays: number;
  answered: number;
  accuracy: number | null;
};

/** This week's class leaderboard: first name and initial only (CLAUDE.md). */
export async function weekLeaderboard(
  groupId: string,
  now = new Date(),
): Promise<LeaderboardRow[]> {
  const db = await userDb();
  const { data, error } = await db.rpc("group_week_stats", {
    p_group_id: groupId,
    p_since: lagosDayStart(weekStart(lagosDay(now))).toISOString(),
    p_day_threshold: STREAK_DAY_THRESHOLD,
  });
  if (error) throw new Error(error.message);
  return StatsSchema.parse(data)
    .map((r) => ({
      studentId: r.student_id,
      name: `${r.first_name} ${r.last_initial}.`,
      practiceDays: r.practice_days,
      answered: r.answered,
      accuracy: r.answered === 0 ? null : Math.round((r.correct / r.answered) * 100),
    }))
    .sort(
      (a, b) =>
        b.practiceDays - a.practiceDays || b.answered - a.answered || a.name.localeCompare(b.name),
    );
}

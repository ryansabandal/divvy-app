// Net balance per participant: what they paid for, minus what they owe across all splits.
// Positive = they're owed money, negative = they owe. Shared by the preview + freeze routes
// so the math has exactly one home. Structural typing lets it accept the Prisma query result.
export function computeNetBalances(
  participants: { id: string }[],
  expenses: { paid_by: string; amount: number; splits: { participant_id: string; amount_owed: number }[] }[],
) {
  return participants.map((participant) => {
    // Sum of every expense this participant fronted
    const paid = expenses
      .filter((e) => e.paid_by === participant.id)
      .reduce((sum, e) => sum + e.amount, 0);

    // Sum of this participant's share across every expense's splits
    const owed = expenses
      .flatMap((e) => e.splits)
      .filter((s) => s.participant_id === participant.id)
      .reduce((sum, s) => sum + s.amount_owed, 0);

    return { participantId: participant.id, balance: paid - owed };
  });
}

// Returns true if two settlement plans are equivalent — same payers, payees, and amounts.
// Used to detect whether the frozen plan is stale after expenses are added or deleted.
export function settlementPlansMatch(
  frozen: { from_id: string; to_id: string; amount: number }[],
  live: { from_id: string; to_id: string; amount: number }[],
): boolean {
  if (frozen.length !== live.length) return false;
  const key = (s: { from_id: string; to_id: string }) => `${s.from_id}:${s.to_id}`;
  const sortedFrozen = [...frozen].sort((a, b) => key(a).localeCompare(key(b)));
  const sortedLive   = [...live].sort((a, b) => key(a).localeCompare(key(b)));
  return sortedFrozen.every((f, i) => {
    const l = sortedLive[i];
    return !!l && f.from_id === l.from_id && f.to_id === l.to_id && Math.abs(f.amount - l.amount) < 0.01;
  });
}

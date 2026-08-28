// Shared by the session and read-only view pages to answer two different questions about who
// fronted a session's expenses. Pure — no fetching, no React — so it stays easy to reason about.

// Minimal shape this module needs from an expense. Declared structurally (rather than importing a
// page's interface) so each page's richer local type satisfies it without any casting — the same
// approach lib/expenseBreakdown.ts uses. Callers must pass expenses in the API's sort_order (the
// order GET /api/sessions/:sessionId already returns them in), since deriveDefaultPayer relies on
// array position as a stand-in for the internal sort_order column, which the API never exposes.
export interface PayerExpense {
  payer: { id: string; name: string };
}

// Whether every expense in the session shares one payer. Answers "should expense rows stop
// repeating the payer's name?" — unanimity is the right bar for display, since showing one
// combined "X fronted the bill" line would be misleading the moment a second payer exists.
// Returns null for zero expenses (nothing to be unanimous about) or a genuine split.
export function deriveSessionPayer(expenses: PayerExpense[]): { id: string; name: string } | null {
  if (expenses.length === 0) return null;
  const first = expenses[0]!.payer;
  return expenses.every((e) => e.payer.id === first.id) ? first : null;
}

// The payer the add-expense picker should default to. Deliberately NOT the same bar as
// deriveSessionPayer: once a single expense is overridden to a different payer, a unanimity-based
// default would collapse to the first participant in the list, silently reintroducing the
// snap-back-to-participant-#1 bug this module exists to fix. Instead: most frequent payer,
// ties broken toward whoever paid most recently (last occurrence in sort_order wins).
// Returns null only when there are no expenses yet to infer a default from.
export function deriveDefaultPayer(expenses: PayerExpense[]): string | null {
  if (expenses.length === 0) return null;

  // Count occurrences and remember each payer's most recent (highest sort_order) position
  const counts = new Map<string, number>();
  const lastIndex = new Map<string, number>();
  expenses.forEach((e, index) => {
    const id = e.payer.id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
    lastIndex.set(id, index);
  });

  let bestId: string | null = null;
  for (const [id, count] of counts) {
    if (
      bestId === null ||
      count > counts.get(bestId)! ||
      (count === counts.get(bestId)! && lastIndex.get(id)! > lastIndex.get(bestId)!)
    ) {
      bestId = id;
    }
  }
  return bestId;
}

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { saveRecentSession } from "@/lib/recentSessions";
import { deriveDefaultPayer, deriveSessionPayer } from "@/lib/sessionPayer";
import { PAYMENT_METHOD_LABELS } from "@/lib/paymentDetails";
import { fetcher } from "@/lib/fetcher";
import { useCopyToClipboard } from "@/lib/useCopyToClipboard";
import { SessionSummary } from "@/components/SessionSummary";
import { SwapLabel } from "@/components/SwapLabel";
import { PaymentMethodEditor } from "./_components/PaymentMethodEditor";
import { ExpenseList } from "./_components/ExpenseList";
import { ExpenseForm } from "./_components/ExpenseForm";
import type { Participant, Expense, Session } from "@/lib/types";

// Session view: show the bill, who's in it, every expense, and a form to add more
export default function SessionPage() {
  // useParams reads the [sessionId] segment from the URL (returned directly in a client component)
  const { sessionId } = useParams<{ sessionId: string }>();

  // SWR owns the fetching, caching, and re-render — no useEffect/useState/useCallback for the data.
  // mutate() re-runs the fetcher so we can refresh the list after adding an expense.
  const { data: session, error, mutate } = useSWR<Session>(
    sessionId ? `/api/sessions/${sessionId}` : null,
    (url: string) => fetcher(url, "Failed to load session"),
  );

  // Once the session loads, remember it on this device — covers both "just created it"
  // and "opened a shared link", so either way it shows up in "Your recent sessions".
  useEffect(() => {
    if (session) saveRecentSession(session.id, session.name);
  }, [session?.id, session?.name]);

  // Who fronted the bill for this session, picked once near the participant list rather than
  // per expense (the common case is a single payer for the whole night). null/"" means "not
  // picked yet by the user" — the render-time default below fills it in without a setState effect.
  const [sessionPayer, setSessionPayer] = useState("");
  // Forces the session-payer picker open after "Change"; cleared once handleExpenseSubmitted's
  // mutate() resolves, so sessionPayerLocked below goes back to being purely derived from recorded
  // data — same reason it survives a page reload with no persistence of its own.
  const [payerPickerForcedOpen, setPayerPickerForcedOpen] = useState(false);
  // Non-null while ExpenseForm below is editing an existing expense rather than adding a new one;
  // ExpenseForm is remounted (see the key on it below) whenever either of these changes, so it
  // always seeds its own fields fresh rather than needing a sync effect.
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  // Bumped on every Edit click, including re-clicking the expense already being edited — folded
  // into ExpenseForm's key below so the form always re-seeds from the latest data, not just when
  // the target expense's id changes.
  const [editClickCount, setEditClickCount] = useState(0);
  // So tapping "Edit" can scroll the (always-rendered) form into view on mobile
  const addExpenseSectionRef = useRef<HTMLElement>(null);
  // One copy-to-clipboard flow per button, so each can independently show "Copied!"
  const { copied: copiedShareLink, copy: copyShareLink } = useCopyToClipboard();
  // Same, for the "copy session link" button (this session's own edit URL, so it can be reopened later)
  const { copied: copiedSessionLink, copy: copySessionLink } = useCopyToClipboard();

  // Which participant's payment-method form is open — its fields live in PaymentMethodEditor
  // itself, mounted fresh per participant, so there's only this one flag to track here.
  const [expandedParticipantId, setExpandedParticipantId] = useState<string | null>(null);

  if (error) {
    return <main className="flex-1 px-4 py-10 text-center text-red-500">{error.message}</main>;
  }
  if (!session) {
    return <main className="flex-1 px-4 py-10 text-center text-navy/40">Loading…</main>;
  }

  // Defaults derived at render time (never via a setState in an effect): until the user picks a
  // payer or unchecks someone, fall back to a sensible inferred default and "everyone".
  const allParticipantIds = session.participants.map((p) => p.id);
  // Session-wide payer: the user's own pick, else whoever has fronted expenses most often so far
  // (see lib/sessionPayer.ts — NOT unanimity, which would collapse to participant #1 the moment a
  // single expense is overridden), else the first participant when there are no expenses yet.
  const effectiveSessionPayer = sessionPayer || deriveDefaultPayer(session.expenses) || allParticipantIds[0] || "";
  // Non-null only when every expense shares one payer — drives whether expense rows repeat
  // "Paid by X" on each card or state it once under the section heading instead.
  const derivedSessionPayer = deriveSessionPayer(session.expenses);
  // Locked/collapsed only when recorded expenses agree on one payer AND that payer matches the
  // live sessionPayer pick — the second check catches the case where a new payer was picked but
  // no expense recorded under them yet exists to back it up, which would otherwise show a payer
  // on the tile that isn't who the next expense will actually be billed to.
  const sessionPayerLocked =
    !payerPickerForcedOpen &&
    derivedSessionPayer !== null &&
    (sessionPayer === "" || sessionPayer === derivedSessionPayer.id);

  // Expand one participant's payment-method form, or collapse it if it's already open —
  // tapping the same row again closes it. PaymentMethodEditor seeds its own fields from the
  // participant prop, so there's nothing else to do here.
  function toggleExpandParticipant(p: Participant) {
    setExpandedParticipantId(expandedParticipantId === p.id ? null : p.id);
  }

  // Populate the (always-rendered) form from an existing expense, then scroll it into view —
  // otherwise a tap on "Edit" up in the list leaves the form off-screen below the fold. Bumping
  // editClickCount forces a fresh re-seed even when re-clicking Edit on the expense already open,
  // which a same-id key change alone would miss.
  function handleStartEdit(expense: Expense) {
    setEditingExpense(expense);
    setEditClickCount((n) => n + 1);
    // Jumps instead of gliding when the user has asked for reduced motion
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    addExpenseSectionRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }

  // Fires after ExpenseForm submits successfully. Refetches first, then clears editingExpense (so
  // ExpenseForm only remounts blank once fresh data is in) and the picker-forced-open flag — both
  // deliberately after mutate() resolves, so nothing flickers or briefly becomes interactive
  // against stale pre-submit data.
  async function handleExpenseSubmitted() {
    await mutate();
    setEditingExpense(null);
    setPayerPickerForcedOpen(false);
  }

  return (
    <main className="flex-1 flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-sm">
        {/* Back to the home page, e.g. to start or return to a different session */}
        <Link href="/" className="text-btn mb-4 inline-block text-sm font-medium text-teal">
          ← Home
        </Link>
        {/* Serif upright, not italic and not bold — Instrument Serif is weight-400 only,
            so font-bold would synthesise a fake bold rather than load a real one */}
        <h1 className="heading-title text-3xl text-balance text-navy mb-4">{session.name}</h1>

        <SessionSummary
          expenses={session.expenses}
          participantCount={session.participants.length}
          // Matches sessionPayerLocked exactly, so this tile and the picker's open/closed state
          // can never disagree; falls back to Avg/person (undefined) whenever the picker is open.
          // view/page.tsx and settle/page.tsx have no picker, so they always show the payer as
          // soon as recorded expenses agree.
          payerName={sessionPayerLocked ? derivedSessionPayer?.name : undefined}
          onChangePayer={() => setPayerPickerForcedOpen(true)}
        />

        {/* Participants — tap a row to set that person's payment method for the settle screen */}
        <section className="mb-8">
          <h2 className="section-label">Who&apos;s splitting</h2>

          {/* Set once for the whole session, since the common case is one person fronting the
              whole bill. Collapses on its own once submitting an expense locks in the payer (see
              sessionPayerLocked/payerPickerForcedOpen above) — the summary tile's "Change" link
              reopens it. */}
          {!sessionPayerLocked && (
            <div className="panel-reveal">
              <label htmlFor="session-payer" className="mb-1.5 block text-sm font-medium text-navy">
                Who&apos;s fronting the bill?
              </label>
              <select
                id="session-payer"
                value={effectiveSessionPayer}
                onChange={(e) => setSessionPayer(e.target.value)}
                className="input mb-4"
              >
                {session.participants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <ul className="flex flex-col gap-2">
            {session.participants.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => toggleExpandParticipant(p)}
                  className="card card-interactive flex w-full items-center justify-between px-4 py-3 text-left text-sm"
                >
                  <span className="font-medium text-navy">{p.name}</span>
                  <span className={`text-xs ${p.payment_method_type || p.qr_code_url ? "text-teal font-medium" : "text-navy/40"}`}>
                    {p.payment_method_type
                      ? `${PAYMENT_METHOD_LABELS[p.payment_method_type]} ✓`
                      : p.qr_code_url
                        ? "QR code ✓"
                        : "Add payment method"}
                  </span>
                </button>

                {expandedParticipantId === p.id && (
                  <PaymentMethodEditor
                    key={p.id}
                    sessionId={sessionId}
                    participant={p}
                    mutate={mutate}
                    onClose={() => setExpandedParticipantId(null)}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>

        <ExpenseList
          sessionId={sessionId}
          session={session}
          mutate={mutate}
          derivedSessionPayer={derivedSessionPayer}
          onEdit={handleStartEdit}
          // Otherwise the form would stay bound to a row that no longer exists; leaves it alone
          // when the deleted expense isn't the one currently open
          onDeleted={(id) => setEditingExpense((cur) => (cur?.id === id ? null : cur))}
        />

        {/* Add or edit an expense — the same form serves both; editingExpense picks the mode */}
        <section ref={addExpenseSectionRef} className="mt-8 border-t border-navy/10 pt-6">
          <div className="flex items-center justify-between">
            <h2 className="section-label">{editingExpense ? "Edit expense" : "Add an expense"}</h2>
            {editingExpense && (
              <button
                type="button"
                onClick={() => setEditingExpense(null)}
                className="text-btn text-sm font-medium text-navy/50"
              >
                Cancel
              </button>
            )}
          </div>
          <ExpenseForm
            key={editingExpense ? `${editingExpense.id}-${editClickCount}` : "new"}
            sessionId={sessionId}
            participants={session.participants}
            effectiveSessionPayer={effectiveSessionPayer}
            editingExpense={editingExpense}
            onSubmitted={handleExpenseSubmitted}
          />
        </section>

        {/* Copy this session's own (editable) URL, so it can be pasted somewhere and reopened later */}
        <button
          type="button"
          onClick={() => copySessionLink(`${window.location.origin}/${sessionId}`)}
          className="btn-secondary mt-6"
        >
          <SwapLabel swapped={copiedSessionLink} idle="Copy session link" active="Link copied!" />
        </button>

        {/* Share a read-only link with participants so they can see what they owe */}
        <button
          type="button"
          onClick={() => copyShareLink(`${window.location.origin}/${sessionId}/view`)}
          className="btn-secondary mt-3"
        >
          <SwapLabel swapped={copiedShareLink} idle="Share view link" active="Link copied!" />
        </button>

        {/* Settlement screen: who owes who, plus mark-as-paid tracking once finalized */}
        <Link href={`/${sessionId}/settle`} className="btn-primary mt-3">
          Settle up
        </Link>
      </div>
    </main>
  );
}

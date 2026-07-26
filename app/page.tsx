"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getRecentSessions, saveRecentSession, type RecentSession } from "@/lib/recentSessions";

// Create a session: name the bill, list who's splitting it, then go straight to that session
export default function CreateSessionPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [participants, setParticipants] = useState(["", ""]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Sessions remembered on this device, for the "Your recent sessions" list below.
  // Read in an effect (not during render) — localStorage doesn't exist on the server, so reading
  // it during render would return different content client vs. server and cause a hydration mismatch.
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);
  useEffect(() => {
    // localStorage read, not derived render state — the rule's cascading-render concern doesn't apply here
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecentSessions(getRecentSessions());
  }, []);

  // Replace one participant name in place, leaving the rest of the array untouched
  function updateParticipant(index: number, value: string) {
    setParticipants((prev) => prev.map((p, i) => (i === index ? value : p)));
  }

  function addParticipant() {
    setParticipants((prev) => [...prev, ""]);
  }

  function removeParticipant(index: number) {
    setParticipants((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    // Drop blank rows before validating/sending, so an empty "add another person" slot isn't an error
    const cleanedParticipants = participants.map((p) => p.trim()).filter((p) => p !== "");
    if (name.trim() === "") {
      setError("Give this session a name");
      return;
    }
    if (cleanedParticipants.length === 0) {
      setError("Add at least one participant");
      return;
    }

    setSubmitting(true);
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), participants: cleanedParticipants }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Something went wrong");
      setSubmitting(false);
      return;
    }

    const session = await res.json();
    // Remember this session on this device so it can show up in "Your recent sessions" later.
    saveRecentSession(session.id, session.name);
    router.push(`/${session.id}`);
  }

  return (
    <main className="flex-1 flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-sm">
        {/* Only shown once there's history on this device — first-time visitors just see the form */}
        {recentSessions.length > 0 && (
          <section className="mb-8">
            <h2 className="section-label">Your recent sessions</h2>
            <ul className="flex flex-col gap-2">
              {recentSessions.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/${s.id}`}
                    className="card flex w-full items-center justify-between px-4 py-3 text-left text-sm"
                  >
                    <span className="font-medium text-navy">{s.name}</span>
                    <span className="text-xs text-navy/40">Open →</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <h1 className="text-2xl font-bold text-navy mb-1">New session</h1>
        <p className="text-sm text-navy/50 mb-8">Name the bill and add everyone splitting it.</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="text-sm font-medium text-navy">
              What&apos;s this for?
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Friday night out"
              className="input"
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-navy">Who&apos;s splitting this?</span>
            {participants.map((participant, index) => (
              <div key={index} className="flex gap-2">
                <input
                  type="text"
                  value={participant}
                  onChange={(e) => updateParticipant(index, e.target.value)}
                  placeholder={`Participant ${index + 1}`}
                  className="input"
                />
                {participants.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeParticipant(index)}
                    className="px-2 text-navy/30 hover:text-red-500 transition-colors"
                    aria-label="Remove participant"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addParticipant}
              className="self-start text-sm font-medium text-teal"
            >
              + Add another person
            </button>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? "Creating…" : "Create session"}
          </button>
        </form>
      </div>
    </main>
  );
}

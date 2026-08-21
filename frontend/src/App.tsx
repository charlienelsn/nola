import {
  type ProposalDecisionRequest,
  ProposalDecisionResponseSchema,
  type ProposalWithSource,
  ProposalWithSourceSchema,
} from "@nola/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

const API_URL = "http://localhost:3001";

/**
 * Managed auth with an email allowlist arrives with the deploy loop; until
 * then every decision is attributed to the local dev identity. Synthetic
 * data only — this never labels real care work.
 */
const ACTOR = "care-manager-dev";

/**
 * The review screen (plan section 10): source beside proposal, decisions
 * written back. Requirement 9 shapes the decision controls — the reviewer
 * sees the measured duration and the activity description that will be
 * recorded before they commit, because a duration with no description of
 * the work is not audit-evidence.
 *
 * Requirement 8: nothing here displays billing-threshold proximity, and the
 * queue is ordered by arrival, never by distance to a time floor.
 */

async function fetchProposals(): Promise<ProposalWithSource[]> {
  const res = await fetch(`${API_URL}/proposals?status=pending`);
  if (!res.ok) throw new Error(`GET /proposals ${res.status}`);
  return z.array(ProposalWithSourceSchema).parse(await res.json());
}

async function postDecision(
  proposalId: string,
  body: ProposalDecisionRequest,
): Promise<void> {
  const res = await fetch(`${API_URL}/proposals/${proposalId}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(detail?.error ?? `POST decision ${res.status}`);
  }
  // A 200 means the decision is committed server-side. A malformed response
  // body is logged, never surfaced as a failed decision — treating it as
  // failure would leave a decided proposal rendered as pending.
  try {
    ProposalDecisionResponseSchema.parse(await res.json());
  } catch (e) {
    console.warn("decision response failed validation", e);
  }
}

function Badge({ children, tone }: { children: string; tone: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {children}
    </span>
  );
}

/**
 * Active review seconds — not wall clock. A second counts only while the
 * page is visible and the reviewer has interacted (pointer, key, scroll)
 * within the last 60s, and only while `counting` is true (the panel is
 * open). Panel-open idle time is exactly the requirement-4 "billable minute
 * for work that did not occur", so it is never accumulated.
 */
const IDLE_MS = 60_000;

function useActiveSeconds(counting: boolean): [number, () => number] {
  const total = useRef(0);
  const lastActivity = useRef(Date.now());
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const touch = () => {
      lastActivity.current = Date.now();
    };
    window.addEventListener("pointermove", touch);
    window.addEventListener("pointerdown", touch);
    window.addEventListener("keydown", touch);
    window.addEventListener("scroll", touch, true);
    return () => {
      window.removeEventListener("pointermove", touch);
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
      window.removeEventListener("scroll", touch, true);
    };
  }, []);

  useEffect(() => {
    if (!counting) return;
    const t = setInterval(() => {
      const active =
        !document.hidden && Date.now() - lastActivity.current < IDLE_MS;
      if (active) {
        total.current += 1;
        setDisplay(total.current);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [counting]);

  return [display, () => total.current];
}

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

/** Fact-carrying change types render the exact payload an accept verifies. */
const FACT_CHANGE_TYPES = new Set(["fact_proposal", "medication_change"]);

const FactPayloadViewSchema = z.object({
  entity: z.string(),
  attribute: z.string(),
  value: z.unknown(),
});

function ReviewPanel({
  proposal,
  open,
  onDecided,
}: {
  proposal: ProposalWithSource;
  open: boolean;
  onDecided: () => void;
}) {
  const [note, setNote] = useState("");
  const defaultDescription = useMemo(
    () =>
      `Reviewed the ${proposal.workflow} ${proposal.changeType} proposal "${proposal.summary}" for ${proposal.member.chosenName}${proposal.sourceEvent ? " against its source event" : ""}`,
    [proposal],
  );
  const [activityDescription, setActivityDescription] =
    useState(defaultDescription);
  const [elapsed, readActiveSeconds] = useActiveSeconds(open);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (action: "accept" | "reject") => {
    setSubmitting(true);
    setError(null);
    try {
      await postDecision(proposal.id, {
        action,
        actor: ACTOR,
        note: note.trim() === "" ? undefined : note.trim(),
        durationSeconds: readActiveSeconds(),
        activityDescription,
      });
      onDecided();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setSubmitting(false);
    }
  };

  const source = proposal.sourceEvent;
  const factPayload = FACT_CHANGE_TYPES.has(proposal.changeType)
    ? FactPayloadViewSchema.safeParse(proposal.payload)
    : null;

  return (
    <div className="grid gap-4 border-t border-stone-200 p-4 md:grid-cols-2">
      <section className="rounded-md border border-stone-200 bg-stone-50 p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          Source
        </h3>
        {source ? (
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="text-stone-500">Event</dt>
              <dd>{source.eventType}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-stone-500">By</dt>
              <dd>
                {source.actor} · {new Date(source.occurredAt).toLocaleString()}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-stone-500">Purpose</dt>
              <dd>{source.purpose}</dd>
            </div>
            <div>
              <dt className="text-stone-500">Work recorded</dt>
              <dd className="mt-1 whitespace-pre-wrap rounded bg-white p-2 text-stone-700">
                {source.activityDescription}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-stone-500">
            No source event on this proposal — treat with care; every proposal
            should cite the event that produced it.
          </p>
        )}

        {proposal.sourceDocument && (
          <div className="mt-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Source document (verbatim, untrusted) ·{" "}
              {proposal.sourceDocument.source}
            </h3>
            <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded bg-white p-2 font-sans text-xs leading-relaxed text-stone-700">
              {proposal.sourceDocument.content}
            </pre>
          </div>
        )}

        {factPayload && (
          <div className="mt-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Accepting verifies this fact
            </h3>
            {factPayload.success ? (
              <dl className="mt-2 space-y-1 text-sm">
                <div className="flex gap-2">
                  <dt className="text-stone-500">Fact</dt>
                  <dd>
                    {factPayload.data.entity}/{factPayload.data.attribute}
                  </dd>
                </div>
                <div>
                  <dt className="text-stone-500">Value</dt>
                  <dd className="mt-1 whitespace-pre-wrap rounded bg-white p-2 font-mono text-xs text-stone-700">
                    {JSON.stringify(factPayload.data.value, null, 2)}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-2 text-sm text-red-700">
                This {proposal.changeType} proposal's payload is not fact-shaped
                — accepting it will be refused by the API.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <label className="text-sm">
          <span className="text-stone-600">Note (optional)</span>
          <input
            className="mt-1 w-full rounded-md border border-stone-300 px-2 py-1.5"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why, context for the task, anything the next person needs"
          />
        </label>
        <label className="text-sm">
          <span className="text-stone-600">
            Review work — recorded on the decision event
          </span>
          <textarea
            className="mt-1 w-full rounded-md border border-stone-300 px-2 py-1.5"
            rows={3}
            value={activityDescription}
            onChange={(e) => setActivityDescription(e.target.value)}
          />
        </label>
        <div className="flex items-center justify-between">
          <span className="text-xs text-stone-500">
            Active review time: {formatSeconds(elapsed)} · recorded as {ACTOR}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={submitting || activityDescription.trim() === ""}
              onClick={() => decide("reject")}
              className="rounded-md border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-50"
            >
              Reject
            </button>
            <button
              type="button"
              disabled={submitting || activityDescription.trim() === ""}
              onClick={() => decide("accept")}
              className="rounded-md bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
            >
              Accept
            </button>
          </div>
        </div>
        {error && <p className="text-sm text-red-700">{error}</p>}
      </section>
    </div>
  );
}

function ProposalCard({
  proposal,
  open,
  onToggle,
  onDecided,
}: {
  proposal: ProposalWithSource;
  open: boolean;
  onToggle: () => void;
  onDecided: () => void;
}) {
  // Once opened, the panel stays mounted (hidden when collapsed) so the
  // draft note and the active-time measurement survive collapse/reopen.
  // The timer's `counting` gate pauses accumulation while hidden.
  const [everOpened, setEverOpened] = useState(open);
  useEffect(() => {
    if (open) setEverOpened(true);
  }, [open]);

  return (
    <li className="rounded-lg border border-stone-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-4 p-4 text-left"
      >
        <div>
          <p className="font-medium">{proposal.summary}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-stone-500">
            <span className="font-medium text-stone-700">
              {proposal.member.chosenName}
            </span>
            <span>· {proposal.member.primaryLanguage}</span>
            {proposal.member.interpreterNeeded && (
              <Badge tone="bg-amber-100 text-amber-900">interpreter</Badge>
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Badge tone="bg-stone-100 text-stone-600">{proposal.workflow}</Badge>
          <Badge tone="bg-stone-100 text-stone-600">
            {proposal.changeType}
          </Badge>
          <Badge tone="bg-blue-100 text-blue-900">
            {proposal.autonomyLevel}
          </Badge>
        </div>
      </button>
      {everOpened && (
        <div className={open ? "" : "hidden"}>
          <ReviewPanel proposal={proposal} open={open} onDecided={onDecided} />
        </div>
      )}
    </li>
  );
}

export default function App() {
  const [proposals, setProposals] = useState<ProposalWithSource[] | null>(null);
  // Deep link: /?open=<proposal-id> opens that proposal's review panel.
  const [openId, setOpenId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("open"),
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [decidedCount, setDecidedCount] = useState(0);
  // Monotonic guard: a slow, stale /proposals response must never overwrite
  // the result of a newer load.
  const loadSeq = useRef(0);

  const load = () => {
    const seq = ++loadSeq.current;
    return fetchProposals()
      .then((p) => {
        if (seq !== loadSeq.current) return;
        setProposals(p);
        setLoadError(null);
      })
      .catch((e) => {
        if (seq !== loadSeq.current) return;
        setLoadError(String(e instanceof Error ? e.message : e));
      });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => {
    void load();
  }, []);

  const toggle = (id: string) => {
    const next = openId === id ? null : id;
    setOpenId(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("open", next);
    else url.searchParams.delete("open");
    window.history.replaceState(null, "", url);
  };

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <span className="text-xl font-semibold tracking-tight">Nola</span>
          <nav className="flex gap-6 text-sm text-stone-500">
            <span>Today</span>
            <span>Members</span>
            <span className="font-medium text-stone-900">Work</span>
            <span>Inbox</span>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold">Review queue</h1>
          <span className="text-sm text-stone-500">
            {proposals === null
              ? "loading…"
              : `${proposals.length} pending${decidedCount > 0 ? ` · ${decidedCount} decided this session` : ""}`}
          </span>
        </div>
        <p className="mt-1 text-sm text-stone-600">
          Every proposal is reviewed beside the source that produced it. Nothing
          is applied without a decision here.
        </p>

        {loadError && (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {loadError} — is the API running? (<code>pnpm dev</code>)
          </div>
        )}

        {proposals !== null && proposals.length === 0 && !loadError && (
          <div className="mt-6 rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-600">
            Queue clear — no pending proposals.
          </div>
        )}

        <ul className="mt-6 space-y-3">
          {(proposals ?? []).map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              open={openId === p.id}
              onToggle={() => toggle(p.id)}
              onDecided={() => {
                // Optimistic removal: the decision is committed server-side;
                // the refetch reconciles, but a refetch failure must not
                // leave a decided proposal rendered as pending.
                setProposals(
                  (prev) => prev?.filter((x) => x.id !== p.id) ?? prev,
                );
                setDecidedCount((c) => c + 1);
                toggle(p.id);
                void load();
              }}
            />
          ))}
        </ul>
      </main>
    </div>
  );
}

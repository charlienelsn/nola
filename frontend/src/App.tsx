import { useEffect, useState } from "react";

const API_URL = "http://localhost:3001";

export default function App() {
  const [apiOk, setApiOk] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((r) => r.json())
      .then((d: { ok: boolean }) => setApiOk(d.ok))
      .catch(() => setApiOk(false));
  }, []);

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <span className="text-xl font-semibold tracking-tight">Nola</span>
          <nav className="flex gap-6 text-sm text-stone-500">
            <span>Today</span>
            <span>Members</span>
            <span>Work</span>
            <span>Inbox</span>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold">Care operating environment</h1>
        <p className="mt-2 text-stone-600">
          Day 1 skeleton. Show the human only what needs the human.
        </p>
        <div className="mt-8 rounded-lg border border-stone-200 bg-white p-4 text-sm">
          API health:{" "}
          {apiOk === null
            ? "checking…"
            : apiOk
              ? "connected"
              : "not running (start with: pnpm dev)"}
        </div>
      </main>
    </div>
  );
}

# Nola

AI-native care service. This repository is Nola's internal operating
environment: the Case Brain, the workflow factory, and the care-manager UI.

The people Nola serves are **members**. Synthetic data only — no real member
data exists in this repository or any environment.

## Quickstart

```bash
pnpm install
pnpm dev        # frontend on :5173, API on :3001
```

Checks: `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm check:terminology`

## Map

| Path | What |
| --- | --- |
| `frontend/` | Care-manager UI (React, Vite, Tailwind) |
| `api/` | Contract endpoints (Fastify); background jobs run in-process |
| `brain/` | The Case Brain — event → facts → validation → routing |
| `workflows/` | One typed module per workflow |
| `evals/` | Golden cases and regression runner |
| `shared/` | Member ontology and API contract types |
| `docs/decisions.md` | Why things are the way they are |

Read `CLAUDE.md` before contributing — human or agent.

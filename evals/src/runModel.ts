import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import {
  type DischargeRunResult,
  MemberContextSchema,
  type TraceSink,
  runDischargeSummary,
} from "@nola/brain";
import { type GoldenCase, loadGoldens } from "./goldenCase.js";

/**
 * Executes a workflow's golden cases against the live Brain and writes the
 * results file grade mode scores (`run.ts --results <file>`). One trace per
 * model call lands beside it as JSONL — the same TraceRecord shape the
 * `traces` table stores.
 *
 *   pnpm --filter @nola/evals run:model [--workflow discharge-summary]
 *     [--model <id>] [--concurrency 2] [--out results/discharge-summary.json]
 *
 * Only discharge-summary is runnable until the factory lands (weeks 4-5).
 */

const here = dirname(fileURLToPath(import.meta.url));
const goldensRoot = resolve(here, "..", "goldens");

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const workflow = flag("workflow") ?? "discharge-summary";
const model = flag("model");
const concurrency = Number(flag("concurrency") ?? "2");
const outPath = resolve(here, "..", flag("out") ?? `results/${workflow}.json`);
const tracesPath = outPath.replace(/\.json$/, ".traces.jsonl");

if (workflow !== "discharge-summary") {
  console.error(
    `Only discharge-summary is runnable until the factory lands; got "${workflow}".`,
  );
  process.exit(1);
}

const goldens = loadGoldens(goldensRoot).find((w) => w.workflow === workflow);
if (!goldens) {
  console.error(`No goldens found for workflow "${workflow}".`);
  process.exit(1);
}

// Auth resolves at request time, not construction — the first case below
// doubles as the credentials preflight.
const client = new Anthropic();

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(tracesPath, "");
const sink: TraceSink = {
  write: async (record) => {
    appendFileSync(tracesPath, `${JSON.stringify(record)}\n`);
  },
};

const results: Record<string, DischargeRunResult> = {};
const failures: { name: string; error: string }[] = [];

async function runCase(golden: GoldenCase): Promise<void> {
  if (golden.input.eventType !== "DischargeReceived") {
    throw new Error(`unexpected eventType ${golden.input.eventType}`);
  }
  const t0 = performance.now();
  const result = await runDischargeSummary(
    {
      member: MemberContextSchema.parse(golden.member),
      source: golden.input.source,
      receivedAt: golden.input.receivedAt,
      document: golden.input.document,
    },
    { client, model, sink },
  );
  results[golden.name] = result;
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  console.error(`done  ${golden.name}  (${secs}s, routed ${result.routing})`);
}

const queue = [...goldens.cases];
async function worker(): Promise<void> {
  for (;;) {
    const golden = queue.shift();
    if (!golden) return;
    try {
      await runCase(golden);
    } catch (error) {
      failures.push({ name: golden.name, error: String(error) });
      console.error(`FAIL  ${golden.name}: ${String(error)}`);
    }
  }
}

console.error(
  `Running ${goldens.cases.length} ${workflow} golden cases` +
    `${model ? ` on ${model}` : ""} (concurrency ${concurrency})...`,
);

// Run the first case alone: an auth failure aborts the run with one clear
// message instead of one identical failure per case.
const first = queue.shift();
if (first) {
  try {
    await runCase(first);
  } catch (error) {
    if (/authentication|authorization|api.?key|401/i.test(String(error))) {
      console.error(
        "\nNo Anthropic credentials. Either run `ant auth login` (the SDK" +
          " reads the stored profile automatically) or export" +
          " ANTHROPIC_API_KEY. `ant auth status` shows which source wins —" +
          " note a set ANTHROPIC_API_KEY silently overrides any profile.",
      );
      console.error(String(error));
      process.exit(1);
    }
    failures.push({ name: first.name, error: String(error) });
    console.error(`FAIL  ${first.name}: ${String(error)}`);
  }
}
await Promise.all(
  Array.from({ length: Math.max(1, concurrency) }, () => worker()),
);

writeFileSync(outPath, `${JSON.stringify(results, null, 2)}\n`);
console.error(`\nWrote ${Object.keys(results).length} results to ${outPath}`);
console.error(`Traces: ${tracesPath}`);
if (failures.length > 0) {
  console.error(`${failures.length} case(s) failed to run — recorded above.`);
}
console.error(
  `Grade: pnpm --filter @nola/evals run run -- --results ${outPath}`,
);
process.exit(failures.length > 0 ? 1 : 0);

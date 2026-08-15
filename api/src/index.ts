import cors from "@fastify/cors";
import type { Member } from "@nola/shared";
import Fastify from "fastify";

/**
 * Nola API — contract endpoints (plan section 9, API contract v1).
 * Day 1: health plus mock members. Supabase-backed data arrives Day 2.
 * pg-boss jobs run inside this same process from Day 3 on.
 */
const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.get("/health", async () => ({ ok: true, service: "nola-api" }));

app.get("/members", async (): Promise<Member[]> => {
  // Mock until the Day 2 seed. Synthetic data only — no real member data, ever.
  return [];
});

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "0.0.0.0" });

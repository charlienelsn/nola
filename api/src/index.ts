import cors from "@fastify/cors";
import {
  type Member,
  MemberSchema,
  type MemberState,
  MemberStateSchema,
} from "@nola/shared";
import Fastify from "fastify";
import { z } from "zod";
import { factFromRow, memberFromRow, pool } from "./db.js";

/**
 * Nola API — contract endpoints (plan section 9, API contract v1).
 * Day 2: members and member state served from local Supabase, validated
 * through @nola/shared Zod schemas at the boundary. Synthetic data only.
 * pg-boss jobs run inside this same process from Day 3 on.
 */
const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.get("/health", async () => ({ ok: true, service: "nola-api" }));

app.get("/members", async (): Promise<Member[]> => {
  const { rows } = await pool.query(
    "select * from members order by created_at, id",
  );
  return z.array(MemberSchema).parse(rows.map(memberFromRow));
});

app.get<{ Params: { id: string } }>(
  "/members/:id/state",
  async (req, reply): Promise<MemberState | undefined> => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) {
      reply.code(400).send({ error: "invalid member id" });
      return;
    }
    const member = await pool.query("select 1 from members where id = $1", [
      id.data,
    ]);
    if (member.rowCount === 0) {
      reply.code(404).send({ error: "member not found" });
      return;
    }
    // member_current_state is the derived view: active verified facts only.
    const { rows } = await pool.query(
      "select * from member_current_state where member_id = $1 order by entity, attribute",
      [id.data],
    );
    return MemberStateSchema.parse({
      memberId: id.data,
      facts: rows.map(factFromRow),
    });
  },
);

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "0.0.0.0" });

import type { Connection } from "@almanac/core/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

// Route config flag — set `config: { idempotent: true }` on routes that should honor the header.
declare module "fastify" {
  interface FastifyContextConfig {
    idempotent?: boolean;
  }
}

export function registerIdempotency(app: FastifyInstance, db: Connection) {
  const get = db.prepare("SELECT response FROM idempotency_keys WHERE key = ?");
  const put = db.prepare("INSERT OR REPLACE INTO idempotency_keys (key, response) VALUES (?, ?)");

  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.method !== "POST") return;
    if (!req.routeOptions?.config?.idempotent) return;
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string") return;
    const row = get.get(key) as { response: string } | undefined;
    if (row) {
      reply.header("idempotency-replayed", "true");
      reply.send(JSON.parse(row.response));
    }
  });

  app.addHook("onSend", async (req, _reply, payload) => {
    if (req.method !== "POST") return payload;
    if (!req.routeOptions?.config?.idempotent) return payload;
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string") return payload;
    if (typeof payload === "string") {
      put.run(key, payload);
    }
    return payload;
  });
}

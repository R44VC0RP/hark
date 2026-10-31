import {
  FEEDBACK_LIMIT_PER_DAY,
  FEEDBACK_LIMIT_PER_HOUR,
  feedbackCreateSchema,
} from "@hark/contracts";
import { and, count, eq, gte } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { feedback, user } from "../db/schema";
import { newId } from "../lib/id";
import { notifyOps } from "../lib/ops";
import { type AgentEnv, requireApiToken } from "../middleware";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Bug reports and requests for the Hark team, sent by agents (MCP
 * `feedback_submit`, `harkctl feedback`). Any valid agent token may send;
 * reports are stored and forwarded to the operator's phone.
 */
export const feedbackAgentRoute = new Hono<AgentEnv>()
  .use("*", requireApiToken)
  .post("/", async (c) => {
    const token = c.get("apiToken");
    const parsed = feedbackCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid feedback", issues: parsed.error.issues }, 400);
    }
    const now = new Date();
    const row = db.transaction((tx) => {
      const sentSince = (since: number) =>
        tx
          .select({ n: count() })
          .from(feedback)
          .where(and(eq(feedback.userId, token.userId), gte(feedback.createdAt, new Date(since))))
          .get()?.n ?? 0;
      if (
        sentSince(now.getTime() - HOUR_MS) >= FEEDBACK_LIMIT_PER_HOUR ||
        sentSince(now.getTime() - 24 * HOUR_MS) >= FEEDBACK_LIMIT_PER_DAY
      ) {
        return null;
      }
      const created = {
        id: newId("fb"),
        userId: token.userId,
        tokenId: token.id,
        client: token.name,
        kind: parsed.data.kind,
        message: parsed.data.message,
        context: parsed.data.context ?? null,
        createdAt: now,
      };
      tx.insert(feedback).values(created).run();
      return created;
    });
    if (!row) {
      return c.json(
        {
          error: `Feedback limit reached (${FEEDBACK_LIMIT_PER_HOUR} an hour, ${FEEDBACK_LIMIT_PER_DAY} a day). Email support@hark.fyi instead.`,
          code: "rate_limited",
        },
        429,
      );
    }

    const sender = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, token.userId))
      .get();
    void notifyOps({
      title: `Hark ${row.kind} report`,
      summary: row.message.slice(0, 200),
      body: [
        `From ${sender?.email ?? token.userId} via ${row.client ?? "an agent token"} (${row.id})`,
        "",
        row.message,
        ...(row.context ? ["", "Context:", row.context] : []),
      ].join("\n"),
    });

    return c.json(
      {
        feedback: { id: row.id, kind: row.kind, createdAt: row.createdAt.toISOString() },
        message: "Sent to the Hark team. Thanks!",
      },
      201,
    );
  });

import { and, eq, like } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  auditEvents,
  ledgerEntries,
  notifications,
  offerwallPostbacks,
  users,
  wallets,
  withdrawals,
} from "../drizzle/schema";
import { createWithdrawal, getDb, processOfferwallReward } from "./db";

const runAgainstStaging = process.env.RUN_MONEY_CONCURRENCY_TESTS === "1";
const describeStaging = runAgainstStaging ? describe : describe.skip;
const prefix = "orbit-concurrency-";
let userId: number | undefined;

afterEach(async () => {
  if (!userId) return;
  const db = await getDb();
  if (!db) return;
  await db.delete(notifications).where(eq(notifications.userId, userId));
  await db
    .delete(offerwallPostbacks)
    .where(eq(offerwallPostbacks.userId, userId));
  await db.delete(ledgerEntries).where(eq(ledgerEntries.userId, userId));
  await db.delete(withdrawals).where(eq(withdrawals.userId, userId));
  await db.delete(auditEvents).where(eq(auditEvents.actorUserId, userId));
  await db.delete(wallets).where(eq(wallets.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  userId = undefined;
});

describeStaging("money concurrency (staging only)", () => {
  it("allows only one simultaneous withdrawal that would exceed balance and daily cap", async () => {
    const db = await getDb();
    if (!db) throw new Error("A staging DATABASE_URL is required");
    const openId = `${prefix}${crypto.randomUUID()}`;
    const inserted = await db
      .insert(users)
      .values({ openId, name: "Concurrency test", role: "user" });
    userId = Number(inserted[0].insertId);
    await db.insert(wallets).values({ userId, balance: 50_000 });

    const results = await Promise.allSettled([
      createWithdrawal(userId, 40_000, "staging-a@example.test"),
      createWithdrawal(userId, 40_000, "staging-b@example.test"),
    ]);
    expect(
      results.filter(result => result.status === "fulfilled")
    ).toHaveLength(1);
    const wallet = (
      await db.select().from(wallets).where(eq(wallets.userId, userId))
    )[0];
    expect(wallet?.balance).toBe(10_000);
  });

  it("credits one postback only when the same provider transaction is delivered concurrently", async () => {
    const db = await getDb();
    if (!db) throw new Error("A staging DATABASE_URL is required");
    const openId = `${prefix}${crypto.randomUUID()}`;
    const inserted = await db
      .insert(users)
      .values({ openId, name: "Postback test", role: "user" });
    userId = Number(inserted[0].insertId);
    const reward = {
      transactionId: `concurrency-${crypto.randomUUID()}`,
      userId,
      amount: 1_250,
      offerName: "Staging offer",
    };
    const results = await Promise.all([
      processOfferwallReward(999_001, reward, "a".repeat(64)),
      processOfferwallReward(999_001, reward, "a".repeat(64)),
    ]);
    expect(results.filter(result => !result.duplicate)).toHaveLength(1);
    const wallet = (
      await db.select().from(wallets).where(eq(wallets.userId, userId))
    )[0];
    expect(wallet?.balance).toBe(1_250);
  });
});

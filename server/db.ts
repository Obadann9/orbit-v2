import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  auditEvents, InsertUser, ledgerEntries, offerProviders, referrals, taskClaims, tasks, users, wallets, withdrawals,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try { _db = drizzle(process.env.DATABASE_URL); } catch (error) { console.warn("[Database] Failed to connect:", error); }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId, lastSignedIn: user.lastSignedIn ?? new Date() };
  const updateSet: Record<string, unknown> = { lastSignedIn: values.lastSignedIn };
  for (const field of ["name", "email", "loginMethod"] as const) {
    if (user[field] !== undefined) { values[field] = user[field] ?? null; updateSet[field] = user[field] ?? null; }
  }
  if (user.role !== undefined || user.openId === ENV.ownerOpenId) { values.role = user.role ?? "admin"; updateSet.role = values.role; }
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb(); if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1); return result[0];
}

export async function ensureWallet(userId: number) {
  const db = await getDb(); if (!db) return { id: 0, userId, balance: 1840, lifetimeEarned: 12840, lifetimeWithdrawn: 11000 };
  await db.insert(wallets).values({ userId }).onDuplicateKeyUpdate({ set: { userId } });
  const result = await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1); return result[0];
}

export async function getWallet(userId: number) { return ensureWallet(userId); }

export async function getLedger(userId: number) {
  const db = await getDb();
  if (!db) return [
    { id: 1, userId, kind: "earn", amount: 500, balanceAfter: 1840, description: "Daily check-in", createdAt: new Date(Date.now() - 86400000) },
    { id: 2, userId, kind: "earn", amount: 1200, balanceAfter: 1340, description: "Survey completed", createdAt: new Date(Date.now() - 172800000) },
    { id: 3, userId, kind: "withdrawal_paid", amount: -5000, balanceAfter: 140, description: "PayPal withdrawal", createdAt: new Date(Date.now() - 604800000) },
  ];
  return db.select().from(ledgerEntries).where(eq(ledgerEntries.userId, userId)).orderBy(desc(ledgerEntries.createdAt)).limit(30);
}

export async function getTasks(userId: number) {
  const db = await getDb();
  if (!db) return [
    { id: 1, type: "DAILY", title: "Check in today", description: "Keep your streak alive", reward: 500, enabled: 1, claimed: false },
    { id: 2, type: "SURVEY", title: "Complete a quick survey", description: "Tell us what you think", reward: 1200, enabled: 1, claimed: false },
    { id: 3, type: "REFERRAL", title: "Invite a friend", description: "Earn when they complete a task", reward: 2500, enabled: 1, claimed: false },
  ];
  const rows = await db.select().from(tasks).where(eq(tasks.enabled, 1));
  const today = new Date().toISOString().slice(0, 10);
  const claims = await db.select().from(taskClaims).where(and(eq(taskClaims.userId, userId), eq(taskClaims.claimDate, today)));
  const claimedIds = new Set(claims.map((claim) => claim.taskId));
  return rows.map((task) => ({ ...task, claimed: claimedIds.has(task.id) }));
}

export async function getProviders() {
  const db = await getDb();
  if (!db) return [
    { id: 1, name: "Playtime", mark: "P", wallUrl: "https://example.com/offerwall/playtime", enabled: 1, sortOrder: 1 },
    { id: 2, name: "AdGate", mark: "A", wallUrl: "https://example.com/offerwall/adgate", enabled: 1, sortOrder: 2 },
    { id: 3, name: "Torox", mark: "T", wallUrl: "https://example.com/offerwall/torox", enabled: 1, sortOrder: 3 },
    { id: 4, name: "AyeT", mark: "Y", wallUrl: "https://example.com/offerwall/ayet", enabled: 1, sortOrder: 4 },
  ];
  return db.select().from(offerProviders).where(eq(offerProviders.enabled, 1)).orderBy(offerProviders.sortOrder);
}

export async function claimTask(userId: number, taskId: number) {
  const db = await getDb(); if (!db) return { ok: true, amount: taskId === 2 ? 1200 : 500, demo: true };
  const today = new Date().toISOString().slice(0, 10);
  const task = (await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.enabled, 1))).limit(1))[0];
  if (!task) throw new Error("Task not found");
  const already = (await db.select().from(taskClaims).where(and(eq(taskClaims.userId, userId), eq(taskClaims.taskId, taskId), eq(taskClaims.claimDate, today))).limit(1))[0];
  if (already) throw new Error("Task already claimed today");
  const wallet = await ensureWallet(userId); const nextBalance = (wallet?.balance ?? 0) + task.reward;
  await db.insert(taskClaims).values({ userId, taskId, claimDate: today });
  await db.update(wallets).set({ balance: nextBalance, lifetimeEarned: (wallet?.lifetimeEarned ?? 0) + task.reward }).where(eq(wallets.userId, userId));
  await db.insert(ledgerEntries).values({ userId, kind: "earn", amount: task.reward, balanceAfter: nextBalance, referenceType: "task", referenceId: String(taskId), description: task.title, idempotencyKey: `task:${userId}:${taskId}:${today}` });
  await maybeAwardReferral(userId);
  return { ok: true, amount: task.reward, balance: nextBalance };
}

export async function maybeAwardReferral(referredId: number) {
  const db = await getDb(); if (!db) return;
  const referral = (await db.select().from(referrals).where(and(eq(referrals.referredId, referredId), eq(referrals.status, "pending"))).limit(1))[0];
  if (!referral) return;
  const wallet = await ensureWallet(referral.referrerId); const nextBalance = (wallet?.balance ?? 0) + referral.bonus;
  await db.update(wallets).set({ balance: nextBalance, lifetimeEarned: (wallet?.lifetimeEarned ?? 0) + referral.bonus }).where(eq(wallets.userId, referral.referrerId));
  await db.insert(ledgerEntries).values({ userId: referral.referrerId, kind: "earn", amount: referral.bonus, balanceAfter: nextBalance, referenceType: "referral", referenceId: String(referral.id), description: "Referral bonus", idempotencyKey: `referral:${referral.id}` });
  await db.update(referrals).set({ status: "awarded", awardedAt: new Date() }).where(eq(referrals.id, referral.id));
}

export async function createWithdrawal(userId: number, amount: number, destination: string) {
  if (amount < 5000) throw new Error("Minimum withdrawal is $5.00");
  const db = await getDb(); if (!db) return { id: 0, status: "pending", amount };
  const wallet = await ensureWallet(userId); if (!wallet || wallet.balance < amount) throw new Error("Insufficient balance");
  const nextBalance = wallet.balance - amount;
  await db.update(wallets).set({ balance: nextBalance }).where(eq(wallets.userId, userId));
  const result = await db.insert(withdrawals).values({ userId, amount, method: "PayPal", destination, status: "pending" });
  await db.insert(ledgerEntries).values({ userId, kind: "withdrawal_hold", amount: -amount, balanceAfter: nextBalance, referenceType: "withdrawal", referenceId: String(result[0].insertId), description: "Cash-out held for review", idempotencyKey: `withdrawal:${result[0].insertId}` });
  return { id: result[0].insertId, status: "pending", amount };
}

export async function getAdminStats() {
  const db = await getDb(); if (!db) return { users: 1248, pendingPayouts: 18, paidOut: 84210, coinsIssued: 1284000 };
  const [userRows, pendingRows, paidRows, issuedRows] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(users),
    db.select({ total: sql<number>`coalesce(sum(${withdrawals.amount}),0)` }).from(withdrawals).where(eq(withdrawals.status, "pending")),
    db.select({ total: sql<number>`coalesce(sum(${withdrawals.amount}),0)` }).from(withdrawals).where(eq(withdrawals.status, "paid")),
    db.select({ total: sql<number>`coalesce(sum(${ledgerEntries.amount}),0)` }).from(ledgerEntries).where(eq(ledgerEntries.kind, "earn")),
  ]);
  return { users: Number(userRows[0]?.count ?? 0), pendingPayouts: Number(pendingRows[0]?.total ?? 0), paidOut: Number(paidRows[0]?.total ?? 0), coinsIssued: Number(issuedRows[0]?.total ?? 0) };
}

export async function getWithdrawals() {
  const db = await getDb(); if (!db) return [{ id: 101, userId: 23, amount: 10000, method: "PayPal", destination: "alex@example.com", status: "pending", createdAt: new Date() }];
  return db.select().from(withdrawals).orderBy(desc(withdrawals.createdAt)).limit(50);
}

export async function reviewWithdrawal(adminId: number, id: number, status: "approved" | "rejected") {
  const db = await getDb(); if (!db) return { ok: true };
  const item = (await db.select().from(withdrawals).where(eq(withdrawals.id, id)).limit(1))[0]; if (!item || item.status !== "pending") throw new Error("Withdrawal is no longer pending");
  await db.update(withdrawals).set({ status, reviewedBy: adminId, reviewedAt: new Date() }).where(eq(withdrawals.id, id));
  await db.insert(auditEvents).values({ actorUserId: adminId, action: `withdrawal.${status}`, entityType: "withdrawal", entityId: String(id), metadata: JSON.stringify({ amount: item.amount }) });
  if (status === "rejected") {
    const wallet = await ensureWallet(item.userId); const nextBalance = (wallet?.balance ?? 0) + item.amount;
    await db.update(wallets).set({ balance: nextBalance }).where(eq(wallets.userId, item.userId));
    await db.insert(ledgerEntries).values({ userId: item.userId, kind: "withdrawal_release", amount: item.amount, balanceAfter: nextBalance, referenceType: "withdrawal", referenceId: String(id), description: "Withdrawal released" });
  }
  return { ok: true };
}

export async function spendPoints(userId: number, amount: number, description: string) {
  if (amount <= 0) throw new Error("Amount must be positive");
  const db = await getDb(); if (!db) throw new Error("Database unavailable; points were not changed");
  const wallet = await ensureWallet(userId); if (!wallet || wallet.balance < amount) throw new Error("Insufficient balance");
  const nextBalance = wallet.balance - amount;
  await db.update(wallets).set({ balance: nextBalance }).where(eq(wallets.userId, userId));
  await db.insert(ledgerEntries).values({ userId, kind: "spend", amount: -amount, balanceAfter: nextBalance, description, referenceType: "spend" });
  await db.insert(auditEvents).values({ actorUserId: userId, action: "points.spend", entityType: "wallet", entityId: String(userId), metadata: JSON.stringify({ amount, description }) });
  return { ok: true, balance: nextBalance };
}

export async function transferPoints(userId: number, recipientId: number, amount: number) {
  if (amount <= 0 || recipientId === userId) throw new Error("Invalid transfer");
  const db = await getDb(); if (!db) throw new Error("Database unavailable; points were not changed");
  const sender = await ensureWallet(userId); const recipient = await ensureWallet(recipientId);
  if (!sender || sender.balance < amount || !recipient) throw new Error("Insufficient balance or recipient not found");
  const senderBalance = sender.balance - amount; const recipientBalance = recipient.balance + amount;
  await db.update(wallets).set({ balance: senderBalance }).where(eq(wallets.userId, userId));
  await db.update(wallets).set({ balance: recipientBalance }).where(eq(wallets.userId, recipientId));
  await db.insert(ledgerEntries).values([
    { userId, kind: "transfer_out", amount: -amount, balanceAfter: senderBalance, referenceType: "transfer", referenceId: String(recipientId), description: "Points transfer" },
    { userId: recipientId, kind: "transfer_in", amount, balanceAfter: recipientBalance, referenceType: "transfer", referenceId: String(userId), description: "Points received" },
  ]);
  await db.insert(auditEvents).values({ actorUserId: userId, action: "points.transfer", entityType: "wallet", entityId: String(recipientId), metadata: JSON.stringify({ amount }) });
  return { ok: true, balance: senderBalance };
}

export async function getReferral(userId: number) {
  const db = await getDb(); if (!db) return { code: `AX${String(userId).padStart(4, "0")}`, link: `https://orbit.app/r/AX${String(userId).padStart(4, "0")}`, bonus: 2500, referred: 0 };
  const row = (await db.select().from(referrals).where(eq(referrals.referrerId, userId)).limit(1))[0];
  const code = row?.code ?? `AX${String(userId).padStart(4, "0")}`;
  return { code, link: `https://orbit.app/r/${code}`, bonus: 2500, referred: row ? 1 : 0 };
}

export async function attachReferral(referredId: number, code: string) {
  const db = await getDb(); if (!db) return { ok: true };
  const referrer = (await db.select().from(users).where(eq(users.openId, code)).limit(1))[0];
  if (!referrer || referrer.id === referredId) throw new Error("Referral code not found");
  await db.insert(referrals).values({ referrerId: referrer.id, referredId, code, status: "pending" }).onDuplicateKeyUpdate({ set: { referredId } });
  return { ok: true };
}

export async function setUserRole(adminId: number, targetId: number, role: "user" | "admin") {
  const db = await getDb(); if (!db) throw new Error("Database unavailable");
  await db.update(users).set({ role }).where(eq(users.id, targetId));
  await db.insert(auditEvents).values({ actorUserId: adminId, action: "user.role.update", entityType: "user", entityId: String(targetId), metadata: JSON.stringify({ role }) });
  return { ok: true };
}

export async function getAdminUsers() {
  const db = await getDb(); if (!db) return [{ id: 7, name: "Alex Morgan", email: "alex@example.com", role: "user", createdAt: new Date() }];
  return db.select({ id: users.id, name: users.name, email: users.email, role: users.role, createdAt: users.createdAt }).from(users).orderBy(desc(users.createdAt)).limit(100);
}

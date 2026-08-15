import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  auditEvents,
  InsertUser,
  kycRequests,
  ledgerEntries,
  notifications,
  offerProviders,
  offerwallPostbacks,
  referrals,
  taskClaims,
  tasks,
  users,
  wallets,
  withdrawals,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { publishToUser } from "./realtime";
import type { OfferwallReward } from "./offerwall";
import {
  DAILY_WITHDRAWAL_LIMIT_POINTS,
  MINIMUM_WITHDRAWAL_POINTS,
  POINTS_PER_USD,
} from "@shared/const";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = {
    openId: user.openId,
    lastSignedIn: user.lastSignedIn ?? new Date(),
  };
  const updateSet: Record<string, unknown> = {
    lastSignedIn: values.lastSignedIn,
  };
  for (const field of ["name", "email", "loginMethod"] as const) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  if (user.role !== undefined || user.openId === ENV.ownerOpenId) {
    values.role = user.role ?? "admin";
    updateSet.role = values.role;
  }
  await db
    .insert(users)
    .values(values)
    .onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);
  return result[0];
}

export async function ensureWallet(userId: number) {
  const db = await getDb();
  if (!db)
    return {
      id: 0,
      userId,
      balance: 1840,
      lifetimeEarned: 12840,
      lifetimeWithdrawn: 11000,
    };
  await db
    .insert(wallets)
    .values({ userId })
    .onDuplicateKeyUpdate({ set: { userId } });
  const result = await db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);
  return result[0];
}

async function ensureWalletInTransaction(tx: any, userId: number) {
  await tx
    .insert(wallets)
    .values({ userId })
    .onDuplicateKeyUpdate({ set: { userId } });
  const wallet = (
    await tx.select().from(wallets).where(eq(wallets.userId, userId)).limit(1)
  )[0];
  if (!wallet) throw new Error("Wallet unavailable");
  return wallet;
}

function rowsChanged(result: unknown) {
  return Number((result as any)?.[0]?.affectedRows ?? 0);
}

export function exceedsDailyWithdrawalLimit(
  dailyTotal: number,
  requestedAmount: number
) {
  return dailyTotal + requestedAmount > DAILY_WITHDRAWAL_LIMIT_POINTS;
}

export async function recordUserActivity(userId: number, action: string) {
  const db = await getDb();
  if (!db) return;
  await db.insert(auditEvents).values({
    actorUserId: userId,
    action: "user.activity",
    entityType: "user",
    entityId: String(userId),
    metadata: JSON.stringify({ action }),
  });
}

export async function getWallet(userId: number) {
  await recordUserActivity(userId, "wallet_view");
  return ensureWallet(userId);
}

export async function getKycStatus(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  return (
    await db
      .select()
      .from(kycRequests)
      .where(eq(kycRequests.userId, userId))
      .orderBy(desc(kycRequests.requestedAt))
      .limit(1)
  )[0];
}

export async function requestKyc(
  adminId: number,
  userId: number,
  reason?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const active = (
    await db
      .select()
      .from(kycRequests)
      .where(eq(kycRequests.userId, userId))
      .orderBy(desc(kycRequests.requestedAt))
      .limit(1)
  )[0];
  if (
    active &&
    ["requested", "submitted", "under_review"].includes(active.status)
  )
    throw new Error("An active KYC request already exists");
  const result = await db.insert(kycRequests).values({
    userId,
    requestedBy: adminId,
    reason: reason?.trim() || null,
    status: "requested",
  });
  const id = Number(result[0].insertId);
  await db.insert(auditEvents).values({
    actorUserId: adminId,
    action: "kyc.requested",
    entityType: "kyc_request",
    entityId: String(id),
    metadata: JSON.stringify({ userId, reason: reason?.trim() || null }),
  });
  await emitNotification(
    userId,
    "system",
    "Identity verification requested",
    "An administrator requested KYC before certain account actions."
  );
  return { id, status: "requested" as const };
}

export async function submitKyc(userId: number, id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const request = (
    await db
      .select()
      .from(kycRequests)
      .where(and(eq(kycRequests.id, id), eq(kycRequests.userId, userId)))
      .limit(1)
  )[0];
  if (!request || request.status !== "requested")
    throw new Error("KYC request is not ready for submission");
  await db
    .update(kycRequests)
    .set({ status: "submitted", submittedAt: new Date() })
    .where(eq(kycRequests.id, id));
  await db.insert(auditEvents).values({
    actorUserId: userId,
    action: "kyc.submitted",
    entityType: "kyc_request",
    entityId: String(id),
  });
  return { ok: true, status: "submitted" as const };
}

export async function getKycRequests(
  status?: "requested" | "submitted" | "under_review" | "approved" | "rejected"
) {
  const db = await getDb();
  if (!db) return [];
  const query = db.select().from(kycRequests);
  return status
    ? query
        .where(eq(kycRequests.status, status))
        .orderBy(desc(kycRequests.requestedAt))
    : query.orderBy(desc(kycRequests.requestedAt));
}

export async function reviewKyc(
  adminId: number,
  id: number,
  status: "under_review" | "approved" | "rejected",
  reviewerNote?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const request = (
    await db.select().from(kycRequests).where(eq(kycRequests.id, id)).limit(1)
  )[0];
  const validTransition =
    (status === "under_review" && request?.status === "submitted") ||
    (["approved", "rejected"].includes(status) &&
      request?.status === "under_review");
  if (!validTransition) throw new Error("KYC request is not ready for review");
  await db
    .update(kycRequests)
    .set({
      status,
      reviewerNote: reviewerNote?.trim() || null,
      reviewedAt: new Date(),
      reviewedBy: adminId,
    })
    .where(eq(kycRequests.id, id));
  await db.insert(auditEvents).values({
    actorUserId: adminId,
    action: `kyc.${status}`,
    entityType: "kyc_request",
    entityId: String(id),
    metadata: JSON.stringify({ reviewerNote: reviewerNote?.trim() || null }),
  });
  if (status === "approved" || status === "rejected") {
    await emitNotification(
      request.userId,
      "system",
      status === "approved"
        ? "Identity verification approved"
        : "Identity verification needs attention",
      status === "approved"
        ? "Your KYC review is complete."
        : reviewerNote?.trim() ||
            "Please contact support regarding your KYC request."
    );
  }
  return { ok: true, status };
}

export async function getLedger(userId: number) {
  const db = await getDb();
  if (!db)
    return [
      {
        id: 1,
        userId,
        kind: "earn",
        amount: 500,
        balanceAfter: 1840,
        description: "Daily check-in",
        createdAt: new Date(Date.now() - 86400000),
      },
      {
        id: 2,
        userId,
        kind: "earn",
        amount: 1200,
        balanceAfter: 1340,
        description: "Survey completed",
        createdAt: new Date(Date.now() - 172800000),
      },
      {
        id: 3,
        userId,
        kind: "withdrawal_paid",
        amount: -5000,
        balanceAfter: 140,
        description: "PayPal withdrawal",
        createdAt: new Date(Date.now() - 604800000),
      },
    ];
  return db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.userId, userId))
    .orderBy(desc(ledgerEntries.createdAt))
    .limit(30);
}

export function taskActivationNotification(title: string, reward: number) {
  return {
    type: "task" as const,
    title: "New task available",
    body: `${title} is now live. Earn ${reward.toLocaleString()} points.`,
  };
}

export async function notifyTaskActivation(
  task: { title: string; reward: number },
  userIds: number[],
  emit: typeof emitNotification = emitNotification
) {
  const message = taskActivationNotification(task.title, task.reward);
  await Promise.all(
    userIds.map(userId =>
      emit(userId, message.type, message.title, message.body)
    )
  );
  return userIds.length;
}

type ActivatableTask = {
  id: number;
  title: string;
  reward: number;
  enabled: number;
};

type TaskActivationDeps = {
  loadTask: (taskId: number) => Promise<ActivatableTask | undefined>;
  setEnabled: (taskId: number, enabled: boolean) => Promise<void>;
  listUserIds: () => Promise<number[]>;
  audit: (
    adminId: number,
    taskId: number,
    enabled: boolean,
    title: string
  ) => Promise<void>;
  emit?: typeof emitNotification;
};

export async function activateTaskWithDependencies(
  adminId: number,
  taskId: number,
  enabled: boolean,
  deps: TaskActivationDeps
) {
  const task = await deps.loadTask(taskId);
  if (!task) throw new Error("Task not found");
  await deps.setEnabled(taskId, enabled);
  if (enabled && task.enabled === 0) {
    await notifyTaskActivation(task, await deps.listUserIds(), deps.emit);
  }
  await deps.audit(adminId, taskId, enabled, task.title);
  return { ok: true, enabled };
}

export async function activateTask(
  adminId: number,
  taskId: number,
  enabled: boolean,
  injectedDeps?: TaskActivationDeps
) {
  if (injectedDeps)
    return activateTaskWithDependencies(adminId, taskId, enabled, injectedDeps);
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return activateTaskWithDependencies(adminId, taskId, enabled, {
    loadTask: async id =>
      (await db.select().from(tasks).where(eq(tasks.id, id)).limit(1))[0],
    setEnabled: async (id, value) => {
      await db
        .update(tasks)
        .set({ enabled: value ? 1 : 0 })
        .where(eq(tasks.id, id));
    },
    listUserIds: async () =>
      (await db.select({ id: users.id }).from(users).limit(10000)).map(
        user => user.id
      ),
    audit: async (actorId, id, value, title) => {
      await db.insert(auditEvents).values({
        actorUserId: actorId,
        action: value ? "task.activate" : "task.deactivate",
        entityType: "task",
        entityId: String(id),
        metadata: JSON.stringify({ title }),
      });
    },
  });
}

export async function getTasks(userId: number) {
  await recordUserActivity(userId, "tasks_view");
  const db = await getDb();
  if (!db)
    return [
      {
        id: 1,
        type: "DAILY",
        title: "Check in today",
        description: "Keep your streak alive",
        reward: 500,
        enabled: 1,
        claimed: false,
      },
      {
        id: 2,
        type: "SURVEY",
        title: "Complete a quick survey",
        description: "Tell us what you think",
        reward: 1200,
        enabled: 1,
        claimed: false,
      },
      {
        id: 3,
        type: "REFERRAL",
        title: "Invite a friend",
        description: "Earn when they complete a task",
        reward: 2500,
        enabled: 1,
        claimed: false,
      },
    ];
  const rows = await db.select().from(tasks).where(eq(tasks.enabled, 1));
  const today = new Date().toISOString().slice(0, 10);
  const claims = await db
    .select()
    .from(taskClaims)
    .where(and(eq(taskClaims.userId, userId), eq(taskClaims.claimDate, today)));
  const claimedIds = new Set(claims.map(claim => claim.taskId));
  return rows.map(task => ({ ...task, claimed: claimedIds.has(task.id) }));
}

export async function getProviders() {
  const db = await getDb();
  if (!db)
    return [
      {
        id: 1,
        name: "Playtime",
        mark: "P",
        wallUrl: "https://example.com/offerwall/playtime",
        enabled: 1,
        sortOrder: 1,
      },
      {
        id: 2,
        name: "AdGate",
        mark: "A",
        wallUrl: "https://example.com/offerwall/adgate",
        enabled: 1,
        sortOrder: 2,
      },
      {
        id: 3,
        name: "Torox",
        mark: "T",
        wallUrl: "https://example.com/offerwall/torox",
        enabled: 1,
        sortOrder: 3,
      },
      {
        id: 4,
        name: "AyeT",
        mark: "Y",
        wallUrl: "https://example.com/offerwall/ayet",
        enabled: 1,
        sortOrder: 4,
      },
    ];
  return db
    .select()
    .from(offerProviders)
    .where(eq(offerProviders.enabled, 1))
    .orderBy(offerProviders.sortOrder);
}

export async function getOfferwallProviderByKey(providerKey: string) {
  const db = await getDb();
  if (!db) return undefined;
  return (
    await db
      .select()
      .from(offerProviders)
      .where(
        and(
          eq(offerProviders.providerKey, providerKey),
          eq(offerProviders.enabled, 1)
        )
      )
      .limit(1)
  )[0];
}

export async function getOfferwallProviderSettings() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: offerProviders.id,
      name: offerProviders.name,
      mark: offerProviders.mark,
      enabled: offerProviders.enabled,
      providerKey: offerProviders.providerKey,
      secretEnvKey: offerProviders.secretEnvKey,
      signatureMode: offerProviders.signatureMode,
      signatureHeader: offerProviders.signatureHeader,
      signatureField: offerProviders.signatureField,
      transactionIdField: offerProviders.transactionIdField,
      userIdField: offerProviders.userIdField,
      amountField: offerProviders.amountField,
      offerNameField: offerProviders.offerNameField,
      allowedIps: offerProviders.allowedIps,
    })
    .from(offerProviders)
    .orderBy(offerProviders.sortOrder);
}

export type OfferwallProviderSettingsInput = {
  id?: number;
  name: string;
  mark: string;
  wallUrl: string;
  enabled: boolean;
  sortOrder: number;
  providerKey: string;
  secretEnvKey: string;
  signatureMode: "hmac_body" | "hmac_query";
  signatureHeader: string;
  signatureField: string;
  transactionIdField: string;
  userIdField: string;
  amountField: string;
  offerNameField: string;
  allowedIps?: string;
};

export async function saveOfferwallProviderSettings(
  input: OfferwallProviderSettingsInput
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const values = {
    name: input.name.trim(),
    mark: input.mark.trim(),
    wallUrl: input.wallUrl.trim(),
    enabled: input.enabled ? 1 : 0,
    sortOrder: input.sortOrder,
    providerKey: input.providerKey.trim().toLowerCase(),
    secretEnvKey: input.secretEnvKey.trim(),
    signatureMode: input.signatureMode,
    signatureHeader: input.signatureHeader.trim(),
    signatureField: input.signatureField.trim(),
    transactionIdField: input.transactionIdField.trim(),
    userIdField: input.userIdField.trim(),
    amountField: input.amountField.trim(),
    offerNameField: input.offerNameField.trim(),
    allowedIps: input.allowedIps?.trim() || null,
  } as const;
  if (input.id) {
    await db
      .update(offerProviders)
      .set(values)
      .where(eq(offerProviders.id, input.id));
    return { id: input.id };
  }
  const result = await db.insert(offerProviders).values(values);
  return { id: Number(result[0].insertId) };
}

export async function processOfferwallReward(
  providerId: number,
  reward: OfferwallReward,
  payloadHash: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  try {
    const processed = await db.transaction(async tx => {
      await tx.insert(offerwallPostbacks).values({
        providerId,
        providerTransactionId: reward.transactionId,
        userId: reward.userId,
        amount: reward.amount,
        offerName: reward.offerName,
        payloadHash,
      });
      await ensureWalletInTransaction(tx, reward.userId);
      await tx
        .update(wallets)
        .set({
          balance: sql`${wallets.balance} + ${reward.amount}`,
          lifetimeEarned: sql`${wallets.lifetimeEarned} + ${reward.amount}`,
        })
        .where(eq(wallets.userId, reward.userId));
      const wallet = await ensureWalletInTransaction(tx, reward.userId);
      await tx.insert(ledgerEntries).values({
        userId: reward.userId,
        kind: "earn",
        amount: reward.amount,
        balanceAfter: wallet.balance,
        referenceType: "offerwall",
        referenceId: reward.transactionId,
        description: reward.offerName || "Offerwall reward",
        idempotencyKey: `offerwall:${providerId}:${reward.transactionId}`,
      });
      await tx.insert(auditEvents).values({
        actorUserId: null,
        action: "offerwall.rewarded",
        entityType: "offerwall_postback",
        entityId: reward.transactionId,
        metadata: JSON.stringify({
          providerId,
          userId: reward.userId,
          amount: reward.amount,
        }),
      });
      return { duplicate: false, balance: wallet.balance };
    });
    await emitNotification(
      reward.userId,
      "task",
      "Offer reward received",
      `+${reward.amount.toLocaleString()} points added${reward.offerName ? ` for ${reward.offerName}` : ""}`
    );
    return processed;
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY" || error?.cause?.code === "ER_DUP_ENTRY")
      return { duplicate: true, balance: undefined };
    throw error;
  }
}

export async function claimTask(userId: number, taskId: number) {
  const db = await getDb();
  if (!db) return { ok: true, amount: taskId === 2 ? 1200 : 500, demo: true };
  const today = new Date().toISOString().slice(0, 10);
  const result = await db.transaction(async tx => {
    const task = (
      await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.enabled, 1)))
        .limit(1)
    )[0];
    if (!task) throw new Error("Task not found");
    if (task.type !== "DAILY")
      throw new Error("This reward requires verified completion");
    await tx.insert(taskClaims).values({ userId, taskId, claimDate: today });
    await ensureWalletInTransaction(tx, userId);
    await tx
      .update(wallets)
      .set({
        balance: sql`${wallets.balance} + ${task.reward}`,
        lifetimeEarned: sql`${wallets.lifetimeEarned} + ${task.reward}`,
      })
      .where(eq(wallets.userId, userId));
    const wallet = await ensureWalletInTransaction(tx, userId);
    await tx.insert(ledgerEntries).values({
      userId,
      kind: "earn",
      amount: task.reward,
      balanceAfter: wallet.balance,
      referenceType: "task",
      referenceId: String(taskId),
      description: task.title,
      idempotencyKey: `task:${userId}:${taskId}:${today}`,
    });
    return { task, balance: wallet.balance };
  });
  await emitNotification(
    userId,
    "task",
    "Task complete",
    `+${result.task.reward.toLocaleString()} points added for ${result.task.title}`
  );
  await maybeAwardReferral(userId);
  return { ok: true, amount: result.task.reward, balance: result.balance };
}

export async function maybeAwardReferral(referredId: number) {
  const db = await getDb();
  if (!db) return;
  await db.transaction(async tx => {
    const referral = (
      await tx
        .select()
        .from(referrals)
        .where(
          and(
            eq(referrals.referredId, referredId),
            eq(referrals.status, "pending")
          )
        )
        .limit(1)
    )[0];
    if (!referral) return;
    const award = await tx
      .update(referrals)
      .set({ status: "awarded", awardedAt: new Date() })
      .where(
        and(eq(referrals.id, referral.id), eq(referrals.status, "pending"))
      );
    if (rowsChanged(award) !== 1) return;
    await ensureWalletInTransaction(tx, referral.referrerId);
    await tx
      .update(wallets)
      .set({
        balance: sql`${wallets.balance} + ${referral.bonus}`,
        lifetimeEarned: sql`${wallets.lifetimeEarned} + ${referral.bonus}`,
      })
      .where(eq(wallets.userId, referral.referrerId));
    const wallet = await ensureWalletInTransaction(tx, referral.referrerId);
    await tx.insert(ledgerEntries).values({
      userId: referral.referrerId,
      kind: "earn",
      amount: referral.bonus,
      balanceAfter: wallet.balance,
      referenceType: "referral",
      referenceId: String(referral.id),
      description: "Referral bonus",
      idempotencyKey: `referral:${referral.id}`,
    });
  });
}

export async function createWithdrawal(
  userId: number,
  amount: number,
  destination: string
) {
  if (!Number.isInteger(amount) || amount < MINIMUM_WITHDRAWAL_POINTS)
    throw new Error("Minimum withdrawal is $5.00");
  const db = await getDb();
  if (!db) return { id: 0, status: "pending", amount };
  const created = await db.transaction(async tx => {
    await tx
      .insert(wallets)
      .values({ userId })
      .onDuplicateKeyUpdate({ set: { userId } });
    const wallet = (
      await tx
        .select()
        .from(wallets)
        .where(eq(wallets.userId, userId))
        .for("update")
    )[0];
    if (!wallet) throw new Error("Wallet unavailable");
    const now = new Date();
    const dayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const daily = await tx
      .select({ total: sql<number>`coalesce(sum(${withdrawals.amount}), 0)` })
      .from(withdrawals)
      .where(
        and(
          eq(withdrawals.userId, userId),
          inArray(withdrawals.status, ["pending", "approved", "paid"]),
          gte(withdrawals.createdAt, dayStart),
          lt(withdrawals.createdAt, dayEnd)
        )
      );
    if (exceedsDailyWithdrawalLimit(Number(daily[0]?.total ?? 0), amount))
      throw new Error("Daily withdrawal limit is $50.00");
    const debit = await tx
      .update(wallets)
      .set({ balance: sql`${wallets.balance} - ${amount}` })
      .where(
        and(eq(wallets.userId, userId), sql`${wallets.balance} >= ${amount}`)
      );
    if (rowsChanged(debit) !== 1) throw new Error("Insufficient balance");
    const nextBalance = wallet.balance - amount;
    const result = await tx.insert(withdrawals).values({
      userId,
      amount,
      method: "PayPal",
      destination,
      status: "pending",
    });
    const withdrawalId = Number(result[0].insertId);
    await tx.insert(auditEvents).values({
      actorUserId: userId,
      action: "withdrawal.created",
      entityType: "withdrawal",
      entityId: String(withdrawalId),
      metadata: JSON.stringify({ amount, method: "PayPal" }),
    });
    await tx.insert(ledgerEntries).values({
      userId,
      kind: "withdrawal_hold",
      amount: -amount,
      balanceAfter: wallet.balance,
      referenceType: "withdrawal",
      referenceId: String(withdrawalId),
      description: "Cash-out held for review",
      idempotencyKey: `withdrawal:${withdrawalId}`,
    });
    return { id: withdrawalId, status: "pending" as const, amount };
  });
  await emitNotification(
    userId,
    "withdrawal",
    "Cash-out submitted",
    `Your ${moneyLabel(amount)} request is now under review.`
  );
  return created;
}

export function canViewWithdrawal(
  viewerId: number,
  ownerId: number,
  isAdmin: boolean
) {
  return isAdmin || viewerId === ownerId;
}

export function sortWithdrawalAudit<T extends { createdAt: Date | string }>(
  events: T[]
) {
  return [...events].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
}

type WithdrawalDetailsResult = {
  withdrawal: {
    id: number;
    userId: number;
    amount: number;
    method: string;
    destination: string;
    status: string;
    createdAt: Date;
  };
  audit: Array<{ createdAt: Date | string; action: string; id?: number }>;
};
let withdrawalDetailsProvider:
  | ((
      viewerId: number,
      withdrawalId: number,
      isAdmin: boolean
    ) => Promise<WithdrawalDetailsResult | undefined>)
  | undefined;

export function setWithdrawalDetailsProviderForTests(
  provider: typeof withdrawalDetailsProvider
) {
  withdrawalDetailsProvider = provider;
  return () => {
    withdrawalDetailsProvider = undefined;
  };
}

export async function getWithdrawalDetails(
  viewerId: number,
  withdrawalId: number,
  isAdmin = false
) {
  if (withdrawalDetailsProvider) {
    const result = await withdrawalDetailsProvider(
      viewerId,
      withdrawalId,
      isAdmin
    );
    if (
      !result ||
      !canViewWithdrawal(viewerId, result.withdrawal.userId, isAdmin)
    )
      return undefined;
    return { ...result, audit: sortWithdrawalAudit(result.audit) };
  }
  const db = await getDb();
  if (!db) return undefined;
  const withdrawal = (
    await db
      .select()
      .from(withdrawals)
      .where(
        isAdmin
          ? eq(withdrawals.id, withdrawalId)
          : and(
              eq(withdrawals.id, withdrawalId),
              eq(withdrawals.userId, viewerId)
            )
      )
      .limit(1)
  )[0];
  if (!withdrawal || !canViewWithdrawal(viewerId, withdrawal.userId, isAdmin))
    return undefined;
  const audit = await db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.entityType, "withdrawal"),
        eq(auditEvents.entityId, String(withdrawalId))
      )
    )
    .orderBy(desc(auditEvents.createdAt));
  return { withdrawal, audit: sortWithdrawalAudit(audit) };
}

const moneyLabel = (points: number) =>
  `$${(points / POINTS_PER_USD).toFixed(2)}`;

export async function getNotificationPreferences(userId: number) {
  const db = await getDb();
  if (!db) return { tasks: true, withdrawals: true, system: true };
  const user = (
    await db
      .select({
        notifyTasks: users.notifyTasks,
        notifyWithdrawals: users.notifyWithdrawals,
        notifySystem: users.notifySystem,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  )[0];
  return {
    tasks: Number(user?.notifyTasks ?? 1) !== 0,
    withdrawals: Number(user?.notifyWithdrawals ?? 1) !== 0,
    system: Number(user?.notifySystem ?? 1) !== 0,
  };
}

export async function updateNotificationPreferences(
  userId: number,
  prefs: { tasks: boolean; withdrawals: boolean; system: boolean }
) {
  const db = await getDb();
  if (!db) return prefs;
  await db
    .update(users)
    .set({
      notifyTasks: prefs.tasks ? 1 : 0,
      notifyWithdrawals: prefs.withdrawals ? 1 : 0,
      notifySystem: prefs.system ? 1 : 0,
    })
    .where(eq(users.id, userId));
  return prefs;
}

export function notificationAllowed(
  prefs: { tasks: boolean; withdrawals: boolean; system: boolean },
  type: "task" | "withdrawal" | "system"
) {
  return type === "task"
    ? prefs.tasks
    : type === "withdrawal"
      ? prefs.withdrawals
      : prefs.system;
}

export async function emitNotification(
  userId: number,
  type: "task" | "withdrawal" | "system",
  title: string,
  body: string
) {
  const prefs = await getNotificationPreferences(userId);
  if (!notificationAllowed(prefs, type)) return;
  const db = await getDb();
  if (db) {
    const result = await db
      .insert(notifications)
      .values({ userId, type, title, body });
    publishToUser(userId, {
      id: Number(result[0].insertId),
      type,
      title,
      body,
    });
  }
}

export async function getNotifications(userId: number) {
  const db = await getDb();
  if (!db)
    return [
      {
        id: 1,
        userId,
        type: "task",
        title: "New daily mission",
        body: "Check in today and earn 500 points.",
        readAt: null,
        createdAt: new Date(),
      },
      {
        id: 2,
        userId,
        type: "withdrawal",
        title: "Cash-out approved",
        body: "Your PayPal transfer is on its way.",
        readAt: null,
        createdAt: new Date(Date.now() - 86400000),
      },
    ];
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(30);
}

export async function markNotificationRead(userId: number, id: number) {
  const db = await getDb();
  if (!db) return { ok: true };
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
  return { ok: true };
}

export async function getAdminStats() {
  const db = await getDb();
  if (!db)
    return {
      users: 1248,
      pendingPayouts: 18,
      paidOut: 84210,
      coinsIssued: 1284000,
    };
  const [userRows, pendingRows, paidRows, issuedRows] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(users),
    db
      .select({ total: sql<number>`coalesce(sum(${withdrawals.amount}),0)` })
      .from(withdrawals)
      .where(eq(withdrawals.status, "pending")),
    db
      .select({ total: sql<number>`coalesce(sum(${withdrawals.amount}),0)` })
      .from(withdrawals)
      .where(eq(withdrawals.status, "paid")),
    db
      .select({ total: sql<number>`coalesce(sum(${ledgerEntries.amount}),0)` })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.kind, "earn")),
  ]);
  return {
    users: Number(userRows[0]?.count ?? 0),
    pendingPayouts: Number(pendingRows[0]?.total ?? 0),
    paidOut: Number(paidRows[0]?.total ?? 0),
    coinsIssued: Number(issuedRows[0]?.total ?? 0),
  };
}

export function paginateWithdrawals<
  T extends { amount: number; status: string; createdAt: Date },
>(
  rows: T[],
  filters?: {
    page?: number;
    pageSize?: number;
    sortBy?: "createdAt" | "amount" | "status";
    sortDir?: "asc" | "desc";
  }
) {
  const sortBy = filters?.sortBy || "createdAt";
  const direction = filters?.sortDir === "asc" ? 1 : -1;
  const sorted = [...rows].sort((a, b) => {
    const av =
      sortBy === "amount"
        ? a.amount
        : sortBy === "status"
          ? a.status
          : a.createdAt.getTime();
    const bv =
      sortBy === "amount"
        ? b.amount
        : sortBy === "status"
          ? b.status
          : b.createdAt.getTime();
    return (av < bv ? -1 : av > bv ? 1 : 0) * direction;
  });
  const pageSize = Math.min(Math.max(filters?.pageSize || 10, 5), 50);
  const page = Math.max(filters?.page || 1, 1);
  const totalPages = Math.max(Math.ceil(sorted.length / pageSize), 1);
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    items: sorted.slice(start, start + pageSize),
    total: sorted.length,
    page: safePage,
    pageSize,
    totalPages,
  };
}

export async function getWithdrawals(filters?: {
  status?: "pending" | "approved" | "rejected" | "paid";
  method?: string;
  minAmount?: number;
  maxAmount?: number;
  from?: number;
  to?: number;
  page?: number;
  pageSize?: number;
  sortBy?: "createdAt" | "amount" | "status";
  sortDir?: "asc" | "desc";
}) {
  const db = await getDb();
  if (!db) {
    const demo = [
      {
        id: 101,
        userId: 23,
        amount: 10000,
        method: "PayPal",
        destination: "alex@example.com",
        status: "pending",
        createdAt: new Date(),
      },
    ].filter(
      item =>
        (!filters?.status || item.status === filters.status) &&
        (!filters?.method || item.method === filters.method) &&
        (!filters?.minAmount || item.amount >= filters.minAmount) &&
        (!filters?.maxAmount || item.amount <= filters.maxAmount)
    );
    const pageSize = filters?.pageSize || 10;
    return {
      items: demo,
      total: demo.length,
      page: 1,
      pageSize,
      totalPages: 1,
    };
  }
  const rows = await db
    .select()
    .from(withdrawals)
    .orderBy(desc(withdrawals.createdAt))
    .limit(500);
  const filtered = rows.filter(
    item =>
      (!filters?.status || item.status === filters.status) &&
      (!filters?.method || item.method === filters.method) &&
      (!filters?.minAmount || item.amount >= filters.minAmount) &&
      (!filters?.maxAmount || item.amount <= filters.maxAmount) &&
      (!filters?.from || item.createdAt.getTime() >= filters.from) &&
      (!filters?.to || item.createdAt.getTime() <= filters.to)
  );
  return paginateWithdrawals(filtered, filters);
}

export async function reviewWithdrawal(
  adminId: number,
  id: number,
  status: "approved" | "rejected" | "paid"
) {
  const db = await getDb();
  if (!db) return { ok: true };
  const item = await db.transaction(async tx => {
    const current = (
      await tx.select().from(withdrawals).where(eq(withdrawals.id, id)).limit(1)
    )[0];
    const requiredStatus = status === "paid" ? "approved" : "pending";
    if (!current || current.status !== requiredStatus)
      throw new Error("Withdrawal is no longer eligible");
    const transition = await tx
      .update(withdrawals)
      .set({ status, reviewedBy: adminId, reviewedAt: new Date() })
      .where(
        and(eq(withdrawals.id, id), eq(withdrawals.status, requiredStatus))
      );
    if (rowsChanged(transition) !== 1)
      throw new Error("Withdrawal is no longer eligible");
    const wallet = await ensureWalletInTransaction(tx, current.userId);
    if (status === "paid") {
      await tx
        .update(wallets)
        .set({
          lifetimeWithdrawn: sql`${wallets.lifetimeWithdrawn} + ${current.amount}`,
        })
        .where(eq(wallets.userId, current.userId));
      await tx.insert(ledgerEntries).values({
        userId: current.userId,
        kind: "withdrawal_paid",
        amount: 0,
        balanceAfter: wallet.balance,
        referenceType: "withdrawal",
        referenceId: String(id),
        description: "Withdrawal paid",
        idempotencyKey: `withdrawal-paid:${id}`,
      });
    }
    if (status === "rejected") {
      await tx
        .update(wallets)
        .set({ balance: sql`${wallets.balance} + ${current.amount}` })
        .where(eq(wallets.userId, current.userId));
      const releasedWallet = await ensureWalletInTransaction(
        tx,
        current.userId
      );
      await tx.insert(ledgerEntries).values({
        userId: current.userId,
        kind: "withdrawal_release",
        amount: current.amount,
        balanceAfter: releasedWallet.balance,
        referenceType: "withdrawal",
        referenceId: String(id),
        description: "Withdrawal released",
        idempotencyKey: `withdrawal-release:${id}`,
      });
    }
    await tx.insert(auditEvents).values({
      actorUserId: adminId,
      action: `withdrawal.${status}`,
      entityType: "withdrawal",
      entityId: String(id),
      metadata: JSON.stringify({ amount: current.amount }),
    });
    return current;
  });
  await emitNotification(
    item.userId,
    "withdrawal",
    status === "paid"
      ? "Cash-out paid"
      : status === "approved"
        ? "Cash-out approved"
        : "Cash-out rejected",
    status === "paid"
      ? `Your ${moneyLabel(item.amount)} transfer was marked paid.`
      : status === "approved"
        ? `Your ${moneyLabel(item.amount)} request was approved.`
        : `Your ${moneyLabel(item.amount)} request was returned to your balance.`
  );
  return { ok: true };
}

export async function spendPoints(
  userId: number,
  amount: number,
  description: string
) {
  if (!Number.isInteger(amount) || amount <= 0)
    throw new Error("Amount must be positive");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable; points were not changed");
  return db.transaction(async tx => {
    await ensureWalletInTransaction(tx, userId);
    const debit = await tx
      .update(wallets)
      .set({ balance: sql`${wallets.balance} - ${amount}` })
      .where(
        and(eq(wallets.userId, userId), sql`${wallets.balance} >= ${amount}`)
      );
    if (rowsChanged(debit) !== 1) throw new Error("Insufficient balance");
    const wallet = await ensureWalletInTransaction(tx, userId);
    await tx.insert(ledgerEntries).values({
      userId,
      kind: "spend",
      amount: -amount,
      balanceAfter: wallet.balance,
      description,
      referenceType: "spend",
    });
    await tx.insert(auditEvents).values({
      actorUserId: userId,
      action: "points.spend",
      entityType: "wallet",
      entityId: String(userId),
      metadata: JSON.stringify({ amount, description }),
    });
    return { ok: true, balance: wallet.balance };
  });
}

export async function transferPoints(
  userId: number,
  recipientId: number,
  amount: number
) {
  void userId;
  void recipientId;
  void amount;
  throw new Error(
    "Point transfers are temporarily disabled for fraud prevention"
  );
}

export async function getReferral(userId: number) {
  const db = await getDb();
  if (!db)
    return {
      code: `AX${String(userId).padStart(4, "0")}`,
      link: `https://orbit.app/r/AX${String(userId).padStart(4, "0")}`,
      bonus: 2500,
      referred: 0,
    };
  const row = (
    await db
      .select()
      .from(referrals)
      .where(eq(referrals.referrerId, userId))
      .limit(1)
  )[0];
  const code = row?.code ?? `AX${String(userId).padStart(4, "0")}`;
  return {
    code,
    link: `https://orbit.app/r/${code}`,
    bonus: 2500,
    referred: row ? 1 : 0,
  };
}

export async function attachReferral(referredId: number, code: string) {
  const db = await getDb();
  if (!db) return { ok: true };
  const normalizedCode = code.trim();
  const parsedId = /^AX(\d{1,12})$/i.exec(normalizedCode)?.[1];
  const referralRow = parsedId
    ? undefined
    : (
        await db
          .select()
          .from(referrals)
          .where(eq(referrals.code, normalizedCode))
          .limit(1)
      )[0];
  const referrer = parsedId
    ? (
        await db
          .select()
          .from(users)
          .where(eq(users.id, Number(parsedId)))
          .limit(1)
      )[0]
    : referralRow
      ? (
          await db
            .select()
            .from(users)
            .where(eq(users.id, referralRow.referrerId))
            .limit(1)
        )[0]
      : undefined;
  if (!referrer || referrer.id === referredId)
    throw new Error("Referral code not found");
  const existing = (
    await db
      .select()
      .from(referrals)
      .where(eq(referrals.referredId, referredId))
      .limit(1)
  )[0];
  if (existing) return { ok: true };
  await db.insert(referrals).values({
    referrerId: referrer.id,
    referredId,
    code: code.trim(),
    status: "pending",
  });
  return { ok: true };
}

export async function setUserRole(
  adminId: number,
  targetId: number,
  role: "user" | "admin"
) {
  if (adminId === targetId && role === "user")
    throw new Error("You cannot demote yourself");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(users).set({ role }).where(eq(users.id, targetId));
  await db.insert(auditEvents).values({
    actorUserId: adminId,
    action: "user.role.update",
    entityType: "user",
    entityId: String(targetId),
    metadata: JSON.stringify({ role }),
  });
  return { ok: true };
}

export async function getAdminUsers() {
  const db = await getDb();
  if (!db)
    return [
      {
        id: 7,
        name: "Alex Morgan",
        email: "alex@example.com",
        role: "user",
        createdAt: new Date(),
      },
    ];
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(100);
}

export async function getUserWithdrawals(userId: number) {
  const db = await getDb();
  if (!db)
    return [
      {
        id: 101,
        userId,
        amount: 5000,
        method: "PayPal",
        destination: "user@example.com",
        status: "paid" as const,
        createdAt: new Date(Date.now() - 86400000 * 4),
      },
      {
        id: 102,
        userId,
        amount: 8000,
        method: "PayPal",
        destination: "user@example.com",
        status: "pending" as const,
        createdAt: new Date(Date.now() - 86400000),
      },
    ];
  return db
    .select()
    .from(withdrawals)
    .where(eq(withdrawals.userId, userId))
    .orderBy(desc(withdrawals.createdAt))
    .limit(30);
}

export async function getAdminTrends() {
  const db = await getDb();
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    return date;
  });
  if (!db)
    return days.map((date, index) => ({
      label: date.toLocaleDateString(undefined, { weekday: "short" }),
      withdrawals: [2, 4, 3, 6, 5, 8, 7][index] ?? 0,
      users: [4, 6, 5, 9, 8, 11, 13][index] ?? 0,
    }));
  const [withdrawalRows, userRows, activityRows] = await Promise.all([
    db
      .select({ amount: withdrawals.amount, createdAt: withdrawals.createdAt })
      .from(withdrawals)
      .limit(500),
    db.select({ createdAt: users.createdAt }).from(users).limit(500),
    db
      .select({ createdAt: auditEvents.createdAt })
      .from(auditEvents)
      .where(eq(auditEvents.action, "user.activity"))
      .limit(1000),
  ]);
  return days.map(date => {
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    return {
      label: date.toLocaleDateString(undefined, { weekday: "short" }),
      withdrawals: withdrawalRows
        .filter(row => row.createdAt >= date && row.createdAt < next)
        .reduce((sum, row) => sum + row.amount, 0),
      users: activityRows.filter(
        row => row.createdAt >= date && row.createdAt < next
      ).length,
    };
  });
}

import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  auditEvents,
  InsertUser,
  ledgerEntries,
  notifications,
  offerProviders,
  referrals,
  taskClaims,
  tasks,
  users,
  wallets,
  withdrawals,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { publishToUser } from "./realtime";

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

export async function claimTask(userId: number, taskId: number) {
  const db = await getDb();
  if (!db) return { ok: true, amount: taskId === 2 ? 1200 : 500, demo: true };
  const today = new Date().toISOString().slice(0, 10);
  const task = (
    await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.enabled, 1)))
      .limit(1)
  )[0];
  if (!task) throw new Error("Task not found");
  const already = (
    await db
      .select()
      .from(taskClaims)
      .where(
        and(
          eq(taskClaims.userId, userId),
          eq(taskClaims.taskId, taskId),
          eq(taskClaims.claimDate, today)
        )
      )
      .limit(1)
  )[0];
  if (already) throw new Error("Task already claimed today");
  const wallet = await ensureWallet(userId);
  const nextBalance = (wallet?.balance ?? 0) + task.reward;
  await db.insert(taskClaims).values({ userId, taskId, claimDate: today });
  await db
    .update(wallets)
    .set({
      balance: nextBalance,
      lifetimeEarned: (wallet?.lifetimeEarned ?? 0) + task.reward,
    })
    .where(eq(wallets.userId, userId));
  await db.insert(ledgerEntries).values({
    userId,
    kind: "earn",
    amount: task.reward,
    balanceAfter: nextBalance,
    referenceType: "task",
    referenceId: String(taskId),
    description: task.title,
    idempotencyKey: `task:${userId}:${taskId}:${today}`,
  });
  await emitNotification(
    userId,
    "task",
    "Task complete",
    `+${task.reward.toLocaleString()} points added for ${task.title}`
  );
  await maybeAwardReferral(userId);
  return { ok: true, amount: task.reward, balance: nextBalance };
}

export async function maybeAwardReferral(referredId: number) {
  const db = await getDb();
  if (!db) return;
  const referral = (
    await db
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
  const wallet = await ensureWallet(referral.referrerId);
  const nextBalance = (wallet?.balance ?? 0) + referral.bonus;
  await db
    .update(wallets)
    .set({
      balance: nextBalance,
      lifetimeEarned: (wallet?.lifetimeEarned ?? 0) + referral.bonus,
    })
    .where(eq(wallets.userId, referral.referrerId));
  await db.insert(ledgerEntries).values({
    userId: referral.referrerId,
    kind: "earn",
    amount: referral.bonus,
    balanceAfter: nextBalance,
    referenceType: "referral",
    referenceId: String(referral.id),
    description: "Referral bonus",
    idempotencyKey: `referral:${referral.id}`,
  });
  await db
    .update(referrals)
    .set({ status: "awarded", awardedAt: new Date() })
    .where(eq(referrals.id, referral.id));
}

export async function createWithdrawal(
  userId: number,
  amount: number,
  destination: string
) {
  if (amount < 5000) throw new Error("Minimum withdrawal is $5.00");
  const db = await getDb();
  if (!db) return { id: 0, status: "pending", amount };
  const wallet = await ensureWallet(userId);
  if (!wallet || wallet.balance < amount)
    throw new Error("Insufficient balance");
  const nextBalance = wallet.balance - amount;
  await db
    .update(wallets)
    .set({ balance: nextBalance })
    .where(eq(wallets.userId, userId));
  const result = await db.insert(withdrawals).values({
    userId,
    amount,
    method: "PayPal",
    destination,
    status: "pending",
  });
  const withdrawalId = Number(result[0].insertId);
  await db.insert(auditEvents).values({
    actorUserId: userId,
    action: "withdrawal.created",
    entityType: "withdrawal",
    entityId: String(withdrawalId),
    metadata: JSON.stringify({ amount, method: "PayPal" }),
  });
  await db.insert(ledgerEntries).values({
    userId,
    kind: "withdrawal_hold",
    amount: -amount,
    balanceAfter: nextBalance,
    referenceType: "withdrawal",
    referenceId: String(withdrawalId),
    description: "Cash-out held for review",
    idempotencyKey: `withdrawal:${withdrawalId}`,
  });
  await emitNotification(
    userId,
    "withdrawal",
    "Cash-out submitted",
    `Your ${moneyLabel(amount)} request is now under review.`
  );
  return { id: withdrawalId, status: "pending", amount };
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

const moneyLabel = (points: number) => `$${(points / 1000).toFixed(2)}`;

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
  const item = (
    await db.select().from(withdrawals).where(eq(withdrawals.id, id)).limit(1)
  )[0];
  if (
    !item ||
    (status === "paid" ? item.status !== "approved" : item.status !== "pending")
  )
    throw new Error("Withdrawal is no longer eligible");
  await db
    .update(withdrawals)
    .set({ status, reviewedBy: adminId, reviewedAt: new Date() })
    .where(eq(withdrawals.id, id));
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
  await db.insert(auditEvents).values({
    actorUserId: adminId,
    action: `withdrawal.${status}`,
    entityType: "withdrawal",
    entityId: String(id),
    metadata: JSON.stringify({ amount: item.amount }),
  });
  if (status === "paid") {
    const wallet = await ensureWallet(item.userId);
    const paidBalance = wallet?.balance ?? 0;
    await db
      .update(wallets)
      .set({
        lifetimeWithdrawn: (wallet?.lifetimeWithdrawn ?? 0) + item.amount,
      })
      .where(eq(wallets.userId, item.userId));
    await db.insert(ledgerEntries).values({
      userId: item.userId,
      kind: "withdrawal_paid",
      amount: 0,
      balanceAfter: paidBalance,
      referenceType: "withdrawal",
      referenceId: String(id),
      description: "Withdrawal paid",
      idempotencyKey: `withdrawal-paid:${id}`,
    });
  }
  if (status === "rejected") {
    const wallet = await ensureWallet(item.userId);
    const nextBalance = (wallet?.balance ?? 0) + item.amount;
    await db
      .update(wallets)
      .set({ balance: nextBalance })
      .where(eq(wallets.userId, item.userId));
    await db.insert(ledgerEntries).values({
      userId: item.userId,
      kind: "withdrawal_release",
      amount: item.amount,
      balanceAfter: nextBalance,
      referenceType: "withdrawal",
      referenceId: String(id),
      description: "Withdrawal released",
    });
  }
  return { ok: true };
}

export async function spendPoints(
  userId: number,
  amount: number,
  description: string
) {
  if (amount <= 0) throw new Error("Amount must be positive");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable; points were not changed");
  const wallet = await ensureWallet(userId);
  if (!wallet || wallet.balance < amount)
    throw new Error("Insufficient balance");
  const nextBalance = wallet.balance - amount;
  await db
    .update(wallets)
    .set({ balance: nextBalance })
    .where(eq(wallets.userId, userId));
  await db.insert(ledgerEntries).values({
    userId,
    kind: "spend",
    amount: -amount,
    balanceAfter: nextBalance,
    description,
    referenceType: "spend",
  });
  await db.insert(auditEvents).values({
    actorUserId: userId,
    action: "points.spend",
    entityType: "wallet",
    entityId: String(userId),
    metadata: JSON.stringify({ amount, description }),
  });
  return { ok: true, balance: nextBalance };
}

export async function transferPoints(
  userId: number,
  recipientId: number,
  amount: number
) {
  if (amount <= 0 || recipientId === userId)
    throw new Error("Invalid transfer");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable; points were not changed");
  const sender = await ensureWallet(userId);
  const recipient = await ensureWallet(recipientId);
  if (!sender || sender.balance < amount || !recipient)
    throw new Error("Insufficient balance or recipient not found");
  const senderBalance = sender.balance - amount;
  const recipientBalance = recipient.balance + amount;
  await db
    .update(wallets)
    .set({ balance: senderBalance })
    .where(eq(wallets.userId, userId));
  await db
    .update(wallets)
    .set({ balance: recipientBalance })
    .where(eq(wallets.userId, recipientId));
  await db.insert(ledgerEntries).values([
    {
      userId,
      kind: "transfer_out",
      amount: -amount,
      balanceAfter: senderBalance,
      referenceType: "transfer",
      referenceId: String(recipientId),
      description: "Points transfer",
    },
    {
      userId: recipientId,
      kind: "transfer_in",
      amount,
      balanceAfter: recipientBalance,
      referenceType: "transfer",
      referenceId: String(userId),
      description: "Points received",
    },
  ]);
  await db.insert(auditEvents).values({
    actorUserId: userId,
    action: "points.transfer",
    entityType: "wallet",
    entityId: String(recipientId),
    metadata: JSON.stringify({ amount }),
  });
  return { ok: true, balance: senderBalance };
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

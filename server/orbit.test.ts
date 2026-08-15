import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import {
  createWithdrawal,
  emitNotification,
  taskActivationNotification,
  notifyTaskActivation,
  activateTask,
  activateTaskWithDependencies,
  getAdminUsers,
  getKycStatus,
  getNotifications,
  canViewWithdrawal,
  sortWithdrawalAudit,
  setWithdrawalDetailsProviderForTests,
  notificationAllowed,
  paginateWithdrawals,
  updateNotificationPreferences,
} from "./db";
import type { TrpcContext } from "./_core/context";
import { publishToUser, subscribeToUser } from "./realtime";
import {
  ORBIT_POLICY_NOTICE,
  ORBIT_POLICY_SECTIONS,
} from "../client/src/policyContent";

function context(role: "user" | "admin" = "user", userId = 7): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `orbit-test-${userId}`,
      name: "Orbit Test",
      email: "test@orbit.app",
      loginMethod: "test",
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => undefined } as TrpcContext["res"],
  };
}

describe("Orbit financial safeguards", () => {
  it("rejects cash-out requests below the minimum threshold", async () => {
    await expect(createWithdrawal(7, 4999, "test@orbit.app")).rejects.toThrow(
      "Minimum withdrawal"
    );
  });

  it("does not expose admin stats to regular users", async () => {
    const caller = appRouter.createCaller(context("user"));
    await expect(caller.orbit.admin.stats()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("allows owner-role users to read admin stats", async () => {
    const caller = appRouter.createCaller(context("admin"));
    const stats = await caller.orbit.admin.stats();
    expect(stats).toHaveProperty("users");
    expect(stats).toHaveProperty("pendingPayouts");
  });
});

describe("Orbit notifications and admin filters", () => {
  it("returns an in-app notification list for an authenticated user", async () => {
    const caller = appRouter.createCaller(context("user"));
    const result = await caller.orbit.notifications();
    expect(Array.isArray(result)).toBe(true);
  });

  it("accepts status filters only through the admin procedure", async () => {
    const caller = appRouter.createCaller(context("admin"));
    const result = await caller.orbit.admin.withdrawals({
      status: "pending",
      minAmount: 5000,
    });
    expect(Array.isArray(result.items)).toBe(true);
    await expect(
      appRouter
        .createCaller(context("user"))
        .orbit.admin.withdrawals({ status: "pending" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("Orbit withdrawal event filters", () => {
  it("accepts date-range filters and paid review input for admins", async () => {
    const caller = appRouter.createCaller(context("admin"));
    const result = await caller.orbit.admin.withdrawals({
      from: Date.now() - 86400000,
      to: Date.now(),
    });
    expect(Array.isArray(result.items)).toBe(true);
    await expect(
      caller.orbit.admin.reviewWithdrawal({ id: 999999, status: "paid" })
    ).rejects.toBeDefined();
  });
});

describe("Orbit notification preferences", () => {
  it("reads and updates notification preferences", async () => {
    const caller = appRouter.createCaller(context("user"));
    const current = await caller.orbit.notificationPreferences();
    const updated = await caller.orbit.updateNotificationPreferences({
      ...current,
      tasks: false,
    });
    expect(updated.tasks).toBe(false);
    expect(updated.withdrawals).toBe(current.withdrawals);
    await caller.orbit.updateNotificationPreferences({
      tasks: true,
      withdrawals: true,
      system: true,
    });
  });
});

describe("Orbit pagination, sorting, and notification guards", () => {
  const rows = [
    {
      id: 1,
      amount: 900,
      status: "pending",
      createdAt: new Date("2026-01-01"),
    },
    {
      id: 2,
      amount: 2400,
      status: "approved",
      createdAt: new Date("2026-01-03"),
    },
    {
      id: 3,
      amount: 1200,
      status: "rejected",
      createdAt: new Date("2026-01-02"),
    },
    { id: 4, amount: 5000, status: "paid", createdAt: new Date("2026-01-04") },
    {
      id: 5,
      amount: 1800,
      status: "pending",
      createdAt: new Date("2026-01-05"),
    },
    { id: 6, amount: 3000, status: "paid", createdAt: new Date("2026-01-06") },
  ];

  it("returns page metadata and slices the requested page", () => {
    const result = paginateWithdrawals(rows, {
      page: 2,
      pageSize: 5,
      sortBy: "amount",
      sortDir: "asc",
    });
    expect(result.total).toBe(6);
    expect(result.totalPages).toBe(2);
    expect(result.page).toBe(2);
    expect(result.items.map(item => item.id)).toEqual([4]);
  });

  it("sorts by amount and status in both directions", () => {
    expect(
      paginateWithdrawals(rows, {
        sortBy: "amount",
        sortDir: "desc",
        pageSize: 10,
      }).items[0]?.amount
    ).toBe(5000);
    expect(
      paginateWithdrawals(rows, {
        sortBy: "status",
        sortDir: "asc",
        pageSize: 10,
      }).items[0]?.status
    ).toBe("approved");
  });

  it("blocks notification creation for a disabled category", () => {
    expect(
      notificationAllowed(
        { tasks: false, withdrawals: true, system: true },
        "task"
      )
    ).toBe(false);
    expect(
      notificationAllowed(
        { tasks: false, withdrawals: true, system: true },
        "withdrawal"
      )
    ).toBe(true);
  });
});

describe("Orbit complete sort and notification policy coverage", () => {
  const rows = [
    {
      id: 1,
      amount: 900,
      status: "pending",
      createdAt: new Date("2026-01-01"),
    },
    {
      id: 2,
      amount: 2400,
      status: "approved",
      createdAt: new Date("2026-01-03"),
    },
    {
      id: 3,
      amount: 1200,
      status: "rejected",
      createdAt: new Date("2026-01-02"),
    },
  ];

  it("sorts date, amount, and status in ascending and descending directions", () => {
    expect(
      paginateWithdrawals(rows, {
        sortBy: "createdAt",
        sortDir: "asc",
        pageSize: 10,
      }).items.map(item => item.id)
    ).toEqual([1, 3, 2]);
    expect(
      paginateWithdrawals(rows, {
        sortBy: "createdAt",
        sortDir: "desc",
        pageSize: 10,
      }).items.map(item => item.id)
    ).toEqual([2, 3, 1]);
    expect(
      paginateWithdrawals(rows, {
        sortBy: "amount",
        sortDir: "asc",
        pageSize: 10,
      }).items.map(item => item.amount)
    ).toEqual([900, 1200, 2400]);
    expect(
      paginateWithdrawals(rows, {
        sortBy: "amount",
        sortDir: "desc",
        pageSize: 10,
      }).items.map(item => item.amount)
    ).toEqual([2400, 1200, 900]);
    expect(
      paginateWithdrawals(rows, {
        sortBy: "status",
        sortDir: "asc",
        pageSize: 10,
      }).items.map(item => item.status)
    ).toEqual(["approved", "pending", "rejected"]);
    expect(
      paginateWithdrawals(rows, {
        sortBy: "status",
        sortDir: "desc",
        pageSize: 10,
      }).items.map(item => item.status)
    ).toEqual(["rejected", "pending", "approved"]);
  });

  it("applies notification policy to every category", () => {
    const disabled = { tasks: false, withdrawals: false, system: false };
    expect(
      ["task", "withdrawal", "system"].every(
        type => !notificationAllowed(disabled, type as any)
      )
    ).toBe(true);
  });
});

describe("Orbit notification emission integration", () => {
  it("does not insert a task notification when task notifications are disabled", async () => {
    const existingUser = (await getAdminUsers())[0];
    const userId = existingUser?.id ?? 7;
    const before = await getNotifications(userId);
    await updateNotificationPreferences(userId, {
      tasks: false,
      withdrawals: true,
      system: true,
    });
    const suppressedTitle = `Suppressed task ${Date.now()}`;
    await emitNotification(
      userId,
      "task",
      suppressedTitle,
      "This should be suppressed"
    );
    const after = await getNotifications(userId);
    expect(after.some(item => item.title === suppressedTitle)).toBe(false);
    await updateNotificationPreferences(userId, {
      tasks: true,
      withdrawals: true,
      system: true,
    });
  });
});

describe("Orbit admin safety", () => {
  it("does not allow an admin to demote themselves", async () => {
    const caller = appRouter.createCaller(context("admin"));
    await expect(
      caller.orbit.admin.setUserRole({ userId: 7, role: "user" })
    ).rejects.toThrow("cannot demote yourself");
  });
});

describe("Orbit task activation notifications", () => {
  it("activates a disabled task and dispatches its notification without getTasks", async () => {
    const writes: string[] = [];
    const unsubscribe = subscribeToUser(7, {
      write: (payload: string) => writes.push(payload),
    } as any);
    const result = await activateTask(1, 42, true, {
      loadTask: async () => ({
        id: 42,
        title: "Weekend survey",
        reward: 1200,
        enabled: 0,
      }),
      setEnabled: async () => undefined,
      listUserIds: async () => [7],
      audit: async () => undefined,
      emit: async (userId, type, title, body) => {
        expect(type).toBe("task");
        publishToUser(userId, { type, title, body });
      },
    });
    expect(result).toEqual({ ok: true, enabled: true });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("New task available");
    unsubscribe();
  });

  it("creates and dispatches a publish notification without reading the task list", async () => {
    const events: Array<{ userId: number; title: string }> = [];
    const delivered = await notifyTaskActivation(
      { title: "Weekend survey", reward: 1200 },
      [7, 8],
      async (userId, type, title) => {
        expect(type).toBe("task");
        events.push({ userId, title });
      }
    );
    expect(delivered).toBe(2);
    expect(events).toEqual([
      { userId: 7, title: "New task available" },
      { userId: 8, title: "New task available" },
    ]);
  });
});

describe("Orbit realtime notifications", () => {
  it("publishes an event only while the user is subscribed", () => {
    const writes: string[] = [];
    const response = {
      write: (payload: string) => writes.push(payload),
    } as any;
    const unsubscribe = subscribeToUser(7, response);
    publishToUser(7, {
      type: "withdrawal",
      title: "Paid",
      body: "Your transfer is paid.",
    });
    expect(writes).toHaveLength(1);
    unsubscribe();
    publishToUser(7, {
      type: "task",
      title: "New task",
      body: "A new task is ready.",
    });
    expect(writes).toHaveLength(1);
  });
});

describe("Orbit profile history and admin trends", () => {
  it("exposes a protected withdrawal history for the authenticated user", async () => {
    const caller = appRouter.createCaller(context("user"));
    const result = await caller.orbit.withdrawals();
    expect(Array.isArray(result)).toBe(true);
    if (result[0]) expect(result[0]).toHaveProperty("status");
  });

  it("keeps trend analytics behind the admin procedure", async () => {
    const admin = appRouter.createCaller(context("admin"));
    const trends = await admin.orbit.admin.trends();
    expect(trends).toHaveLength(7);
    expect(trends[0]).toHaveProperty("withdrawals");
    await expect(
      appRouter.createCaller(context("user")).orbit.admin.trends()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("Orbit withdrawal details", () => {
  it("lets the owner see withdrawal and audit while another user cannot", async () => {
    const restore = setWithdrawalDetailsProviderForTests(async () => ({
      withdrawal: {
        id: 502,
        userId: 7,
        amount: 6000,
        method: "PayPal",
        destination: "owner@example.com",
        status: "pending",
        createdAt: new Date("2026-01-04T10:00:00Z"),
      },
      audit: [
        {
          id: 1,
          action: "withdrawal.created",
          createdAt: "2026-01-04T10:00:00Z",
        },
      ],
    }));
    try {
      const ownerResult = await appRouter
        .createCaller(context("user", 7))
        .orbit.withdrawalDetails({ id: 502 });
      const otherResult = await appRouter
        .createCaller(context("user", 8))
        .orbit.withdrawalDetails({ id: 502 });
      expect(ownerResult?.withdrawal.userId).toBe(7);
      expect(ownerResult?.audit).toHaveLength(1);
      expect(otherResult).toBeUndefined();
    } finally {
      restore();
    }
  });
  it("isolates ownership while allowing admins to view the record", () => {
    expect(canViewWithdrawal(7, 7, false)).toBe(true);
    expect(canViewWithdrawal(7, 8, false)).toBe(false);
    expect(canViewWithdrawal(7, 8, true)).toBe(true);
  });

  it("orders the audit trail from newest to oldest", () => {
    const ordered = sortWithdrawalAudit([
      { createdAt: "2026-01-01T10:00:00Z" },
      { createdAt: "2026-01-03T10:00:00Z" },
      { createdAt: "2026-01-02T10:00:00Z" },
    ]);
    expect(ordered.map(item => item.createdAt)).toEqual([
      "2026-01-03T10:00:00Z",
      "2026-01-02T10:00:00Z",
      "2026-01-01T10:00:00Z",
    ]);
  });
  it("isolates another user's withdrawal while allowing admin access", async () => {
    const restore = setWithdrawalDetailsProviderForTests(
      async (_viewerId, id, isAdmin) => {
        if (id !== 500) return undefined;
        return {
          withdrawal: {
            id: 500,
            userId: 42,
            amount: 7000,
            method: "PayPal",
            destination: "owner@example.com",
            status: "approved",
            createdAt: new Date("2026-01-01T10:00:00Z"),
          },
          audit: [],
        };
      }
    );
    try {
      await expect(
        appRouter
          .createCaller(context("user"))
          .orbit.withdrawalDetails({ id: 500 })
      ).resolves.toBeUndefined();
      await expect(
        appRouter
          .createCaller(context("admin"))
          .orbit.withdrawalDetails({ id: 500 })
      ).resolves.toMatchObject({ withdrawal: { userId: 42 } });
    } finally {
      restore();
    }
  });

  it("returns withdrawal details with newest audit event first", async () => {
    const restore = setWithdrawalDetailsProviderForTests(async () => ({
      withdrawal: {
        id: 501,
        userId: 7,
        amount: 8000,
        method: "PayPal",
        destination: "test@example.com",
        status: "paid",
        createdAt: new Date("2026-01-01T10:00:00Z"),
      },
      audit: [
        {
          id: 1,
          action: "withdrawal.created",
          createdAt: "2026-01-01T10:00:00Z",
        },
        { id: 2, action: "withdrawal.paid", createdAt: "2026-01-03T10:00:00Z" },
      ],
    }));
    try {
      const result = await appRouter
        .createCaller(context("user"))
        .orbit.withdrawalDetails({ id: 501 });
      expect(result?.withdrawal).toHaveProperty("amount", 8000);
      expect(result?.audit.map(event => event.action)).toEqual([
        "withdrawal.paid",
        "withdrawal.created",
      ]);
    } finally {
      restore();
    }
  });

  it("exposes a protected detail query without leaking unknown withdrawals", async () => {
    const user = appRouter.createCaller(context("user"));
    const admin = appRouter.createCaller(context("admin"));
    await expect(
      user.orbit.withdrawalDetails({ id: 999999 })
    ).resolves.toBeUndefined();
    await expect(
      admin.orbit.withdrawalDetails({ id: 999999 })
    ).resolves.toBeUndefined();
  });

  it("requires authentication for withdrawal details", async () => {
    const anonymous = appRouter.createCaller({
      ...context("user"),
      user: null,
    });
    await expect(
      anonymous.orbit.withdrawalDetails({ id: 101 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("Orbit KYC safeguards", () => {
  it("keeps KYC queue and review actions restricted to administrators", async () => {
    const user = appRouter.createCaller(context("user"));
    await expect(user.orbit.admin.kycRequests()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      user.orbit.admin.requestKyc({ userId: 987654321 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      user.orbit.admin.reviewKyc({ id: 1, status: "approved" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps a user's KYC status isolated and prevents duplicate active requests", async () => {
    const targetUserId = Number(`8${Date.now().toString().slice(-8)}`);
    const admin = appRouter.createCaller(context("admin", 7));
    const created = await admin.orbit.admin.requestKyc({
      userId: targetUserId,
      reason: "KYC test request",
    });
    await expect(
      admin.orbit.admin.requestKyc({ userId: targetUserId })
    ).rejects.toThrow("active KYC request");

    const ownerStatus = await appRouter
      .createCaller(context("user", targetUserId))
      .orbit.kycStatus();
    const otherStatus = await appRouter
      .createCaller(context("user", targetUserId + 1))
      .orbit.kycStatus();
    expect(ownerStatus?.id).toBe(created.id);
    expect(otherStatus?.id).not.toBe(created.id);
    expect((await getKycStatus(targetUserId))?.userId).toBe(targetUserId);
  });

  it("requires user submission before an administrator can review KYC", async () => {
    const targetUserId = Number(`7${Date.now().toString().slice(-8)}`);
    const admin = appRouter.createCaller(context("admin", 7));
    const created = await admin.orbit.admin.requestKyc({
      userId: targetUserId,
    });
    await expect(
      admin.orbit.admin.reviewKyc({ id: created.id, status: "approved" })
    ).rejects.toThrow("not ready for review");

    await appRouter
      .createCaller(context("user", targetUserId))
      .orbit.submitKyc({ id: created.id });
    await expect(
      admin.orbit.admin.reviewKyc({ id: created.id, status: "approved" })
    ).rejects.toThrow("not ready for review");
    await admin.orbit.admin.reviewKyc({
      id: created.id,
      status: "under_review",
    });
    await admin.orbit.admin.reviewKyc({ id: created.id, status: "approved" });
    expect((await getKycStatus(targetUserId))?.status).toBe("approved");
  });
});

describe("Orbit in-app policy content", () => {
  it("includes the visible usage, payout, KYC, and privacy policy sections", () => {
    expect(ORBIT_POLICY_NOTICE).toContain("qualified counsel");
    expect(ORBIT_POLICY_SECTIONS.map(section => section.title)).toEqual([
      "Responsible use",
      "Points and cash-outs",
      "Identity verification",
      "Privacy and account data",
      "Updates and contact",
    ]);
    expect(ORBIT_POLICY_SECTIONS[2].body).toContain("not self-service");
  });
});

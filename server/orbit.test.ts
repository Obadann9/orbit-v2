import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { createWithdrawal } from "./db";
import type { TrpcContext } from "./_core/context";

function context(role: "user" | "admin" = "user"): TrpcContext {
  return {
    user: { id: 7, openId: "orbit-test", name: "Orbit Test", email: "test@orbit.app", loginMethod: "test", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => undefined } as TrpcContext["res"],
  };
}

describe("Orbit financial safeguards", () => {
  it("rejects cash-out requests below the minimum threshold", async () => {
    await expect(createWithdrawal(7, 4999, "test@orbit.app")).rejects.toThrow("Minimum withdrawal");
  });

  it("does not expose admin stats to regular users", async () => {
    const caller = appRouter.createCaller(context("user"));
    await expect(caller.orbit.admin.stats()).rejects.toMatchObject({ code: "FORBIDDEN" });
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
    const result = await caller.orbit.admin.withdrawals({ status: "pending", minAmount: 5000 });
    expect(Array.isArray(result)).toBe(true);
    await expect(appRouter.createCaller(context("user")).orbit.admin.withdrawals({ status: "pending" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});


describe("Orbit withdrawal event filters", () => {
  it("accepts date-range filters and paid review input for admins", async () => {
    const caller = appRouter.createCaller(context("admin"));
    const result = await caller.orbit.admin.withdrawals({ from: Date.now() - 86400000, to: Date.now() });
    expect(Array.isArray(result)).toBe(true);
    await expect(caller.orbit.admin.reviewWithdrawal({ id: 999999, status: "paid" })).rejects.toBeDefined();
  });
});

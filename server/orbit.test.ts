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

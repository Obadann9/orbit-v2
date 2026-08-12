import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { attachReferral, claimTask, createWithdrawal, getAdminStats, getAdminUsers, getLedger, getProviders, getReferral, getTasks, getWallet, getWithdrawals, reviewWithdrawal, setUserRole, spendPoints, transferPoints } from "./db";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => { ctx.res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(ctx.req), maxAge: -1 }); return { success: true } as const; }),
  }),
  orbit: router({
    wallet: protectedProcedure.query(({ ctx }) => getWallet(ctx.user.id)),
    ledger: protectedProcedure.query(({ ctx }) => getLedger(ctx.user.id)),
    tasks: protectedProcedure.query(({ ctx }) => getTasks(ctx.user.id)),
    providers: protectedProcedure.query(() => getProviders()),
    claimTask: protectedProcedure.input(z.object({ taskId: z.number().int().positive() })).mutation(({ ctx, input }) => claimTask(ctx.user.id, input.taskId)),
    withdraw: protectedProcedure.input(z.object({ amount: z.number().int().positive(), destination: z.string().email() })).mutation(({ ctx, input }) => createWithdrawal(ctx.user.id, input.amount, input.destination)),
    spend: protectedProcedure.input(z.object({ amount: z.number().int().positive(), description: z.string().min(1).max(255) })).mutation(({ ctx, input }) => spendPoints(ctx.user.id, input.amount, input.description)),
    transfer: protectedProcedure.input(z.object({ recipientId: z.number().int().positive(), amount: z.number().int().positive() })).mutation(({ ctx, input }) => transferPoints(ctx.user.id, input.recipientId, input.amount)),
    referral: protectedProcedure.query(({ ctx }) => getReferral(ctx.user.id)),
    attachReferral: protectedProcedure.input(z.object({ code: z.string().min(2).max(32) })).mutation(({ ctx, input }) => attachReferral(ctx.user.id, input.code)),
    admin: router({
      stats: adminProcedure.query(() => getAdminStats()),
      withdrawals: adminProcedure.query(() => getWithdrawals()),
      users: adminProcedure.query(() => getAdminUsers()),
      setUserRole: adminProcedure.input(z.object({ userId: z.number().int().positive(), role: z.enum(["user", "admin"]) })).mutation(({ ctx, input }) => setUserRole(ctx.user.id, input.userId, input.role)),
      reviewWithdrawal: adminProcedure.input(z.object({ id: z.number().int().positive(), status: z.enum(["approved", "rejected"]) })).mutation(({ ctx, input }) => reviewWithdrawal(ctx.user.id, input.id, input.status)),
    }),
  }),
});

export type AppRouter = typeof appRouter;

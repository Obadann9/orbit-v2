import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import {
  adminProcedure,
  protectedProcedure,
  publicProcedure,
  router,
} from "./_core/trpc";
import {
  activateTask,
  attachReferral,
  claimTask,
  createWithdrawal,
  getAdminStats,
  getAdminTrends,
  getAdminUsers,
  getLedger,
  getNotificationPreferences,
  getNotifications,
  getProviders,
  getReferral,
  getTasks,
  getUserWithdrawals,
  getWithdrawalDetails,
  getWallet,
  getWithdrawals,
  markNotificationRead,
  reviewWithdrawal,
  updateNotificationPreferences,
  setUserRole,
  spendPoints,
  transferPoints,
} from "./db";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      ctx.res.clearCookie(COOKIE_NAME, {
        ...getSessionCookieOptions(ctx.req),
        maxAge: -1,
      });
      return { success: true } as const;
    }),
  }),
  orbit: router({
    wallet: protectedProcedure.query(({ ctx }) => getWallet(ctx.user.id)),
    ledger: protectedProcedure.query(({ ctx }) => getLedger(ctx.user.id)),
    withdrawals: protectedProcedure.query(({ ctx }) =>
      getUserWithdrawals(ctx.user.id)
    ),
    withdrawalDetails: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(({ ctx, input }) =>
        getWithdrawalDetails(ctx.user.id, input.id, ctx.user.role === "admin")
      ),
    tasks: protectedProcedure.query(({ ctx }) => getTasks(ctx.user.id)),
    providers: protectedProcedure.query(() => getProviders()),
    claimTask: protectedProcedure
      .input(z.object({ taskId: z.number().int().positive() }))
      .mutation(({ ctx, input }) => claimTask(ctx.user.id, input.taskId)),
    withdraw: protectedProcedure
      .input(
        z.object({
          amount: z.number().int().positive(),
          destination: z.string().email(),
        })
      )
      .mutation(({ ctx, input }) =>
        createWithdrawal(ctx.user.id, input.amount, input.destination)
      ),
    spend: protectedProcedure
      .input(
        z.object({
          amount: z.number().int().positive(),
          description: z.string().min(1).max(255),
        })
      )
      .mutation(({ ctx, input }) =>
        spendPoints(ctx.user.id, input.amount, input.description)
      ),
    transfer: protectedProcedure
      .input(
        z.object({
          recipientId: z.number().int().positive(),
          amount: z.number().int().positive(),
        })
      )
      .mutation(({ ctx, input }) =>
        transferPoints(ctx.user.id, input.recipientId, input.amount)
      ),
    referral: protectedProcedure.query(({ ctx }) => getReferral(ctx.user.id)),
    attachReferral: protectedProcedure
      .input(z.object({ code: z.string().min(2).max(32) }))
      .mutation(({ ctx, input }) => attachReferral(ctx.user.id, input.code)),
    notifications: protectedProcedure.query(({ ctx }) =>
      getNotifications(ctx.user.id)
    ),
    notificationPreferences: protectedProcedure.query(({ ctx }) =>
      getNotificationPreferences(ctx.user.id)
    ),
    updateNotificationPreferences: protectedProcedure
      .input(
        z.object({
          tasks: z.boolean(),
          withdrawals: z.boolean(),
          system: z.boolean(),
        })
      )
      .mutation(({ ctx, input }) =>
        updateNotificationPreferences(ctx.user.id, input)
      ),
    markNotificationRead: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(({ ctx, input }) =>
        markNotificationRead(ctx.user.id, input.id)
      ),
    admin: router({
      stats: adminProcedure.query(() => getAdminStats()),
      trends: adminProcedure.query(() => getAdminTrends()),
      activateTask: adminProcedure
        .input(
          z.object({
            taskId: z.number().int().positive(),
            enabled: z.boolean(),
          })
        )
        .mutation(({ ctx, input }) =>
          activateTask(ctx.user.id, input.taskId, input.enabled)
        ),
      withdrawals: adminProcedure
        .input(
          z
            .object({
              status: z
                .enum(["pending", "approved", "rejected", "paid"])
                .optional(),
              method: z.string().optional(),
              minAmount: z.number().int().optional(),
              maxAmount: z.number().int().optional(),
              from: z.number().int().optional(),
              to: z.number().int().optional(),
              page: z.number().int().optional(),
              pageSize: z.number().int().optional(),
              sortBy: z.enum(["createdAt", "amount", "status"]).optional(),
              sortDir: z.enum(["asc", "desc"]).optional(),
            })
            .optional()
        )
        .query(({ input }) => getWithdrawals(input)),
      users: adminProcedure.query(() => getAdminUsers()),
      setUserRole: adminProcedure
        .input(
          z.object({
            userId: z.number().int().positive(),
            role: z.enum(["user", "admin"]),
          })
        )
        .mutation(({ ctx, input }) =>
          setUserRole(ctx.user.id, input.userId, input.role)
        ),
      reviewWithdrawal: adminProcedure
        .input(
          z.object({
            id: z.number().int().positive(),
            status: z.enum(["approved", "rejected", "paid"]),
          })
        )
        .mutation(({ ctx, input }) =>
          reviewWithdrawal(ctx.user.id, input.id, input.status)
        ),
    }),
  }),
});

export type AppRouter = typeof appRouter;

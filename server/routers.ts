import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
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
  getKycRequests,
  getKycStatus,
  getLedger,
  getNotificationPreferences,
  getNotifications,
  getOfferwallProviderSettings,
  getProviders,
  getReferral,
  getTasks,
  getUserWithdrawals,
  getWithdrawalDetails,
  getWallet,
  getWithdrawals,
  markNotificationRead,
  reviewWithdrawal,
  requestKyc,
  reviewKyc,
  saveOfferwallProviderSettings,
  submitKyc,
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
    kycStatus: protectedProcedure.query(({ ctx }) => getKycStatus(ctx.user.id)),
    submitKyc: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(({ ctx, input }) => submitKyc(ctx.user.id, input.id)),
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
      .mutation(() => {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Point transfers are temporarily disabled for fraud prevention",
        });
      }),
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
      offerwallProviders: adminProcedure.query(() =>
        getOfferwallProviderSettings()
      ),
      saveOfferwallProvider: adminProcedure
        .input(
          z.object({
            id: z.number().int().positive().optional(),
            name: z.string().min(1).max(80),
            mark: z.string().min(1).max(12),
            wallUrl: z.string().url().max(2000),
            enabled: z.boolean(),
            sortOrder: z.number().int().min(0).max(999),
            providerKey: z
              .string()
              .regex(/^[a-z0-9][a-z0-9_-]{1,62}$/)
              .max(64),
            secretEnvKey: z
              .string()
              .regex(/^[A-Z][A-Z0-9_]{2,127}$/)
              .max(128),
            signatureMode: z.enum(["hmac_body", "hmac_query"]),
            signatureHeader: z.string().min(1).max(80),
            signatureField: z.string().min(1).max(80),
            transactionIdField: z.string().min(1).max(80),
            userIdField: z.string().min(1).max(80),
            amountField: z.string().min(1).max(80),
            offerNameField: z.string().min(1).max(80),
            allowedIps: z.string().max(2000).optional(),
          })
        )
        .mutation(({ input }) => saveOfferwallProviderSettings(input)),
      kycRequests: adminProcedure
        .input(
          z
            .object({
              status: z
                .enum([
                  "requested",
                  "submitted",
                  "under_review",
                  "approved",
                  "rejected",
                ])
                .optional(),
            })
            .optional()
        )
        .query(({ input }) => getKycRequests(input?.status)),
      requestKyc: adminProcedure
        .input(
          z.object({
            userId: z.number().int().positive(),
            reason: z.string().max(255).optional(),
          })
        )
        .mutation(({ ctx, input }) =>
          requestKyc(ctx.user.id, input.userId, input.reason)
        ),
      reviewKyc: adminProcedure
        .input(
          z.object({
            id: z.number().int().positive(),
            status: z.enum(["under_review", "approved", "rejected"]),
            reviewerNote: z.string().max(500).optional(),
          })
        )
        .mutation(({ ctx, input }) =>
          reviewKyc(ctx.user.id, input.id, input.status, input.reviewerNote)
        ),
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

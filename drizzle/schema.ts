import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  notifyTasks: int("notifyTasks").default(1).notNull(),
  notifyWithdrawals: int("notifyWithdrawals").default(1).notNull(),
  notifySystem: int("notifySystem").default(1).notNull(),
});

export const wallets = mysqlTable("wallets", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  balance: int("balance").default(0).notNull(),
  lifetimeEarned: int("lifetimeEarned").default(0).notNull(),
  lifetimeWithdrawn: int("lifetimeWithdrawn").default(0).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const ledgerEntries = mysqlTable(
  "ledgerEntries",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    kind: mysqlEnum("kind", [
      "earn",
      "spend",
      "transfer_in",
      "transfer_out",
      "withdrawal_hold",
      "withdrawal_release",
      "withdrawal_paid",
    ]).notNull(),
    amount: int("amount").notNull(),
    balanceAfter: int("balanceAfter").notNull(),
    referenceType: varchar("referenceType", { length: 64 }),
    referenceId: varchar("referenceId", { length: 128 }),
    description: varchar("description", { length: 255 }),
    idempotencyKey: varchar("idempotencyKey", { length: 191 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    idempotencyIdx: uniqueIndex("ledger_idempotency_idx").on(
      table.userId,
      table.idempotencyKey
    ),
  })
);

export const tasks = mysqlTable("tasks", {
  id: int("id").autoincrement().primaryKey(),
  type: varchar("type", { length: 32 }).notNull(),
  title: varchar("title", { length: 160 }).notNull(),
  description: varchar("description", { length: 255 }),
  reward: int("reward").notNull(),
  enabled: int("enabled").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const taskClaims = mysqlTable(
  "taskClaims",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    taskId: int("taskId").notNull(),
    claimDate: varchar("claimDate", { length: 10 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    claimIdx: uniqueIndex("task_claim_idx").on(
      table.userId,
      table.taskId,
      table.claimDate
    ),
  })
);

export const offerProviders = mysqlTable(
  "offerProviders",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 80 }).notNull(),
    mark: varchar("mark", { length: 12 }).notNull(),
    wallUrl: text("wallUrl").notNull(),
    enabled: int("enabled").default(1).notNull(),
    sortOrder: int("sortOrder").default(0).notNull(),
    providerKey: varchar("providerKey", { length: 64 }),
    secretEnvKey: varchar("secretEnvKey", { length: 128 }),
    signatureMode: mysqlEnum("signatureMode", ["hmac_body", "hmac_query"])
      .default("hmac_body")
      .notNull(),
    signatureHeader: varchar("signatureHeader", { length: 80 })
      .default("x-orbit-signature")
      .notNull(),
    signatureField: varchar("signatureField", { length: 80 })
      .default("signature")
      .notNull(),
    transactionIdField: varchar("transactionIdField", { length: 80 })
      .default("transactionId")
      .notNull(),
    userIdField: varchar("userIdField", { length: 80 })
      .default("userId")
      .notNull(),
    amountField: varchar("amountField", { length: 80 })
      .default("amount")
      .notNull(),
    offerNameField: varchar("offerNameField", { length: 80 })
      .default("offerName")
      .notNull(),
    allowedIps: text("allowedIps"),
  },
  table => ({
    providerKeyIdx: uniqueIndex("offer_provider_key_idx").on(table.providerKey),
  })
);

export const offerwallPostbacks = mysqlTable(
  "offerwallPostbacks",
  {
    id: int("id").autoincrement().primaryKey(),
    providerId: int("providerId").notNull(),
    providerTransactionId: varchar("providerTransactionId", {
      length: 191,
    }).notNull(),
    userId: int("userId").notNull(),
    amount: int("amount").notNull(),
    offerName: varchar("offerName", { length: 255 }),
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    processedAt: timestamp("processedAt").defaultNow().notNull(),
  },
  table => ({
    providerTransactionIdx: uniqueIndex(
      "offerwall_provider_transaction_idx"
    ).on(table.providerId, table.providerTransactionId),
  })
);

export const withdrawals = mysqlTable("withdrawals", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  amount: int("amount").notNull(),
  method: varchar("method", { length: 32 }).notNull(),
  destination: varchar("destination", { length: 255 }).notNull(),
  status: mysqlEnum("status", ["pending", "approved", "rejected", "paid"])
    .default("pending")
    .notNull(),
  reviewedBy: int("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const referrals = mysqlTable("referrals", {
  id: int("id").autoincrement().primaryKey(),
  referrerId: int("referrerId").notNull(),
  referredId: int("referredId").notNull().unique(),
  code: varchar("code", { length: 32 }).notNull(),
  bonus: int("bonus").default(250).notNull(),
  status: mysqlEnum("status", ["pending", "awarded"])
    .default("pending")
    .notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  awardedAt: timestamp("awardedAt"),
});

export const auditEvents = mysqlTable("auditEvents", {
  id: int("id").autoincrement().primaryKey(),
  actorUserId: int("actorUserId"),
  action: varchar("action", { length: 80 }).notNull(),
  entityType: varchar("entityType", { length: 80 }).notNull(),
  entityId: varchar("entityId", { length: 128 }),
  metadata: text("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const kycRequests = mysqlTable("kycRequests", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  requestedBy: int("requestedBy").notNull(),
  status: mysqlEnum("status", [
    "requested",
    "submitted",
    "under_review",
    "approved",
    "rejected",
  ])
    .default("requested")
    .notNull(),
  reason: varchar("reason", { length: 255 }),
  reviewerNote: varchar("reviewerNote", { length: 500 }),
  requestedAt: timestamp("requestedAt").defaultNow().notNull(),
  submittedAt: timestamp("submittedAt"),
  reviewedAt: timestamp("reviewedAt"),
  reviewedBy: int("reviewedBy"),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Wallet = typeof wallets.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type OfferProvider = typeof offerProviders.$inferSelect;
export type OfferwallPostback = typeof offerwallPostbacks.$inferSelect;
export type Withdrawal = typeof withdrawals.$inferSelect;
export type Referral = typeof referrals.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type KycRequest = typeof kycRequests.$inferSelect;

export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  type: mysqlEnum("type", ["task", "withdrawal", "system"]).notNull(),
  title: varchar("title", { length: 160 }).notNull(),
  body: varchar("body", { length: 255 }).notNull(),
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Notification = typeof notifications.$inferSelect;

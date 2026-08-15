import React, { useEffect, useMemo, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useAuth } from "./_core/hooks/useAuth";
import { startLogin } from "./const";
import { trpc } from "./lib/trpc";
import WithdrawalDetails from "./components/WithdrawalDetails";
import { ORBIT_POLICY_NOTICE, ORBIT_POLICY_SECTIONS } from "./policyContent";
import {
  ArrowUpRight,
  Bell,
  Check,
  ChevronRight,
  CircleHelp,
  Copy,
  ExternalLink,
  FileText,
  Fingerprint,
  LogOut,
  Menu,
  ShieldCheck,
  Sparkles,
  WalletCards,
  X,
} from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";

const demoWallet = {
  balance: 1840,
  lifetimeEarned: 12840,
  lifetimeWithdrawn: 11000,
};
const demoLedger = [
  {
    id: 1,
    kind: "earn",
    amount: 500,
    description: "Daily check-in",
    createdAt: new Date(Date.now() - 86400000),
  },
  {
    id: 2,
    kind: "earn",
    amount: 1200,
    description: "Survey completed",
    createdAt: new Date(Date.now() - 172800000),
  },
  {
    id: 3,
    kind: "withdrawal_paid",
    amount: -5000,
    description: "PayPal withdrawal",
    createdAt: new Date(Date.now() - 604800000),
  },
];
const demoTasks = [
  {
    id: 1,
    type: "DAILY",
    title: "Check in today",
    description: "Keep your streak alive",
    reward: 500,
    claimed: false,
  },
  {
    id: 2,
    type: "SURVEY",
    title: "Complete a quick survey",
    description: "Tell us what you think",
    reward: 1200,
    claimed: false,
  },
  {
    id: 3,
    type: "REFERRAL",
    title: "Invite a friend",
    description: "Earn when they complete a task",
    reward: 2500,
    claimed: false,
  },
];
const demoProviders = [
  {
    id: 1,
    name: "Playtime",
    mark: "P",
    wallUrl: "https://example.com/offerwall/playtime",
  },
  {
    id: 2,
    name: "AdGate",
    mark: "A",
    wallUrl: "https://example.com/offerwall/adgate",
  },
  {
    id: 3,
    name: "Torox",
    mark: "T",
    wallUrl: "https://example.com/offerwall/torox",
  },
  {
    id: 4,
    name: "AyeT",
    mark: "Y",
    wallUrl: "https://example.com/offerwall/ayet",
  },
];

type Tab = "Rewards" | "Wallet" | "Me" | "Admin";
const money = (coins: number) => `$${(coins / 1000).toFixed(2)}`;
const dateLabel = (date: Date | string) =>
  new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

function Welcome({ onLogin }: { onLogin: () => void }) {
  return (
    <main className="welcome-shell">
      <div className="welcome-mark">
        <span className="orbit-planet" />
        <span className="orbit-ring" />
      </div>
      <div className="brand-lockup">
        <span>ORBIT</span>
        <small>REWARDS IN MOTION</small>
      </div>
      <h1>
        Small moves.
        <br />
        <em>Real rewards.</em>
      </h1>
      <p>
        Earn points through simple tasks, offers, and referrals. Keep everything
        in one calm, clear wallet.
      </p>
      <button className="primary-button wide" onClick={onLogin}>
        Get started <ArrowUpRight size={17} />
      </button>
      <button className="text-button" onClick={onLogin}>
        I have an account
      </button>
      <div className="welcome-foot">
        <span className="status-dot" /> SERVER-AUTHORITATIVE REWARDS
      </div>
    </main>
  );
}

function BalanceOrbit({ balance }: { balance: number }) {
  return (
    <div className="balance-orbit">
      <div className="balance-glow" />
      <div className="balance-planet" />
      <div className="balance-ring ring-one" />
      <div className="balance-ring ring-two" />
      <div className="balance-value">
        <small>AVAILABLE</small>
        <strong>{balance.toLocaleString()}</strong>
        <span>POINTS</span>
      </div>
    </div>
  );
}

function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const seenIds = useRef(new Set<number>());
  const notifications = trpc.orbit.notifications.useQuery(undefined, {
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    if (!notifications.data) return;
    const fresh = notifications.data.filter(
      item => !seenIds.current.has(item.id)
    );
    if (seenIds.current.size > 0)
      fresh.slice(0, 3).forEach(item => toast.info(item.title));
    notifications.data.forEach(item => seenIds.current.add(item.id));
  }, [notifications.data]);
  useEffect(() => {
    const stream = new EventSource("/api/realtime/notifications");
    stream.onmessage = event => {
      try {
        const item = JSON.parse(event.data);
        if (item.id) seenIds.current.add(item.id);
        toast.info(item.title);
        notifications.refetch();
      } catch {
        // Keep the polling fallback active for malformed events.
      }
    };
    stream.onerror = () => stream.close();
    return () => stream.close();
  }, [notifications.refetch]);
  const markRead = trpc.orbit.markNotificationRead.useMutation({
    onSuccess: () => notifications.refetch(),
  });
  const unread = (notifications.data || []).filter(
    (item: any) => !item.readAt
  ).length;
  return (
    <div className="notification-center">
      <button
        className={`icon-button notification-button ${unread ? "has-unread" : ""}`}
        onClick={() => setOpen(value => !value)}
        aria-label="Notifications"
      >
        <Bell size={17} />
        {unread > 0 && <span>{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="notification-popover">
          <div className="notification-popover-head">
            <span className="eyebrow">INBOX</span>
            <strong>Notifications</strong>
          </div>
          {(notifications.data || []).map((item: any) => (
            <button
              className={`notification-item ${item.readAt ? "read" : ""}`}
              key={item.id}
              onClick={() => !item.readAt && markRead.mutate({ id: item.id })}
            >
              <span className={`notification-dot ${item.type}`} />
              <span>
                <strong>{item.title}</strong>
                <small>{item.body}</small>
              </span>
            </button>
          ))}
          {!notifications.data?.length && (
            <p className="notification-empty">You are all caught up.</p>
          )}
        </div>
      )}
    </div>
  );
}

function OfferSheet({ provider, close }: { provider: any; close: () => void }) {
  const [frameState, setFrameState] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  return (
    <div className="sheet-backdrop" onClick={close}>
      <section className="offer-sheet" onClick={e => e.stopPropagation()}>
        <div className="drag-handle" />
        <header className="sheet-header">
          <div>
            <span className="eyebrow">NETWORK WALL</span>
            <h2>{provider.name}</h2>
          </div>
          <button className="icon-button" onClick={close} aria-label="Close">
            <X size={19} />
          </button>
        </header>
        <div className="webview-frame">
          <div className="webview-top">
            <span className="provider-mark small">{provider.mark}</span>
            <span>{provider.name.toUpperCase()} OFFERS</span>
            <span className="webview-lock">SECURE</span>
          </div>
          <div className="webview-body">
            {frameState === "loading" && (
              <div className="iframe-status">
                <Sparkles size={18} /> Loading hosted wall…
              </div>
            )}
            {frameState !== "error" && (
              <iframe
                src={provider.wallUrl}
                title={`${provider.name} offerwall`}
                className="offerwall-iframe"
                loading="lazy"
                onLoad={() => setFrameState("ready")}
                onError={() => setFrameState("error")}
              />
            )}
            {frameState === "error" && (
              <div className="iframe-status">
                <Sparkles size={18} />
                <span>Hosted wall unavailable.</span>
                <a href={provider.wallUrl} target="_blank" rel="noreferrer">
                  Open in new tab <ExternalLink size={14} />
                </a>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function Rewards({
  onOpenProvider,
  balance,
  isAuthed,
  referral,
}: {
  onOpenProvider: (provider: any) => void;
  balance: number;
  isAuthed: boolean;
  referral: any;
}) {
  const providersQuery = trpc.orbit.providers.useQuery(undefined, {
    enabled: isAuthed,
  });
  const tasksQuery = trpc.orbit.tasks.useQuery(undefined, {
    enabled: isAuthed,
  });
  const [claimFlash, setClaimFlash] = useState<number | null>(null);
  const orbitUtils = trpc.useUtils();
  const claim = trpc.orbit.claimTask.useMutation({
    onSuccess: d => {
      orbitUtils.orbit.wallet.invalidate();
      setClaimFlash(d.amount);
      toast.success(`+${d.amount.toLocaleString()} points added`);
      window.setTimeout(() => setClaimFlash(null), 900);
    },
    onError: e => toast.error(e.message),
  });
  const providers = providersQuery.data?.length
    ? providersQuery.data
    : demoProviders;
  const tasks = tasksQuery.data?.length ? tasksQuery.data : demoTasks;
  return (
    <div className="page-content">
      <section className={`page-intro ${claimFlash ? "reward-confirmed" : ""}`}>
        <div>
          <span className="eyebrow">REWARDS / 01</span>
          <h1>Make your move.</h1>
          <p>Offers, tasks, and tiny wins that add up.</p>
        </div>
        <div className="mini-balance">
          <span>LIVE BALANCE</span>
          <strong>{balance.toLocaleString()}</strong>
        </div>
      </section>
      <section className="section-block">
        <div className="section-heading">
          <div>
            <span className="eyebrow">OFFERWALLS</span>
            <h2>Choose your orbit</h2>
          </div>
          <span className="section-count">{providers.length} NETWORKS</span>
        </div>
        <div className="provider-grid">
          {providers.map((provider: any) => (
            <button
              className="provider-card"
              key={provider.id}
              onClick={() => onOpenProvider(provider)}
            >
              <span className="provider-mark">{provider.mark}</span>
              <span className="provider-copy">
                <strong>{provider.name}</strong>
                <small>Browse offers</small>
              </span>
              <ChevronRight size={17} />
            </button>
          ))}
        </div>
      </section>
      <section className="section-block">
        <div className="section-heading">
          <div>
            <span className="eyebrow">MISSION LOG</span>
            <h2>Quick tasks</h2>
          </div>
          <span className="section-count">TODAY</span>
        </div>
        <div className="task-list">
          {tasks.map((task: any) => (
            <div
              className={`task-row ${task.claimed ? "is-done" : ""}`}
              key={task.id}
            >
              <span className="task-status">
                {task.claimed ? <Check size={13} /> : <span />}
              </span>
              <span className="task-copy">
                <span className="mono-tag">{task.type}</span>
                <strong>{task.title}</strong>
                <small>{task.description}</small>
              </span>
              <button
                className="reward-chip"
                disabled={task.claimed}
                onClick={() =>
                  isAuthed
                    ? claim.mutate({ taskId: task.id })
                    : toast.info("Sign in to claim tasks")
                }
              >
                {task.claimed ? "CLAIMED" : `+${task.reward.toLocaleString()}`}
              </button>
            </div>
          ))}
        </div>
      </section>
      <section className="referral-strip">
        <div>
          <span className="eyebrow">YOUR REFERRAL LINK</span>
          <strong>
            {referral?.link?.replace("https://", "") || "Referral link pending"}
          </strong>
        </div>
        <button
          className="icon-button"
          onClick={() => {
            navigator.clipboard?.writeText(referral?.link || "");
            toast.success("Referral link copied");
          }}
        >
          <Copy size={16} />
        </button>
      </section>
    </div>
  );
}

function Wallet({
  wallet,
  ledger,
  onWithdraw,
}: {
  wallet: any;
  ledger: any[];
  onWithdraw: () => void;
}) {
  return (
    <div className="page-content">
      <section className="wallet-hero">
        <span className="eyebrow">WALLET / 02</span>
        <div className="wallet-number">{wallet.balance.toLocaleString()}</div>
        <div className="wallet-label">
          AVAILABLE POINTS <span>≈ {money(wallet.balance)}</span>
        </div>
        <button className="primary-button" onClick={onWithdraw}>
          Cash out <ArrowUpRight size={16} />
        </button>
        <small className="fine-print">
          Minimum $5.00 · PayPal · Reviewed in 24h
        </small>
      </section>
      <section className="stats-row">
        <div>
          <span>TOTAL EARNED</span>
          <strong>{wallet.lifetimeEarned.toLocaleString()}</strong>
        </div>
        <div>
          <span>WITHDRAWN</span>
          <strong>{wallet.lifetimeWithdrawn.toLocaleString()}</strong>
        </div>
      </section>
      <section className="section-block">
        <div className="section-heading">
          <div>
            <span className="eyebrow">ACTIVITY</span>
            <h2>Ledger</h2>
          </div>
          <span className="section-count">VERIFIED</span>
        </div>
        <div className="ledger-list">
          {ledger.map((entry: any) => (
            <div className="ledger-row" key={entry.id}>
              <span
                className={`ledger-dot ${entry.amount > 0 ? "credit" : "debit"}`}
              />
              <span className="ledger-copy">
                <strong>{entry.description}</strong>
                <small>
                  {dateLabel(entry.createdAt)} ·{" "}
                  {entry.kind === "withdrawal_hold" ? "Pending" : "Completed"}
                </small>
              </span>
              <strong
                className={entry.amount > 0 ? "credit-text" : "debit-text"}
              >
                {entry.amount > 0 ? "+" : ""}
                {entry.amount.toLocaleString()}
              </strong>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function CashOut({ wallet, close }: { wallet: any; close: () => void }) {
  const [amount, setAmount] = useState(5000);
  const [email, setEmail] = useState("");
  const orbitUtils = trpc.useUtils();
  const withdraw = trpc.orbit.withdraw.useMutation({
    onSuccess: () => {
      orbitUtils.orbit.wallet.invalidate();
      orbitUtils.orbit.notifications.invalidate();
      toast.success("Cash-out request submitted");
      close();
    },
    onError: e => toast.error(e.message),
  });
  const valid =
    amount >= 5000 && amount <= wallet.balance && email.includes("@");
  return (
    <div className="modal-backdrop">
      <section className="cashout-modal">
        <header className="sheet-header">
          <div>
            <span className="eyebrow">WALLET ACTION</span>
            <h2>Cash out</h2>
          </div>
          <button className="icon-button" onClick={close}>
            <X size={19} />
          </button>
        </header>
        <p className="modal-copy">
          Move your points to PayPal. Every request is reviewed within 24 hours.
        </p>
        <div className="amount-display">
          <small>REQUEST AMOUNT</small>
          <strong>{money(amount)}</strong>
          <span>{amount.toLocaleString()} points</span>
        </div>
        <div className="preset-row">
          {[5000, 10000, wallet.balance].map(value => (
            <button
              key={value}
              className={amount === value ? "preset active" : "preset"}
              onClick={() => setAmount(value)}
            >
              {value === wallet.balance ? "MAX" : money(value)}
            </button>
          ))}
        </div>
        <label className="field-label">
          PAYPAL EMAIL
          <input
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            type="email"
          />
        </label>
        <button
          className="primary-button wide"
          disabled={!valid || withdraw.isPending}
          onClick={() => withdraw.mutate({ amount, destination: email })}
        >
          Request {money(amount)} <ArrowUpRight size={16} />
        </button>
        <small className="fine-print center">
          Minimum $5.00 · No fees · Hold-then-review protection
        </small>
      </section>
    </div>
  );
}

function UserWithdrawals({
  onOpenDetails,
}: {
  onOpenDetails: (id: number) => void;
}) {
  const withdrawals = trpc.orbit.withdrawals.useQuery();
  const rows = withdrawals.data || [];
  return (
    <section className="user-withdrawals section-block">
      <div className="section-heading">
        <div>
          <span className="eyebrow">CASH-OUT HISTORY</span>
          <h2>Your withdrawals</h2>
        </div>
        <span className="section-count">{rows.length} REQUESTS</span>
      </div>
      <div className="withdrawal-table">
        {rows.map((item: any) => (
          <button
            className="withdrawal-row withdrawal-detail-trigger"
            key={item.id}
            onClick={() => onOpenDetails(item.id)}
          >
            <div>
              <strong>{money(item.amount)}</strong>
              <small>
                {item.method} · {dateLabel(item.createdAt)}
              </small>
            </div>
            <span className={`pending-badge status-${item.status}`}>
              {item.status}
            </span>
            <ChevronRight size={16} />
          </button>
        ))}
        {!rows.length && (
          <p className="notification-empty">No withdrawals yet.</p>
        )}
      </div>
    </section>
  );
}

function NotificationSettings() {
  const prefs = trpc.orbit.notificationPreferences.useQuery();
  const utils = trpc.useUtils();
  const save = trpc.orbit.updateNotificationPreferences.useMutation({
    onSuccess: () => {
      utils.orbit.notificationPreferences.invalidate();
      toast.success("Notification settings saved");
    },
  });
  const values = prefs.data || { tasks: true, withdrawals: true, system: true };
  const toggle = (key: "tasks" | "withdrawals" | "system") =>
    save.mutate({ ...values, [key]: !values[key] });
  return (
    <section className="notification-settings" id="notification-settings">
      <div className="settings-label">NOTIFICATION SETTINGS</div>
      <p>Choose which updates appear in your Orbit inbox.</p>
      {(
        [
          ["tasks", "New tasks", "Daily missions and task completion"],
          [
            "withdrawals",
            "Withdrawals",
            "Submission, approval, rejection, and payment",
          ],
          [
            "system",
            "System updates",
            "Important account and platform notices",
          ],
        ] as const
      ).map(([key, title, description]) => (
        <button
          className="notification-setting-row"
          key={key}
          onClick={() => toggle(key)}
          disabled={save.isPending}
        >
          <span>
            <strong>{title}</strong>
            <small>{description}</small>
          </span>
          <span className={`toggle ${values[key] ? "on" : ""}`}>
            <i />
          </span>
        </button>
      ))}
    </section>
  );
}

const KYC_COPY: Record<string, { title: string; body: string; tone: string }> =
  {
    requested: {
      title: "Verification requested",
      body: "An administrator needs you to confirm that you are ready for secure identity verification.",
      tone: "requested",
    },
    submitted: {
      title: "Verification submitted",
      body: "Your request is in the review queue. We will notify you once there is an update.",
      tone: "submitted",
    },
    under_review: {
      title: "Under review",
      body: "An administrator is reviewing your identity-verification request.",
      tone: "under-review",
    },
    approved: {
      title: "Verification approved",
      body: "Your identity-verification review is complete.",
      tone: "approved",
    },
    rejected: {
      title: "Verification needs attention",
      body: "Review the administrator note below, then contact support if you need help.",
      tone: "rejected",
    },
  };

function KycStatusCard() {
  const status = trpc.orbit.kycStatus.useQuery();
  const utils = trpc.useUtils();
  const submit = trpc.orbit.submitKyc.useMutation({
    onSuccess: () => {
      utils.orbit.kycStatus.invalidate();
      toast.success("Verification submitted for review");
    },
    onError: error => toast.error(error.message),
  });
  if (status.isLoading) {
    return (
      <section className="kyc-status-card is-loading" aria-busy="true">
        <div className="kyc-status-icon">
          <Fingerprint size={21} />
        </div>
        <div className="kyc-status-copy">
          <span className="eyebrow">IDENTITY CHECK</span>
          <h2>Checking verification status</h2>
          <p>Your account status is being retrieved securely.</p>
        </div>
      </section>
    );
  }
  if (status.isError) {
    return (
      <section className="kyc-status-card is-error" role="alert">
        <div className="kyc-status-icon">
          <Fingerprint size={21} />
        </div>
        <div className="kyc-status-copy">
          <span className="eyebrow">IDENTITY CHECK</span>
          <h2>Status unavailable</h2>
          <p>We could not load your verification status. Try again shortly.</p>
          <button
            className="text-button kyc-retry"
            onClick={() => status.refetch()}
          >
            Retry status check
          </button>
        </div>
      </section>
    );
  }
  const request = status.data;
  const copy = request ? KYC_COPY[request.status] : undefined;
  return (
    <section className={`kyc-status-card ${copy?.tone || "idle"}`}>
      <div className="kyc-status-icon">
        <Fingerprint size={21} />
      </div>
      <div className="kyc-status-copy">
        <span className="eyebrow">IDENTITY CHECK</span>
        <h2>{copy?.title || "No verification requested"}</h2>
        <p>
          {copy?.body ||
            "KYC is only initiated by an Orbit administrator when it is required for an account action."}
        </p>
        {request?.reason && (
          <small className="kyc-note">Reason: {request.reason}</small>
        )}
        {request?.reviewerNote && (
          <small className="kyc-note">
            Review note: {request.reviewerNote}
          </small>
        )}
        {request?.status === "requested" && (
          <button
            className="primary-button kyc-submit"
            disabled={submit.isPending}
            onClick={() => submit.mutate({ id: request.id })}
          >
            {submit.isPending ? "Submitting…" : "Submit verification"}
            <ArrowUpRight size={15} />
          </button>
        )}
      </div>
      {request && (
        <span className={`kyc-pill ${copy?.tone}`}>
          {request.status.replace("_", " ")}
        </span>
      )}
    </section>
  );
}

function PolicySheet({ close }: { close: () => void }) {
  return (
    <div className="modal-backdrop policy-backdrop" onClick={close}>
      <section
        className="policy-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="policy-title"
        onClick={event => event.stopPropagation()}
      >
        <header className="sheet-header">
          <div>
            <span className="eyebrow">ORBIT POLICIES</span>
            <h2 id="policy-title">Usage & privacy</h2>
          </div>
          <button
            className="icon-button"
            onClick={close}
            aria-label="Close policies"
          >
            <X size={19} />
          </button>
        </header>
        <div className="policy-content">
          <p className="policy-intro">{ORBIT_POLICY_NOTICE}</p>
          {ORBIT_POLICY_SECTIONS.map(section => (
            <section key={section.title}>
              <h3>{section.title}</h3>
              <p>{section.body}</p>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}

export function PolicyAccess() {
  const [showPolicies, setShowPolicies] = useState(false);
  return (
    <>
      <button className="settings-row" onClick={() => setShowPolicies(true)}>
        <FileText size={17} />
        <span>
          Terms & policy<small>Usage, privacy, and KYC</small>
        </span>
        <ChevronRight size={16} />
      </button>
      {showPolicies && <PolicySheet close={() => setShowPolicies(false)} />}
    </>
  );
}

function Me({
  user,
  isAdmin,
  onAdmin,
  onLogout,
  referral,
  onInstall,
  wallet,
  onOpenWithdrawal,
}: {
  user: any;
  isAdmin: boolean;
  onAdmin: () => void;
  onLogout: () => void;
  referral: any;
  onInstall: () => void;
  wallet: any;
  onOpenWithdrawal: (id: number) => void;
}) {
  const initials = (user?.name || "Orbit User").slice(0, 2).toUpperCase();
  return (
    <div className="page-content">
      <section className="profile-head">
        <div className="avatar">{initials}</div>
        <div>
          <span className="eyebrow">ACCOUNT / 03</span>
          <h1>{user?.name || "Orbit User"}</h1>
          <p>{user?.email || "demo@orbit.app"}</p>
        </div>
      </section>
      <div className="profile-stats">
        <div>
          <strong>{(wallet?.lifetimeEarned || 0).toLocaleString()}</strong>
          <span>TOTAL EARNED</span>
        </div>
        <div>
          <strong>{(wallet?.lifetimeWithdrawn || 0).toLocaleString()}</strong>
          <span>WITHDRAWN</span>
        </div>
        <div>
          <strong>—</strong>
          <span>DAY STREAK</span>
        </div>
      </div>
      <KycStatusCard />
      <section className="settings-list">
        <div className="settings-label">ACCOUNT</div>
        <button className="settings-row">
          <WalletCards size={17} />
          <span>
            Payout method<small>PayPal · Not set</small>
          </span>
          <ChevronRight size={16} />
        </button>
        <button
          className="settings-row"
          onClick={() =>
            document
              .getElementById("notification-settings")
              ?.scrollIntoView({ behavior: "smooth" })
          }
        >
          <Menu size={17} />
          <span>
            Notifications<small>Task and payout updates</small>
          </span>
          <ChevronRight size={16} />
        </button>
        <PolicyAccess />
        {isAdmin && (
          <button className="settings-row admin-row" onClick={onAdmin}>
            <ShieldCheck size={17} />
            <span>
              Admin console<small>Owner-only oversight</small>
            </span>
            <ChevronRight size={16} />
          </button>
        )}
        <button className="settings-row logout-row" onClick={onLogout}>
          <LogOut size={17} />
          <span>Sign out</span>
          <ChevronRight size={16} />
        </button>
      </section>
      <UserWithdrawals onOpenDetails={onOpenWithdrawal} />
      <NotificationSettings />
      <div className="referral-card">
        <span className="eyebrow">INVITE & EARN</span>
        <strong>
          Get 2,500 points when your friend completes their first task.
        </strong>
        <button
          className="text-button"
          onClick={() => {
            navigator.clipboard?.writeText(referral?.link || "");
            toast.success("Referral link copied");
          }}
        >
          Copy your link <Copy size={14} />
        </button>
        <button className="text-button" onClick={onInstall}>
          Install Orbit <ArrowUpRight size={15} />
        </button>
      </div>
    </div>
  );
}

function Admin({ onOpenDetails }: { onOpenDetails: (id: number) => void }) {
  const [statusFilter, setStatusFilter] = useState<
    "all" | "pending" | "approved" | "rejected" | "paid"
  >("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [minFilter, setMinFilter] = useState("");
  const [maxFilter, setMaxFilter] = useState("");
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<"createdAt" | "amount" | "status">(
    "createdAt"
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [kycFilter, setKycFilter] = useState<
    "all" | "requested" | "submitted" | "under_review" | "approved" | "rejected"
  >("all");
  const filterInput = useMemo(
    () => ({
      status: statusFilter === "all" ? undefined : statusFilter,
      method: methodFilter === "all" ? undefined : methodFilter,
      minAmount: minFilter ? Number(minFilter) : undefined,
      maxAmount: maxFilter ? Number(maxFilter) : undefined,
      from: fromFilter
        ? new Date(`${fromFilter}T00:00:00`).getTime()
        : undefined,
      to: toFilter ? new Date(`${toFilter}T23:59:59`).getTime() : undefined,
      page,
      pageSize: 8,
      sortBy,
      sortDir,
    }),
    [
      statusFilter,
      methodFilter,
      minFilter,
      maxFilter,
      fromFilter,
      toFilter,
      page,
      sortBy,
      sortDir,
    ]
  );
  const stats = trpc.orbit.admin.stats.useQuery();
  const trends = trpc.orbit.admin.trends.useQuery();
  const rows = trpc.orbit.admin.withdrawals.useQuery(filterInput);
  const users = trpc.orbit.admin.users.useQuery();
  const kycRequests = trpc.orbit.admin.kycRequests.useQuery(
    kycFilter === "all" ? undefined : { status: kycFilter }
  );
  const setRole = trpc.orbit.admin.setUserRole.useMutation({
    onSuccess: () => {
      toast.success("User role updated");
      users.refetch();
    },
  });
  const review = trpc.orbit.admin.reviewWithdrawal.useMutation({
    onSuccess: () => {
      toast.success("Withdrawal updated");
      stats.refetch();
      rows.refetch();
    },
  });
  const requestKyc = trpc.orbit.admin.requestKyc.useMutation({
    onSuccess: () => {
      toast.success("KYC request sent to the user");
      kycRequests.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const reviewKyc = trpc.orbit.admin.reviewKyc.useMutation({
    onSuccess: (_, variables) => {
      toast.success(`KYC marked ${variables.status.replace("_", " ")}`);
      kycRequests.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const data = stats.data || {
    users: 1248,
    pendingPayouts: 18,
    paidOut: 84210,
    coinsIssued: 1284000,
  };
  const withdrawals = rows.data?.items || [];
  const pagination = rows.data || { page: 1, totalPages: 1, total: 0 };
  return (
    <div className="page-content admin-page">
      <section className="page-intro">
        <div>
          <span className="eyebrow">OWNER CONSOLE</span>
          <h1>Control room.</h1>
          <p>Platform health, payouts, and audit actions.</p>
        </div>
        <ShieldCheck className="admin-shield" size={27} />
      </section>
      <div className="admin-kpis">
        <div>
          <span>USERS</span>
          <strong>{data.users.toLocaleString()}</strong>
        </div>
        <div>
          <span>PENDING PAYOUTS</span>
          <strong>{data.pendingPayouts.toLocaleString()}</strong>
        </div>
        <div>
          <span>PAID OUT</span>
          <strong>{data.paidOut.toLocaleString()}</strong>
        </div>
        <div>
          <span>COINS ISSUED</span>
          <strong>{data.coinsIssued.toLocaleString()}</strong>
        </div>
      </div>
      <section className="admin-charts section-block">
        <div className="section-heading">
          <div>
            <span className="eyebrow">LAST 7 DAYS</span>
            <h2>Activity trends</h2>
          </div>
          <span className="section-count">LIVE VIEW</span>
        </div>
        <div className="chart-grid">
          <div className="chart-card">
            <span className="chart-label">WITHDRAWAL VOLUME</span>
            <div className="chart-frame">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trends.data || []}>
                  <defs>
                    <linearGradient
                      id="withdrawalGradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="#c8ff42"
                        stopOpacity={0.35}
                      />
                      <stop offset="100%" stopColor="#c8ff42" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    stroke="rgba(255,255,255,0.08)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "#77758f", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{
                      background: "#17152b",
                      border: "1px solid rgba(255,255,255,0.14)",
                      borderRadius: 8,
                      color: "#fff",
                    }}
                    formatter={(value: number) => [
                      `${value.toLocaleString()} pts`,
                      "Volume",
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="withdrawals"
                    stroke="#c8ff42"
                    fill="url(#withdrawalGradient)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="chart-card">
            <span className="chart-label">USER ACTIVITY</span>
            <div className="chart-frame">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trends.data || []}>
                  <CartesianGrid
                    stroke="rgba(255,255,255,0.08)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "#77758f", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{
                      background: "#17152b",
                      border: "1px solid rgba(255,255,255,0.14)",
                      borderRadius: 8,
                      color: "#fff",
                    }}
                    formatter={(value: number) => [value, "Users"]}
                  />
                  <Bar dataKey="users" fill="#9d7dff" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </section>
      <section className="section-block">
        <div className="section-heading">
          <div>
            <span className="eyebrow">WITHDRAWALS QUEUE</span>
            <h2>Needs review</h2>
          </div>
        </div>
        <div className="withdrawal-filters">
          <select
            value={statusFilter}
            onChange={e => {
              setStatusFilter(e.target.value as any);
              setPage(1);
            }}
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="paid">Paid</option>
          </select>
          <select
            value={methodFilter}
            onChange={e => {
              setMethodFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">All methods</option>
            <option value="PayPal">PayPal</option>
          </select>
          <select
            value={sortBy}
            onChange={e => {
              setSortBy(e.target.value as any);
              setPage(1);
            }}
          >
            <option value="createdAt">Sort: date</option>
            <option value="amount">Sort: amount</option>
            <option value="status">Sort: status</option>
          </select>
          <button
            className="sort-direction"
            onClick={() => {
              setSortDir(value => (value === "asc" ? "desc" : "asc"));
              setPage(1);
            }}
          >
            {sortDir === "asc" ? "↑ Asc" : "↓ Desc"}
          </button>
          <input
            inputMode="numeric"
            placeholder="Min pts"
            value={minFilter}
            onChange={e => {
              setMinFilter(e.target.value);
              setPage(1);
            }}
          />
          <input
            inputMode="numeric"
            placeholder="Max pts"
            value={maxFilter}
            onChange={e => {
              setMaxFilter(e.target.value);
              setPage(1);
            }}
          />
          <input
            type="date"
            aria-label="From date"
            value={fromFilter}
            onChange={e => {
              setFromFilter(e.target.value);
              setPage(1);
            }}
          />
          <input
            type="date"
            aria-label="To date"
            value={toFilter}
            onChange={e => {
              setToFilter(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="withdrawal-table">
          {withdrawals.map((item: any) => (
            <div className="withdrawal-row" key={item.id}>
              <div>
                <strong>
                  #{item.id} · {money(item.amount)}
                </strong>
                <small>
                  {item.method} · {item.destination}
                </small>
              </div>
              <span className="pending-badge">{item.status}</span>
              <button
                className="detail-inline-link"
                onClick={() => onOpenDetails(item.id)}
              >
                View details
              </button>
              <div className="table-actions">
                <button
                  onClick={() =>
                    review.mutate({ id: item.id, status: "approved" })
                  }
                >
                  Approve
                </button>
                <button
                  onClick={() =>
                    review.mutate({ id: item.id, status: "rejected" })
                  }
                >
                  Reject
                </button>
                {item.status === "approved" && (
                  <button
                    onClick={() =>
                      review.mutate({ id: item.id, status: "paid" as any })
                    }
                  >
                    Mark paid
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="pagination-bar">
          <span>
            {pagination.total} results · Page {pagination.page} of{" "}
            {pagination.totalPages}
          </span>
          <div>
            <button
              disabled={page <= 1}
              onClick={() => setPage(value => Math.max(1, value - 1))}
            >
              Previous
            </button>
            <button
              disabled={page >= pagination.totalPages}
              onClick={() => setPage(value => value + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </section>
      <section className="section-block kyc-admin-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">IDENTITY VERIFICATION</span>
            <h2>KYC review queue</h2>
          </div>
          <span className="section-count">ADMIN INITIATED</span>
        </div>
        <div className="kyc-admin-toolbar">
          <p>
            Request KYC from the user directory only. Users submit readiness,
            then this queue controls the review decision.
          </p>
          <select
            aria-label="Filter KYC requests"
            value={kycFilter}
            onChange={event =>
              setKycFilter(event.target.value as typeof kycFilter)
            }
          >
            <option value="all">All KYC statuses</option>
            <option value="requested">Requested</option>
            <option value="submitted">Submitted</option>
            <option value="under_review">Under review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <div className="withdrawal-table kyc-admin-list">
          {kycRequests.isLoading && (
            <p className="notification-empty" aria-busy="true">
              Loading KYC requests…
            </p>
          )}
          {kycRequests.isError && (
            <div className="kyc-list-error" role="alert">
              <p>Unable to load the KYC queue.</p>
              <button
                className="text-button"
                onClick={() => kycRequests.refetch()}
              >
                Retry
              </button>
            </div>
          )}
          {!kycRequests.isLoading &&
            !kycRequests.isError &&
            (kycRequests.data || []).map((item: any) => (
              <div className="withdrawal-row kyc-admin-row" key={item.id}>
                <div>
                  <strong>
                    Request #{item.id} · User #{item.userId}
                  </strong>
                  <small>
                    {item.reason || "No reason recorded"} ·{" "}
                    {dateLabel(item.requestedAt)}
                  </small>
                  {item.reviewerNote && (
                    <small>Note: {item.reviewerNote}</small>
                  )}
                </div>
                <span className={`pending-badge kyc-state-${item.status}`}>
                  {item.status.replace("_", " ")}
                </span>
                <div className="table-actions">
                  {item.status === "submitted" && (
                    <button
                      onClick={() =>
                        reviewKyc.mutate({
                          id: item.id,
                          status: "under_review",
                        })
                      }
                    >
                      Start review
                    </button>
                  )}
                  {item.status === "under_review" && (
                    <>
                      <button
                        onClick={() =>
                          reviewKyc.mutate({ id: item.id, status: "approved" })
                        }
                      >
                        Approve
                      </button>
                      <button
                        onClick={() =>
                          reviewKyc.mutate({ id: item.id, status: "rejected" })
                        }
                      >
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          {!kycRequests.isLoading &&
            !kycRequests.isError &&
            !kycRequests.data?.length && (
              <p className="notification-empty">
                No KYC requests match this filter.
              </p>
            )}
        </div>
      </section>
      <section className="section-block">
        <div className="section-heading">
          <div>
            <span className="eyebrow">USER DIRECTORY</span>
            <h2>Accounts</h2>
          </div>
        </div>
        <div className="withdrawal-table">
          {(users.data || []).map((item: any) => (
            <div className="withdrawal-row" key={item.id}>
              <div>
                <strong>{item.name || "Unnamed user"}</strong>
                <small>{item.email || "No email"}</small>
              </div>
              <span className="pending-badge">{item.role}</span>
              <button
                className="role-toggle"
                onClick={() =>
                  setRole.mutate({
                    userId: item.id,
                    role: item.role === "admin" ? "user" : "admin",
                  })
                }
              >
                {item.role === "admin" ? "Demote" : "Make admin"}
              </button>
              <button
                className="role-toggle kyc-request-action"
                disabled={requestKyc.isPending}
                onClick={() =>
                  requestKyc.mutate({
                    userId: item.id,
                    reason: "Account security or payout review",
                  })
                }
              >
                Request KYC
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function AppShell() {
  const { user, isAuthenticated, loading, logout } = useAuth();
  const [tab, setTab] = useState<Tab>("Rewards");
  const [provider, setProvider] = useState<any>(null);
  const [cashOut, setCashOut] = useState(false);
  const [lastBalance, setLastBalance] = useState<number | null>(null);
  const [balanceChanged, setBalanceChanged] = useState(false);
  const [selectedWithdrawalId, setSelectedWithdrawalId] = useState<
    number | null
  >(null);
  const walletQuery = trpc.orbit.wallet.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const ledgerQuery = trpc.orbit.ledger.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const referralQuery = trpc.orbit.referral.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const attachReferral = trpc.orbit.attachReferral.useMutation();
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("ref");
    if (isAuthenticated && code) attachReferral.mutate({ code });
  }, [isAuthenticated]);
  const [installEvent, setInstallEvent] = useState<any>(null);
  useEffect(() => {
    const handler = (event: any) => {
      event.preventDefault();
      setInstallEvent(event);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);
  const install = async () => {
    if (!installEvent) {
      toast.info("Use your browser menu to install Orbit");
      return;
    }
    await installEvent.prompt();
    setInstallEvent(null);
  };
  const wallet = walletQuery.data || demoWallet;
  const ledger = ledgerQuery.data || demoLedger;
  const isAdmin = user?.role === "admin";
  useEffect(() => {
    if (lastBalance === null) {
      setLastBalance(wallet.balance);
      return;
    }
    if (wallet.balance !== lastBalance) {
      setLastBalance(wallet.balance);
      setBalanceChanged(true);
      const timer = window.setTimeout(() => setBalanceChanged(false), 700);
      return () => window.clearTimeout(timer);
    }
  }, [wallet.balance, lastBalance]);
  if (loading)
    return (
      <div className="loading-shell">
        <div className="loading-orbit" />
        <span>CONNECTING TO ORBIT</span>
      </div>
    );
  if (!isAuthenticated) return <Welcome onLogin={() => startLogin()} />;
  const tabs: Tab[] = isAdmin
    ? ["Rewards", "Wallet", "Me", "Admin"]
    : ["Rewards", "Wallet", "Me"];
  return (
    <div className="app-shell">
      <header className="top-header">
        <div className="brand-lockup compact">
          <span>ORBIT</span>
          <small>REWARDS IN MOTION</small>
        </div>
        <div className="header-actions">
          <div className="header-balance">
            <span>BALANCE</span>
            <strong className={balanceChanged ? "balance-pulse" : ""}>
              {wallet.balance.toLocaleString()} <i>PTS</i>
            </strong>
          </div>
          <NotificationCenter />
        </div>
      </header>
      <main className="app-main">
        {selectedWithdrawalId && (
          <WithdrawalDetails
            id={selectedWithdrawalId}
            onBack={() => setSelectedWithdrawalId(null)}
          />
        )}
        {!selectedWithdrawalId && tab === "Rewards" && (
          <Rewards
            onOpenProvider={setProvider}
            balance={wallet.balance}
            referral={referralQuery.data}
            isAuthed={isAuthenticated}
          />
        )}
        {!selectedWithdrawalId && tab === "Wallet" && (
          <Wallet
            wallet={wallet}
            ledger={ledger}
            onWithdraw={() => setCashOut(true)}
          />
        )}
        {!selectedWithdrawalId && tab === "Me" && (
          <Me
            user={user}
            wallet={wallet}
            referral={referralQuery.data}
            isAdmin={isAdmin}
            onAdmin={() => setTab("Admin")}
            onLogout={() => logout()}
            onInstall={install}
            onOpenWithdrawal={id => setSelectedWithdrawalId(id)}
          />
        )}
        {!selectedWithdrawalId && tab === "Admin" && isAdmin && (
          <Admin onOpenDetails={id => setSelectedWithdrawalId(id)} />
        )}
      </main>
      <nav className="bottom-nav" aria-label="Primary navigation">
        {tabs.map(item => (
          <button
            key={item}
            className={tab === item ? "nav-item active" : "nav-item"}
            onClick={() => setTab(item)}
          >
            <span>{item}</span>
            {tab === item && <i />}
          </button>
        ))}
      </nav>
      {provider && (
        <OfferSheet provider={provider} close={() => setProvider(null)} />
      )}
      {cashOut && <CashOut wallet={wallet} close={() => setCashOut(false)} />}
    </div>
  );
}

export default function App() {
  useEffect(() => {
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <AppShell />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

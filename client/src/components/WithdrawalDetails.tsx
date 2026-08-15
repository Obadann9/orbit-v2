import { ArrowLeft, Check, Clock3, FileText, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { POINTS_PER_USD } from "@shared/const";

const actionLabel: Record<string, string> = {
  "withdrawal.created": "Request submitted",
  "withdrawal.approved": "Request approved",
  "withdrawal.rejected": "Request rejected",
  "withdrawal.paid": "Payment marked complete",
};

function formatDate(value: Date | string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function money(points: number) {
  return `$${(points / POINTS_PER_USD).toFixed(2)}`;
}

export default function WithdrawalDetails({
  id,
  onBack,
}: {
  id: number;
  onBack: () => void;
}) {
  const details = trpc.orbit.withdrawalDetails.useQuery({ id });
  if (details.isLoading)
    return <div className="detail-state">Loading withdrawal details…</div>;
  if (details.isError || !details.data)
    return (
      <div className="detail-state">
        <p>This withdrawal is unavailable or you do not have access to it.</p>
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={15} /> Back
        </button>
      </div>
    );
  const { withdrawal, audit } = details.data;
  return (
    <div className="page-content withdrawal-details-page">
      <button className="back-button" onClick={onBack}>
        <ArrowLeft size={16} /> Back to withdrawals
      </button>
      <section className="detail-hero">
        <div>
          <span className="eyebrow">WITHDRAWAL / #{withdrawal.id}</span>
          <h1>{money(withdrawal.amount)}</h1>
          <p>
            {withdrawal.method} · {withdrawal.destination}
          </p>
        </div>
        <span className={`pending-badge status-${withdrawal.status}`}>
          {withdrawal.status}
        </span>
      </section>
      <div className="detail-meta-grid">
        <div>
          <span>REQUESTED</span>
          <strong>{formatDate(withdrawal.createdAt)}</strong>
        </div>
        <div>
          <span>AMOUNT</span>
          <strong>{withdrawal.amount.toLocaleString()} pts</strong>
        </div>
        <div>
          <span>METHOD</span>
          <strong>{withdrawal.method}</strong>
        </div>
      </div>
      <section className="section-block audit-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">AUDIT TRAIL</span>
            <h2>Change history</h2>
          </div>
          <ShieldCheck size={18} />
        </div>
        <div className="audit-timeline">
          {audit.map((event: any, index: number) => (
            <div
              className="audit-event"
              key={event.id || `${event.action}-${index}`}
            >
              <div className="audit-marker">
                {event.action.includes("paid") ? (
                  <Check size={13} />
                ) : event.action.includes("created") ? (
                  <FileText size={13} />
                ) : (
                  <Clock3 size={13} />
                )}
              </div>
              <div>
                <strong>{actionLabel[event.action] || event.action}</strong>
                <small>{formatDate(event.createdAt)}</small>
                {event.metadata && <p>{event.metadata}</p>}
              </div>
            </div>
          ))}
          {!audit.length && (
            <p className="notification-empty">No audit events recorded yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}

import { useState } from "react";
import { KeyRound, Link2, Plus, Webhook } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const initialDraft = {
  name: "",
  mark: "O",
  wallUrl: "",
  providerKey: "",
  secretEnvKey: "",
};

export default function OfferwallSettings() {
  const [draft, setDraft] = useState(initialDraft);
  const providers = trpc.orbit.admin.offerwallProviders.useQuery();
  const save = trpc.orbit.admin.saveOfferwallProvider.useMutation({
    onSuccess: () => {
      toast.success(
        "Offerwall provider saved. Add its secret in project settings."
      );
      setDraft(initialDraft);
      providers.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const callbackUrl = `${window.location.origin}/api/offerwall/postback`;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    save.mutate({
      ...draft,
      enabled: true,
      sortOrder: (providers.data?.length || 0) + 1,
      signatureMode: "hmac_body",
      signatureHeader: "x-orbit-signature",
      signatureField: "signature",
      transactionIdField: "transactionId",
      userIdField: "userId",
      amountField: "amount",
      offerNameField: "offerName",
    });
  };
  return (
    <section className="section-block offerwall-settings">
      <div className="section-heading">
        <div>
          <span className="eyebrow">OFFERWALL SECURITY</span>
          <h2>Server postbacks</h2>
        </div>
        <Webhook size={18} />
      </div>
      <p className="modal-copy">
        Rewards are accepted only from signed server postbacks. Secrets never
        appear here or in the database.
      </p>
      <div className="postback-base-url">
        <Link2 size={15} />
        <code>{callbackUrl}/&lt;provider-key&gt;</code>
      </div>
      <div className="withdrawal-table offerwall-provider-list">
        {providers.data?.map(provider => (
          <div className="withdrawal-row" key={provider.id}>
            <div>
              <strong>{provider.name}</strong>
              <small>
                {provider.providerKey
                  ? `${callbackUrl}/${provider.providerKey}`
                  : "Callback not configured"}
              </small>
            </div>
            <span
              className={`pending-badge ${provider.secretEnvKey ? "status-approved" : "status-pending"}`}
            >
              {provider.secretEnvKey ? "Secret key name set" : "Needs setup"}
            </span>
            {provider.secretEnvKey && (
              <small className="secret-env-label">
                <KeyRound size={13} /> {provider.secretEnvKey}
              </small>
            )}
          </div>
        ))}
        {!providers.isLoading && !providers.data?.length && (
          <p className="notification-empty">
            No offerwall providers configured yet.
          </p>
        )}
      </div>
      <form className="offerwall-provider-form" onSubmit={submit}>
        <label className="field-label">
          PROVIDER NAME
          <input
            required
            value={draft.name}
            onChange={event => setDraft({ ...draft, name: event.target.value })}
            placeholder="Example: AdGem"
          />
        </label>
        <label className="field-label">
          MARK
          <input
            required
            maxLength={12}
            value={draft.mark}
            onChange={event => setDraft({ ...draft, mark: event.target.value })}
          />
        </label>
        <label className="field-label">
          PROVIDER KEY
          <input
            required
            pattern="[a-z0-9][a-z0-9_-]{1,62}"
            value={draft.providerKey}
            onChange={event =>
              setDraft({
                ...draft,
                providerKey: event.target.value.toLowerCase(),
              })
            }
            placeholder="adgem"
          />
        </label>
        <label className="field-label">
          OFFERWALL URL
          <input
            required
            type="url"
            value={draft.wallUrl}
            onChange={event =>
              setDraft({ ...draft, wallUrl: event.target.value })
            }
            placeholder="Provider-issued offerwall URL"
          />
        </label>
        <label className="field-label">
          SECRET ENVIRONMENT KEY
          <input
            required
            pattern="[A-Z][A-Z0-9_]{2,127}"
            value={draft.secretEnvKey}
            onChange={event =>
              setDraft({
                ...draft,
                secretEnvKey: event.target.value.toUpperCase(),
              })
            }
            placeholder="OFFERWALL_ADGEM_SECRET"
          />
        </label>
        <button className="role-toggle" disabled={save.isPending} type="submit">
          <Plus size={15} /> Add secure provider
        </button>
      </form>
    </section>
  );
}

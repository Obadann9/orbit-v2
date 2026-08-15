export const ORBIT_POLICY_NOTICE =
  "These product policies explain how Orbit rewards, account safeguards, and personal information are handled. They should be reviewed by qualified counsel before public production release.";

export const ORBIT_POLICY_SECTIONS = [
  {
    title: "Responsible use",
    body: "Use one account per person, complete offers and tasks honestly, and do not automate, manipulate, or misrepresent activity. Orbit may delay, reverse, or decline rewards and cash-outs where fraud, duplicate accounts, or offer-provider violations are reasonably suspected.",
  },
  {
    title: "Points and cash-outs",
    body: "Points are promotional rewards, not currency or a deposit account. Cash-out requests require at least 5,000 points and are reviewed before payment. A completed request may be affected by provider validation, payout availability, or required identity checks.",
  },
  {
    title: "Identity verification",
    body: "KYC is not self-service. An administrator may initiate it when needed for security or payout review. This app records the request and review state only; it does not collect identity documents or connect to a KYC provider in this version.",
  },
  {
    title: "Privacy and account data",
    body: "Orbit uses account identity supplied at sign-in, wallet and transaction history, task activity, withdrawal details, notification preferences, and KYC workflow status to operate the service, prevent abuse, and support reviews. Access is role-controlled and operational changes are recorded in an audit trail.",
  },
  {
    title: "Updates and contact",
    body: "Material updates may be communicated through the in-app notification center. Contact the Orbit support channel shown by your service operator for privacy requests, payout questions, or policy concerns.",
  },
] as const;

export type LeadScoringAction =
  | "email_opened"
  | "email_clicked"
  | "replied"
  | "quote_viewed"
  | "meeting_scheduled"
  | "referral_source"
  | "inactivity_decay";

interface ActionMeta {
  action: LeadScoringAction;
  label: string;
  description: string;
  defaultPoints: number;
  /** false = no real trigger wired yet (needs a feature that doesn't exist), still configurable for when it lands. */
  wired: boolean;
}

// Keep in sync with the CASE default in fn_apply_lead_score() (0044).
export const LEAD_SCORING_ACTIONS: ActionMeta[] = [
  { action: "email_opened", label: "Email opened", description: "A sent email's tracking pixel fires.", defaultPoints: 5, wired: true },
  { action: "email_clicked", label: "Email link clicked", description: "A link in a sent email is clicked.", defaultPoints: 10, wired: true },
  { action: "replied", label: "Lead replied", description: "Any inbound email or WhatsApp message from the lead.", defaultPoints: 20, wired: true },
  { action: "quote_viewed", label: "Quote viewed", description: "Lead opens a shared quotation.", defaultPoints: 25, wired: false },
  { action: "meeting_scheduled", label: "Meeting scheduled", description: "A meeting is booked with the lead.", defaultPoints: 40, wired: false },
  { action: "referral_source", label: "Referral source", description: "Lead's Source field contains “referral”.", defaultPoints: 30, wired: true },
  { action: "inactivity_decay", label: "7-day inactivity decay", description: "No inbound contact for 7 days (checked daily).", defaultPoints: -10, wired: true },
];

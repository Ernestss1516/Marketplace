export const NOTIFICATION_JOB = {
  SEND_VERIFICATION_EMAIL: 'send-verification-email',
  SEND_RESET_EMAIL: 'send-reset-email',
  SEND_ALERT_EMAIL: 'send-alert-email',
} as const;

export interface SendVerificationEmailData {
  userId: string;
  email: string;
  name: string;
  token: string;
}

export interface SendResetEmailData {
  email: string;
  name: string;
  token: string;
}

export interface SendAlertEmailData {
  email: string;
  name: string;
  alertName: string;
  listingTitle: string;
  listingSlug: string;
}

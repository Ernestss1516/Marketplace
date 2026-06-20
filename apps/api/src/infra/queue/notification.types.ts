export const NOTIFICATION_JOB = {
  SEND_VERIFICATION_EMAIL: 'send-verification-email',
  SEND_RESET_EMAIL: 'send-reset-email',
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

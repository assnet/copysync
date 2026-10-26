export interface SendEmailInput {
  to: string;
  template: string;
  data: Record<string, unknown>;
  locale?: string;
}

export interface SendEmailResult {
  sent: boolean;
}

export interface IEmailSender {
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

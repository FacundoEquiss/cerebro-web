// MAIL ADAPTERS: who sends the transactional e-mails (order received, new order for the owner).
// Chosen by MAIL_PROVIDER: `console` (default) sends nothing and only logs that it would have,
// `resend` uses its HTTP API, `smtp` any SMTP server. To add a provider implement `MailAdapter`
// and register it. See docs/adapters.md.

import { env } from "@/lib/env";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

export interface MailAdapter {
  readonly id: string;
  /** Must never throw: a failed e-mail cannot break a purchase. Returns whether it was sent. */
  send(mail: Mail): Promise<boolean>;
}

const consoleMail: MailAdapter = {
  id: "console",
  async send(mail) {
    // No address in the log: logs are not the place for personal data.
    console.info(`[mail:console] not sent — "${mail.subject}"`);
    return false;
  },
};

const resend: MailAdapter = {
  id: "resend",
  async send(mail) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env().RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: env().MAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text, reply_to: mail.replyTo }),
      });
      if (!res.ok) console.error(`[mail:resend] ${res.status} — "${mail.subject}"`);
      return res.ok;
    } catch (e) {
      console.error(`[mail:resend] failed — "${mail.subject}"`, e instanceof Error ? e.message : e);
      return false;
    }
  },
};

// SMTP: any mailbox or transactional service that speaks it. `nodemailer` is loaded only here.
let transport: Promise<{ sendMail(message: Record<string, unknown>): Promise<unknown> }> | undefined;
const smtp: MailAdapter = {
  id: "smtp",
  async send(mail) {
    try {
      transport ??= import("nodemailer").then((m) => m.createTransport(env().SMTP_URL!));
      await (await transport).sendMail({ from: env().MAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text, replyTo: mail.replyTo });
      return true;
    } catch (e) {
      console.error(`[mail:smtp] failed — "${mail.subject}"`, e instanceof Error ? e.message : e);
      return false;
    }
  },
};

export const mailAdapters: Record<string, MailAdapter> = { console: consoleMail, resend, smtp };

export function mail(): MailAdapter {
  return mailAdapters[env().MAIL_PROVIDER] ?? consoleMail;
}

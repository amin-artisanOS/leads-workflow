import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";

export type EmailConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
};

export async function createTransporter(config: EmailConfig) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });
}

export function parseBody(body: string, lead: any) {
  let parsed = body;
  const variables = {
    firstName: lead.firstName || "there",
    lastName: lead.lastName || "",
    companyName: lead.companyName || "your company",
    website: lead.website || "",
  };

  Object.entries(variables).forEach(([key, value]) => {
    const regex = new RegExp(`{{${key}}}`, "g");
    parsed = parsed.replace(regex, value);
  });

  return parsed;
}

export async function sendOutreachEmail(
  transporter: any,
  from: string,
  to: string,
  subject: string,
  body: string
) {
  return transporter.sendMail({
    from,
    to,
    subject,
    text: body,
    html: body.replace(/\n\n/g, "<br><br>").replace(/\n/g, "<br>"),
  });
}

// Basic reply detection placeholder
export async function checkReplies(config: EmailConfig) {
  const client = new ImapFlow({
    host: config.host,
    port: 993,
    secure: true,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    logger: false,
  });

  await client.connect();
  let lock = await client.getMailboxLock("INBOX");
  
  try {
    // In a real app, we'd search for unseen messages or messages since last check
    // and match the "In-Reply-To" or "References" headers
    const messages = await client.fetch("1:*", { envelope: true });
    // Process messages...
  } finally {
    lock.release();
  }
  
  await client.logout();
}

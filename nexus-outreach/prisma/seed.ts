import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // 1. Create Account
  const account = await prisma.account.upsert({
    where: { email: "amin@example.com" },
    update: {},
    create: {
      email: "amin@example.com",
      name: "Amin (Work)",
      service: "gmail",
      smtpHost: "smtp.gmail.com",
      smtpPort: 587,
      smtpUser: "amin@example.com",
      smtpPass: "demo-pass",
      imapHost: "imap.gmail.com",
      imapPort: 993,
    },
  });

  // 2. Create Campaign
  const campaign = await prisma.campaign.create({
    data: {
      name: "SaaS Outreach Q1",
      status: "active",
      accountId: account.id,
      steps: {
        create: [
          {
            order: 1,
            subject: "Quick question about {{companyName}}",
            body: "Hi {{firstName}},\n\nI was looking at your website {{website}} and noticed you might be able to improve your product catalog management.\n\nWould you be open to a quick chat?\n\nBest,\nAmin",
            delayDays: 0,
          },
          {
            order: 2,
            subject: "Re: Quick question about {{companyName}}",
            body: "Hi {{firstName}},\n\nJust following up on my previous email. I know you're busy, but I'd love to hear your thoughts on improving the workflow at {{companyName}}.\n\nBest,\nAmin",
            delayDays: 3,
          }
        ]
      },
      leads: {
        create: [
          { email: "john@techcorp.com", firstName: "John", lastName: "Doe", companyName: "TechCorp", website: "techcorp.com", status: "active" },
          { email: "sarah@designly.io", firstName: "Sarah", lastName: "Smith", companyName: "Designly", website: "designly.io", status: "pending" },
          { email: "mike@buildit.com", firstName: "Mike", lastName: "Jones", companyName: "BuildIt", website: "buildit.com", status: "pending" },
        ]
      }
    }
  });

  console.log("Seeding finished.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

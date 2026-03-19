import { prisma } from "../lib/prisma";
import { createTransporter, parseBody, sendOutreachEmail } from "../lib/email-engine";
import { addDays, isBefore } from "date-fns";

async function processCampaigns() {
  console.log("🚀 Starting Outreach Worker...");

  // 1. Get all active campaigns
  const activeCampaigns = await prisma.campaign.findMany({
    where: { status: "active" },
    include: {
      account: true,
      steps: { orderBy: { order: "asc" } },
    }
  });

  for (const campaign of activeCampaigns) {
    console.log(`📦 Processing Campaign: ${campaign.name}`);
    
    // 2. Find leads to process
    const leads = await prisma.lead.findMany({
      where: {
        campaignId: campaign.id,
        status: { in: ["pending", "active"] }
      },
      include: {
        outcomes: { orderBy: { createdAt: "desc" } }
      }
    });

    if (leads.length === 0) continue;

    const transporter = await createTransporter({
      host: campaign.account.smtpHost!,
      port: campaign.account.smtpPort!,
      secure: campaign.account.smtpPort === 465,
      user: campaign.account.smtpUser!,
      pass: campaign.account.smtpPass!,
    });

    for (const lead of leads) {
      // Determine what step to send next
      const lastOutcome = lead.outcomes[0];
      let nextStepIndex = 0;

      if (lastOutcome) {
        if (lastOutcome.status === "replied") continue; // Stop if replied
        
        const lastStep = campaign.steps.find(s => s.id === lastOutcome.stepId);
        if (!lastStep) continue;

        nextStepIndex = campaign.steps.indexOf(lastStep) + 1;
        
        // Check delay
        const nextStep = campaign.steps[nextStepIndex];
        if (!nextStep) {
          // No more steps
          await prisma.lead.update({ where: { id: lead.id }, data: { status: "completed" } });
          continue;
        }

        const scheduledTime = addDays(new Date(lastOutcome.sentAt || new Date()), nextStep.delayDays);
        if (isBefore(new Date(), scheduledTime)) {
          console.log(`  - Skipping lead ${lead.email}: Not time yet for step ${nextStepIndex + 1}`);
          continue;
        }
      }

      const stepToSend = campaign.steps[nextStepIndex];
      if (!stepToSend) continue;

      console.log(`  - Sending Step ${nextStepIndex + 1} to ${lead.email}`);

      try {
        const parsedBody = parseBody(stepToSend.body, lead);
        const result = await sendOutreachEmail(
          transporter,
          campaign.account.email,
          lead.email,
          stepToSend.subject,
          parsedBody
        );

        // Record outcome
        await prisma.outcome.create({
          data: {
            leadId: lead.id,
            stepId: stepToSend.id,
            status: "sent",
            sentAt: new Date(),
            messageId: result.messageId,
          }
        });

        // Update lead
        await prisma.lead.update({
          where: { id: lead.id },
          data: { status: "active" }
        });

      } catch (error: any) {
        console.error(`  ❌ Failed to send to ${lead.email}:`, error.message);
        await prisma.outcome.create({
          data: {
            leadId: lead.id,
            stepId: stepToSend.id,
            status: "failed",
            error: error.message,
          }
        });
      }

      // Respect rate limits - wait 5-10s between sends
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  console.log("✅ Worker Cycle Finished.");
}

// Run every 5 minutes (simulated)
async function main() {
  while (true) {
    try {
      await processCampaigns();
    } catch (e) {
      console.error("Worker Error:", e);
    }
    await new Promise(r => setTimeout(r, 60000)); // Sleep 1 min
  }
}

main();

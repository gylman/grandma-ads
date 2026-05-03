import { Campaign } from "../../domain/types";
import { TelegramBotContext } from "./context";
import { formatDuration } from "./formatters";
import { extractTelegramPostText, fetchTelegramPostHtml, parseTelegramPostUrl } from "./postUtils";

export function createFinalSettlementWorker(ctx: TelegramBotContext): { pollDueCampaigns(): Promise<void> } {
  let running = false;
  const inFlightCampaigns = new Set<string>();

  async function pollDueCampaigns(): Promise<void> {
    if (running) return;
    running = true;

    try {
      const dueCampaigns = await ctx.useCases.listFinalizableCampaigns(new Date());
      for (const campaign of dueCampaigns) {
        if (inFlightCampaigns.has(campaign.id)) continue;
        inFlightCampaigns.add(campaign.id);
        try {
          await finalizeCampaign(campaign);
        } catch (error) {
          console.error("[telegram]: final settlement failed", campaign.id, error instanceof Error ? error.message : error);
        } finally {
          inFlightCampaigns.delete(campaign.id);
        }
      }
    } finally {
      running = false;
    }
  }

  async function finalizeCampaign(campaign: Campaign): Promise<void> {
    const html = campaign.submittedPostUrl ? await fetchTelegramPostHtml(campaign.submittedPostUrl) : null;
    const observedText = html ? campaign.approvedText ?? extractTelegramPostText(html) : null;
    const result = await ctx.useCases.finalizeCampaignAtEnd({
      campaignId: campaign.id,
      observedText,
    });

    if (result.settlement === "COMPLETED") {
      await deleteSubmittedPost(result.campaign);
    }

    await notifyParticipants(result.campaign, {
      settlement: result.settlement,
      txHash: result.txHash,
      reason: result.check.reason,
    });
  }

  async function deleteSubmittedPost(campaign: Campaign): Promise<void> {
    if (!campaign.submittedPostUrl) return;
    const post = parseTelegramPostUrl(campaign.submittedPostUrl);
    if (!post) return;

    try {
      await ctx.api.deleteMessage(`@${post.channel}`, Number(post.messageId));
    } catch (error) {
      console.error("[telegram]: could not delete completed campaign post", campaign.id, error instanceof Error ? error.message : error);
    }
  }

  async function notifyParticipants(
    campaign: Campaign,
    outcome: { settlement: "COMPLETED" | "REFUNDED" | "FAILED"; txHash: `0x${string}` | null; reason: string | null },
  ): Promise<void> {
    const advertiser = await ctx.useCases.getUserByWallet(campaign.advertiserWalletAddress);
    const poster = campaign.posterWalletAddress ? await ctx.useCases.getUserByWallet(campaign.posterWalletAddress) : null;
    const message = finalSettlementMessage(campaign, outcome);

    if (advertiser?.telegramUserId) {
      await ctx.api.sendMessage(Number(advertiser.telegramUserId), message);
    }
    if (poster?.telegramUserId && poster.telegramUserId !== advertiser?.telegramUserId) {
      await ctx.api.sendMessage(Number(poster.telegramUserId), message);
    }
  }

  return { pollDueCampaigns };
}

function finalSettlementMessage(
  campaign: Campaign,
  outcome: { settlement: "COMPLETED" | "REFUNDED" | "FAILED"; txHash: `0x${string}` | null; reason: string | null },
): string {
  if (outcome.settlement === "COMPLETED") {
    return [
      "Campaign completed.",
      `The post stayed live for ${formatDuration(campaign.durationSeconds)}.`,
      "The locked funds are now available to the publisher in escrow.",
      "I deleted the campaign post from the channel.",
      outcome.txHash ? `Completion tx: ${outcome.txHash}` : null,
      campaign.ensName ? "ENS completion proof was recorded." : null,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");
  }

  if (outcome.settlement === "REFUNDED") {
    return [
      "Campaign refunded.",
      outcome.reason ?? "The final check did not pass.",
      "The locked funds were returned to the advertiser's available escrow balance.",
      outcome.txHash ? `Refund tx: ${outcome.txHash}` : null,
      campaign.ensName ? "ENS refund proof was recorded." : null,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");
  }

  return [
    "Campaign final check failed.",
    outcome.reason ?? "The final check did not pass.",
    "I could not send an on-chain refund because this campaign has no on-chain campaign id.",
  ].join("\n");
}

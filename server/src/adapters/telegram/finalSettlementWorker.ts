import { Campaign } from "../../domain/types";
import { TelegramBotContext } from "./context";
import { formatCampaignLabel, formatDuration } from "./formatters";
import { adEventProofUrl, adProofUrl, explorerTxUrl, htmlLink } from "./proofLinks";
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
    const message = finalSettlementMessage(ctx, campaign, outcome);

    if (advertiser?.telegramUserId) {
      await ctx.api.sendMessage(Number(advertiser.telegramUserId), message, { parseMode: "HTML" });
    }
    if (poster?.telegramUserId && poster.telegramUserId !== advertiser?.telegramUserId) {
      await ctx.api.sendMessage(Number(poster.telegramUserId), message, { parseMode: "HTML" });
    }
  }

  return { pollDueCampaigns };
}

function finalSettlementMessage(
  ctx: TelegramBotContext,
  campaign: Campaign,
  outcome: { settlement: "COMPLETED" | "REFUNDED" | "FAILED"; txHash: `0x${string}` | null; reason: string | null },
): string {
  if (outcome.settlement === "COMPLETED") {
    return [
      `${formatCampaignLabel(campaign)} completed.`,
      `The post stayed live for ${formatDuration(campaign.durationSeconds)}.`,
      "The locked funds are now available to the publisher in escrow.",
      "I deleted the campaign post from the channel.",
      campaign.onchainCampaignId ? htmlLink("View Completion Proof", adEventProofUrl(ctx.config, campaign.onchainCampaignId, "COMPLETED")) : null,
      campaign.onchainCampaignId ? htmlLink("View Ad Record", adProofUrl(ctx.config, campaign.onchainCampaignId)) : null,
      outcome.txHash ? htmlLink("View Completion Transaction", explorerTxUrl(ctx.config, outcome.txHash)) : null,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");
  }

  if (outcome.settlement === "REFUNDED") {
    return [
      `${formatCampaignLabel(campaign)} refunded.`,
      outcome.reason ?? "The final check did not pass.",
      "The locked funds were returned to the advertiser's available escrow balance.",
      campaign.onchainCampaignId ? htmlLink("View Refund Proof", adEventProofUrl(ctx.config, campaign.onchainCampaignId, "REFUNDED")) : null,
      campaign.onchainCampaignId ? htmlLink("View Ad Record", adProofUrl(ctx.config, campaign.onchainCampaignId)) : null,
      outcome.txHash ? htmlLink("View Refund Transaction", explorerTxUrl(ctx.config, outcome.txHash)) : null,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");
  }

  return [
    `${formatCampaignLabel(campaign)} final check failed.`,
    outcome.reason ?? "The final check did not pass.",
    "I could not send an on-chain refund because this campaign has no on-chain campaign id.",
  ].join("\n");
}

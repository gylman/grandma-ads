import { TelegramBotContext } from "./context";
import { getMessageText } from "./postUtils";
import { TelegramMessage } from "./types";

export async function handleChannelPost(ctx: TelegramBotContext, message: TelegramMessage, isEdited: boolean): Promise<void> {
  const channelUsername = message.chat.username;
  if (!channelUsername) return;

  const observedText = getMessageText(message);
  if (!observedText) return;

  if (!isEdited) {
    const campaign = await ctx.useCases.findCampaignBySubmittedPost(channelUsername, String(message.message_id));
    if (campaign) {
      console.log(`[telegram]: observed campaign channel post ${campaign.id} in @${channelUsername}/${message.message_id}`);
    }
    return;
  }

  const result = await ctx.useCases.handleObservedCampaignPostEdit({
    channelUsername,
    messageId: String(message.message_id),
    observedText,
  });
  if (!result) return;
  if (result.status === "UNCHANGED") return;

  const advertiser = await ctx.useCases.getUserByWallet(result.campaign.advertiserWalletAddress);
  const poster = result.campaign.posterWalletAddress ? await ctx.useCases.getUserByWallet(result.campaign.posterWalletAddress) : null;
  const notice = [
    `Campaign ${result.campaign.id} changed after it was active.`,
    result.result.reason ?? "The post no longer matches the approved ad.",
    result.txHash ? `Refund tx: ${result.txHash}` : "Refund transaction was not sent because there is no on-chain campaign id.",
  ].join("\n");

  if (advertiser?.telegramUserId) await ctx.api.sendMessage(Number(advertiser.telegramUserId), notice);
  if (poster?.telegramUserId) await ctx.api.sendMessage(Number(poster.telegramUserId), notice);
}

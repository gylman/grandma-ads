import {
  acceptCampaignAndPublish,
  acceptCounterProposal,
  promptCampaignDraft,
  promptRegisterChannel,
  rejectCampaign,
  rejectCounterProposal,
  sendPreparedCounterCampaign,
  sendOfferFromCampaignId,
  showCampaigns,
} from "./campaignFlow";
import { TelegramBotContext, runDevCommand, sendPromptForReply } from "./context";
import { createDevWallet, promptDeposit, promptMint, promptWithdraw, sendDevBalanceWithActions } from "./devWalletFlow";
import { TelegramCallbackQuery } from "./types";

export async function handleCallbackQuery(ctx: TelegramBotContext, callbackQuery: TelegramCallbackQuery): Promise<void> {
  const data = callbackQuery.data ?? "";
  const message = callbackQuery.message;
  if (!message) {
    await ctx.api.answerCallbackQuery(callbackQuery.id);
    return;
  }

  const chatId = message.chat.id;
  const telegramUserId = String(callbackQuery.from.id ?? chatId);

  try {
    if (data === "menu:new_campaign") {
      await promptCampaignDraft(ctx, chatId);
      return;
    }
    if (data === "menu:register_channel") {
      await promptRegisterChannel(ctx, chatId);
      return;
    }
    if (data === "menu:my_campaigns") {
      await showCampaigns(ctx, chatId);
      return;
    }
    if (data === "menu:balance" || data === "dev:balance") {
      await runDevCommand(ctx, chatId, async () => {
        await sendDevBalanceWithActions(ctx, chatId, telegramUserId);
      });
      return;
    }
    if (data === "dev:prompt_mint") {
      await runDevCommand(ctx, chatId, async () => {
        await promptMint(ctx, chatId);
      });
      return;
    }
    if (data === "dev:create_wallet") {
      await runDevCommand(ctx, chatId, async () => {
        await createDevWallet(ctx, chatId, telegramUserId);
      });
      return;
    }
    if (data === "dev:prompt_deposit") {
      await runDevCommand(ctx, chatId, async () => {
        await promptDeposit(ctx, chatId);
      });
      return;
    }
    if (data === "dev:prompt_withdraw") {
      await runDevCommand(ctx, chatId, async () => {
        await promptWithdraw(ctx, chatId);
      });
      return;
    }
    if (data.startsWith("campaign:revise:")) {
      const campaignId = data.replace("campaign:revise:", "").trim();
      await runDevCommand(ctx, chatId, async () => {
        if (!campaignId) throw new Error("Campaign id is missing for revise.");
        await sendPromptForReply(ctx, chatId, "Reply to this message with what you want to change in the ad copy.", "REVISE_COPY", {
          campaignId,
          placeholder: "Make it shorter and more direct.",
        });
      });
      return;
    }
    if (data.startsWith("campaign:send_offer:")) {
      const campaignId = data.replace("campaign:send_offer:", "").trim();
      await runDevCommand(ctx, chatId, async () => {
        if (!campaignId) throw new Error("Campaign id is missing for send offer.");
        await sendOfferFromCampaignId(ctx, chatId, telegramUserId, campaignId);
      });
      return;
    }
    if (data.startsWith("offer:accept:")) {
      const campaignId = data.replace("offer:accept:", "").trim();
      await runDevCommand(ctx, chatId, async () => {
        if (!campaignId) throw new Error("Campaign id is missing for accept.");
        await acceptCampaignAndPublish(ctx, chatId, telegramUserId, campaignId);
      });
      return;
    }
    if (data.startsWith("offer:reject:")) {
      const campaignId = data.replace("offer:reject:", "").trim();
      await runDevCommand(ctx, chatId, async () => {
        if (!campaignId) throw new Error("Campaign id is missing for reject.");
        await rejectCampaign(ctx, chatId, telegramUserId, campaignId);
      });
      return;
    }
    if (data.startsWith("offer:counter:")) {
      const campaignId = data.replace("offer:counter:", "").trim();
      await runDevCommand(ctx, chatId, async () => {
        if (!campaignId) throw new Error("Campaign id is missing for counter.");
        await sendPromptForReply(ctx, chatId, "Reply to this message with your counter offer.", "COUNTER_OFFER", {
          campaignId,
          placeholder: "150 USDC for 24h",
        });
      });
      return;
    }
    if (data.startsWith("counter_draft:revise:")) {
      const campaignId = data.replace("counter_draft:revise:", "").trim();
      await runDevCommand(ctx, chatId, async () => {
        if (!campaignId) throw new Error("Campaign id is missing for counter revise.");
        await sendPromptForReply(ctx, chatId, "Reply to this message with your counter offer.", "COUNTER_OFFER", {
          campaignId,
          placeholder: "150 USDC for 24h",
        });
      });
      return;
    }
    if (data.startsWith("counter_draft:send:")) {
      const campaignId = data.replace("counter_draft:send:", "").trim();
      await runDevCommand(ctx, chatId, async () => {
        if (!campaignId) throw new Error("Campaign id is missing for counter send.");
        await sendPreparedCounterCampaign(ctx, chatId, campaignId);
      });
      return;
    }
    if (data.startsWith("counter_response:accept:")) {
      const campaignId = data.replace("counter_response:accept:", "").trim();
      await runDevCommand(ctx, chatId, async () => {
        if (!campaignId) throw new Error("Campaign id is missing for counter accept.");
        await acceptCounterProposal(ctx, chatId, telegramUserId, campaignId);
      });
      return;
    }
    if (data.startsWith("counter_response:reject:")) {
      const campaignId = data.replace("counter_response:reject:", "").trim();
      await runDevCommand(ctx, chatId, async () => {
        if (!campaignId) throw new Error("Campaign id is missing for counter reject.");
        await rejectCounterProposal(ctx, chatId, telegramUserId, campaignId);
      });
      return;
    }
    if (data.startsWith("counter_response:counter:")) {
      const campaignId = data.replace("counter_response:counter:", "").trim();
      await runDevCommand(ctx, chatId, async () => {
        if (!campaignId) throw new Error("Campaign id is missing for counter.");
        await sendPromptForReply(ctx, chatId, "Reply to this message with your counter offer.", "COUNTER_OFFER", {
          campaignId,
          placeholder: "150 USDC for 24h",
        });
      });
      return;
    }
  } finally {
    await ctx.api.answerCallbackQuery(callbackQuery.id).catch(() => {});
  }
}

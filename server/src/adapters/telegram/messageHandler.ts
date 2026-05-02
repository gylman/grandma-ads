import {
  acceptCampaignAndPublish,
  acceptCounterOffer,
  counterCampaign,
  createCampaignDraftFromText,
  fundCampaignOnly,
  offerReplyAction,
  promptCampaignDraft,
  promptRegisterChannel,
  rejectCampaign,
  resolveSendOfferCampaignId,
  reviseCampaignCopy,
  sendOfferFromCampaignId,
  showCampaigns,
  verifyCampaignPostFromUrl,
} from "./campaignFlow";
import { registerChannelFromText, verifyChannelFromPostUrl } from "./channelFlow";
import { TelegramBotContext, runDevCommand, sendPromptForReply } from "./context";
import { helpText } from "./copy";
import {
  createDevWallet,
  depositMockUsdc,
  mintMockUsdc,
  promptDeposit,
  promptMint,
  promptWithdraw,
  sendDevBalanceWithActions,
  withdrawMockUsdc,
} from "./devWalletFlow";
import { mainMenuButtons } from "./keyboards";
import { isTelegramPostUrl } from "./postUtils";
import { campaignContextFromReply, campaignIdFromReply, clearChatState } from "./state";
import { TelegramMessage } from "./types";

export async function handleMessage(ctx: TelegramBotContext, message: TelegramMessage): Promise<void> {
  const text = message.text?.trim() ?? "";
  const chatId = message.chat.id;
  const telegramUserId = String(message.from?.id ?? chatId);
  const pendingPrompt = ctx.state.pendingPromptByChat.get(chatId);

  if (pendingPrompt && !text.startsWith("/") && message.reply_to_message?.message_id === pendingPrompt.promptMessageId) {
    ctx.state.pendingPromptByChat.delete(chatId);
    await runDevCommand(ctx, chatId, async () => {
      if (pendingPrompt.type === "CAMPAIGN_DRAFT") {
        await createCampaignDraftFromText(ctx, chatId, telegramUserId, text);
        return;
      }
      if (pendingPrompt.type === "REGISTER_CHANNEL") {
        await registerChannelFromText(ctx, chatId, telegramUserId, text);
        return;
      }
      if (pendingPrompt.type === "REVISE_COPY") {
        if (!pendingPrompt.campaignId) throw new Error("Campaign context is missing for this revise prompt.");
        await reviseCampaignCopy(ctx, chatId, telegramUserId, pendingPrompt.campaignId, text);
        return;
      }
      if (pendingPrompt.type === "DEV_MINT") {
        await mintMockUsdc(ctx, chatId, telegramUserId, text);
        return;
      }
      if (pendingPrompt.type === "DEV_DEPOSIT") {
        await depositMockUsdc(ctx, chatId, telegramUserId, text);
        return;
      }
      if (pendingPrompt.type === "DEV_WITHDRAW") {
        await withdrawMockUsdc(ctx, chatId, telegramUserId, text);
        return;
      }
      if (pendingPrompt.type === "COUNTER_OFFER") {
        if (!pendingPrompt.campaignId) throw new Error("Campaign context is missing for this counter prompt.");
        await counterCampaign(ctx, chatId, pendingPrompt.campaignId, text);
      }
    });
    return;
  }

  if (isTelegramPostUrl(text)) {
    const campaignHandled = await verifyCampaignPostFromUrl(ctx, chatId, telegramUserId, text);
    if (campaignHandled) return;

    const handled = await verifyChannelFromPostUrl(ctx, chatId, telegramUserId, text);
    if (handled) return;
  }

  const replyCampaignContext = campaignContextFromReply(ctx.state, message);
  if (replyCampaignContext && text && !text.startsWith("/")) {
    await runDevCommand(ctx, chatId, async () => {
      if (replyCampaignContext.purpose === "DRAFT") {
        await reviseCampaignCopy(ctx, chatId, telegramUserId, replyCampaignContext.campaignId, text);
        return;
      }

      const action = offerReplyAction(text);
      if (action === "ACCEPT") {
        await acceptCampaignAndPublish(ctx, chatId, telegramUserId, replyCampaignContext.campaignId);
        return;
      }
      if (action === "REJECT") {
        await rejectCampaign(ctx, chatId, telegramUserId, replyCampaignContext.campaignId);
        return;
      }
      await counterCampaign(ctx, chatId, replyCampaignContext.campaignId, text);
    });
    return;
  }

  if (text.startsWith("/start")) {
    await ctx.api.sendMessage(chatId, "Choose an action below, or reply to the campaign prompt.", { replyMarkup: mainMenuButtons() });
    await promptCampaignDraft(ctx, chatId);
    return;
  }

  if (text.startsWith("/help")) {
    await ctx.api.sendMessage(chatId, helpText(ctx.config.custodialDevMode));
    return;
  }

  if (text.startsWith("/new_campaign")) {
    await promptCampaignDraft(ctx, chatId);
    return;
  }

  if (text.startsWith("/campaign_draft")) {
    const details = text.replace(/^\/campaign_draft(?:@\w+)?\s*/i, "").trim();
    if (!details) {
      await ctx.api.sendMessage(chatId, "Send details after the command, like /campaign_draft Promote my app on @channel for 100 USDC for 24 hours.");
      return;
    }

    await createCampaignDraftFromText(ctx, chatId, telegramUserId, details);
    return;
  }

  if (text.startsWith("/revise_copy")) {
    await runDevCommand(ctx, chatId, async () => {
      const [, firstArg, ...restArgs] = text.split(/\s+/);
      const firstArgLooksLikeCampaign = Boolean(firstArg?.startsWith("cmp_"));
      const campaignId = firstArgLooksLikeCampaign ? firstArg : campaignIdFromReply(ctx.state, message);
      const instruction = (firstArgLooksLikeCampaign ? restArgs : [firstArg, ...restArgs]).filter(Boolean).join(" ");
      if (!campaignId) throw new Error("Usage: /revise_copy <campaignId> <instruction>");
      await reviseCampaignCopy(ctx, chatId, telegramUserId, campaignId, instruction || null);
    });
    return;
  }

  if (text.startsWith("/fund_campaign")) {
    await runDevCommand(ctx, chatId, async () => {
      const [, campaignId] = text.split(/\s+/);
      if (!campaignId) throw new Error("Usage: /fund_campaign <campaignId>");
      await fundCampaignOnly(ctx, chatId, telegramUserId, campaignId);
    });
    return;
  }

  if (text.startsWith("/send_offer")) {
    await runDevCommand(ctx, chatId, async () => {
      const [, campaignIdFromCommand] = text.split(/\s+/);
      const campaignId = await resolveSendOfferCampaignId(ctx, telegramUserId, message, campaignIdFromCommand);
      if (!campaignId) throw new Error("Usage: /send_offer <campaignId> or reply to the draft/copy message.");
      await sendOfferFromCampaignId(ctx, chatId, telegramUserId, campaignId);
    });
    return;
  }

  if (text.startsWith("/accept_counter")) {
    await runDevCommand(ctx, chatId, async () => {
      const [, campaignId, amount, duration] = text.split(/\s+/);
      if (!campaignId || !amount || !duration) throw new Error("Usage: /accept_counter <campaignId> <amount> <duration>");
      await acceptCounterOffer(ctx, chatId, campaignId, amount, duration);
    });
    return;
  }

  if (text.startsWith("/counter")) {
    await runDevCommand(ctx, chatId, async () => {
      const [, firstArg, ...restArgs] = text.split(/\s+/);
      const replyCampaignId = campaignIdFromReply(ctx.state, message);
      const firstArgLooksLikeCampaign = Boolean(firstArg?.startsWith("cmp_"));
      const campaignId = firstArgLooksLikeCampaign ? firstArg : replyCampaignId;
      const counterMessage = (firstArgLooksLikeCampaign ? restArgs : [firstArg, ...restArgs]).filter(Boolean).join(" ").trim();
      if (!campaignId) throw new Error("Usage: /counter <campaignId> <terms>, or reply to an offer and use /counter.");
      if (!counterMessage) {
        await sendPromptForReply(ctx, chatId, "Reply to this message with your counter offer.", "COUNTER_OFFER", {
          campaignId,
          placeholder: "150 USDC for 24h",
        });
        return;
      }
      await counterCampaign(ctx, chatId, campaignId, counterMessage);
    });
    return;
  }

  if (text.startsWith("/accept")) {
    await runDevCommand(ctx, chatId, async () => {
      const [, campaignIdFromCommand] = text.split(/\s+/);
      const campaignId = campaignIdFromCommand ?? campaignIdFromReply(ctx.state, message);
      if (!campaignId) throw new Error("Usage: /accept <campaignId>");
      await acceptCampaignAndPublish(ctx, chatId, telegramUserId, campaignId);
    });
    return;
  }

  if (text.startsWith("/reject")) {
    await runDevCommand(ctx, chatId, async () => {
      const [, campaignIdFromCommand] = text.split(/\s+/);
      const campaignId = campaignIdFromCommand ?? campaignIdFromReply(ctx.state, message);
      if (!campaignId) throw new Error("Usage: /reject <campaignId>");
      await rejectCampaign(ctx, chatId, telegramUserId, campaignId);
    });
    return;
  }

  if (text.startsWith("/dev_create_wallet") || text.startsWith("/dev_wallet")) {
    await runDevCommand(ctx, chatId, async () => {
      await createDevWallet(ctx, chatId, telegramUserId);
    });
    return;
  }

  if (text.startsWith("/sign")) {
    await runDevCommand(ctx, chatId, async () => {
      const messageToSign = text.replace(/^\/sign(?:@\w+)?\s*/i, "").trim();
      if (!messageToSign) throw new Error("Usage: /sign <message>");
      const result = await ctx.useCases.signDevWalletMessage(telegramUserId, messageToSign);
      await ctx.api.sendMessage(chatId, ["Message signed.", `Wallet: ${result.wallet.address}`, `Message: ${result.message}`, `Signature: ${result.signature}`].join("\n"));
    });
    return;
  }

  if (text.startsWith("/dev_balance") || text.startsWith("/balance")) {
    if (!ctx.config.custodialDevMode && text.startsWith("/balance")) {
      await ctx.api.sendMessage(chatId, `Wallet balances are shown in the web app: ${ctx.config.clientUrl}`);
      return;
    }

    await runDevCommand(ctx, chatId, async () => {
      await sendDevBalanceWithActions(ctx, chatId, telegramUserId);
    });
    return;
  }

  if (text.startsWith("/dev_mint")) {
    await runDevCommand(ctx, chatId, async () => {
      const payload = text.replace(/^\/dev_mint(?:@\w+)?\s*/i, "").trim();
      if (payload) {
        await mintMockUsdc(ctx, chatId, telegramUserId, payload);
        return;
      }
      await promptMint(ctx, chatId);
    });
    return;
  }

  if (text.startsWith("/dev_deposit")) {
    await runDevCommand(ctx, chatId, async () => {
      const payload = text.replace(/^\/dev_deposit(?:@\w+)?\s*/i, "").trim();
      if (payload) {
        await depositMockUsdc(ctx, chatId, telegramUserId, payload);
        return;
      }
      await promptDeposit(ctx, chatId);
    });
    return;
  }

  if (text.startsWith("/dev_withdraw")) {
    await runDevCommand(ctx, chatId, async () => {
      const payload = text.replace(/^\/dev_withdraw(?:@\w+)?\s*/i, "").trim();
      if (payload) {
        await withdrawMockUsdc(ctx, chatId, telegramUserId, payload);
        return;
      }
      await promptWithdraw(ctx, chatId);
    });
    return;
  }

  if (text.startsWith("/dev_clear")) {
    await runDevCommand(ctx, chatId, async () => {
      await ctx.useCases.clearDevState(telegramUserId);
      clearChatState(ctx.state, chatId);

      await ctx.api.sendMessage(chatId, "Cleared your dev wallet record, campaigns, channels, and linked user state for this Telegram account.");
    });
    return;
  }

  if (text.startsWith("/link")) {
    await ctx.api.sendMessage(chatId, `Open the web app to connect your wallet: ${ctx.config.clientUrl}`);
    return;
  }

  if (text.startsWith("/register_channel")) {
    const channelFromCommand = text.split(/\s+/)[1];
    if (channelFromCommand && channelFromCommand.startsWith("@")) {
      await registerChannelFromText(ctx, chatId, telegramUserId, channelFromCommand);
      return;
    }

    await promptRegisterChannel(ctx, chatId);
    return;
  }

  if (text.startsWith("/my_campaigns")) {
    await showCampaigns(ctx, chatId);
    return;
  }

  if (text.startsWith("/menu")) {
    await ctx.api.sendMessage(chatId, "Here is the quick action menu.", { replyMarkup: mainMenuButtons() });
    return;
  }

  await ctx.api.sendMessage(chatId, "I did not understand that yet. Try /help.");
}

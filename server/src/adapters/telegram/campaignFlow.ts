import { Campaign } from "../../domain/types";
import { TelegramBotContext, sendPromptForReply } from "./context";
import { campaignOpeningPrompt, formatMissingFields } from "./copy";
import { sendDevWalletOverview } from "./devWalletFlow";
import { formatCampaignSummary, formatDuration } from "./formatters";
import { pendingAdvertiserUserId, pendingAdvertiserWalletAddress } from "./identity";
import { counterDraftActionButtons, counterResponseActionButtons, offerActionButtons } from "./keyboards";
import { extractTelegramPostText, fetchTelegramPostHtml, parseTelegramPostUrl } from "./postUtils";
import { escapeHtml, highlightNegotiationTerms } from "./richText";
import { campaignIdFromReply, counterProposalKey, rememberCampaignMessage } from "./state";
import { parseDuration, parseTokenAmountForButton, resolveRequestedToken } from "./tokenUtils";
import { TelegramInlineKeyboardButton, TelegramMessage, TelegramReplyMarkup } from "./types";

export async function canShowSendOfferButton(ctx: TelegramBotContext, telegramUserId: string, campaign: Campaign): Promise<boolean> {
  if (!["DRAFT", "AWAITING_FUNDS", "FUNDED"].includes(campaign.status)) return false;
  if (campaign.status === "FUNDED") return true;

  const wallet = await ctx.useCases.getDevWallet(telegramUserId);
  if (!wallet) return false;

  try {
    const overview = await ctx.useCases.getDevWalletMajorBalances(telegramUserId);
    const token = overview.balances.find((balance) => balance.address?.toLowerCase() === campaign.tokenAddress.toLowerCase());
    if (!token || token.escrowBalance === null) return false;

    const needed = parseTokenAmountForButton(campaign.amount, token.decimals);
    return token.escrowBalance >= needed;
  } catch {
    return false;
  }
}

export async function buildDraftActionButtons(ctx: TelegramBotContext, telegramUserId: string, campaign: Campaign): Promise<TelegramReplyMarkup> {
  void ctx;
  void telegramUserId;

  return {
    inline_keyboard: [
      [{ text: "Revise Copy", callback_data: `campaign:revise:${campaign.id}` }],
      [{ text: "Send Offer", callback_data: `campaign:send_offer:${campaign.id}` }],
    ],
  };
}

export async function verifyCampaignPostFromUrl(ctx: TelegramBotContext, chatId: number, telegramUserId: string, postUrl: string): Promise<boolean> {
  if (!ctx.config.custodialDevMode) {
    await ctx.api.sendMessage(chatId, "Campaign post verification in bot is currently enabled in dev mode only.");
    return false;
  }

  const urlParts = parseTelegramPostUrl(postUrl);
  if (!urlParts) return false;

  const campaign = await ctx.useCases.findAwaitingPostCampaignForPoster(telegramUserId, urlParts.channel);
  if (!campaign) return false;

  const html = await fetchTelegramPostHtml(postUrl);
  if (!html) {
    await ctx.api.sendMessage(chatId, "Could not fetch the post. Make sure the channel and post are public.");
    return true;
  }

  const observedText = extractTelegramPostText(html);
  const result = await ctx.useCases.submitCampaignPostUrlFromPoster({
    telegramUserId,
    campaignId: campaign.id,
    submittedPostUrl: postUrl,
    observedText,
  });
  const advertiser = result.campaign?.advertiserWalletAddress ? await ctx.useCases.getUserByWallet(result.campaign.advertiserWalletAddress) : null;

  if (result.check.status === "PASSED") {
    await ctx.api.sendMessage(chatId, [`Post verified for ${campaign.id}.`, "The campaign is now active. I will use this URL for final checks later."].join("\n"));
    if (advertiser?.telegramUserId) {
      await ctx.api.sendMessage(Number(advertiser.telegramUserId), `The poster submitted and verified the post for ${campaign.id}:\n${postUrl}`);
    }
    return true;
  }

  await ctx.api.sendMessage(
    chatId,
    [
      `Post verification failed for ${campaign.id}.`,
      result.check.reason ?? "The post did not match the approved ad.",
      "",
      "Please publish the approved text exactly and send the post URL again.",
    ].join("\n"),
  );
  if (advertiser?.telegramUserId) {
    await ctx.api.sendMessage(Number(advertiser.telegramUserId), `Post verification failed for ${campaign.id}: ${result.check.reason ?? "unknown reason"}`);
  }
  return true;
}

export async function createCampaignDraftFromText(ctx: TelegramBotContext, chatId: number, telegramUserId: string, rawInput: string): Promise<void> {
  if (!ctx.config.custodialDevMode) {
    await ctx.api.sendMessage(chatId, `Campaign drafting in the bot is enabled in dev mode only right now. Use ${ctx.config.clientUrl} for wallet actions.`);
    return;
  }

  const token = resolveRequestedToken(rawInput, ctx.config);
  if (!token) {
    await ctx.api.sendMessage(chatId, "That currency is not configured yet. For now, use USDC or set the matching token address in server/.env.");
    return;
  }

  const result = await ctx.useCases.createCampaignDraftFromMessage({
    advertiserUserId: pendingAdvertiserUserId(telegramUserId),
    advertiserWalletAddress: pendingAdvertiserWalletAddress(telegramUserId),
    telegramUsername: ctx.state.telegramUsernamesById.get(telegramUserId) ?? null,
    tokenAddress: token.address,
    message: rawInput,
  });

  if (result.status === "BLOCKED") {
    await ctx.api.sendMessage(
      chatId,
      [
        "I cannot create that campaign yet because the content looks risky.",
        ...result.recommendation.safety.reasons.map((reason) => `- ${reason}`),
        ...result.recommendation.safety.suggestedFixes.map((fix) => `Fix: ${fix}`),
      ].join("\n"),
    );
    return;
  }

  if (result.status === "NEEDS_INPUT") {
    await sendPromptForReply(
      ctx,
      chatId,
      [
        "Almost. I need a little more detail before I can draft the ad.",
        `Still missing: ${formatMissingFields(result.recommendation.intake.missingFields)}`,
        "",
        "Reply to this message in one message when you are ready.",
        "Example: Promote Grandma Ads on @openagents2026 for 100 USDC for 24 hours. Caption: Sponsored posts with escrow, without spreadsheets.",
      ].join("\n"),
      "CAMPAIGN_DRAFT",
      { placeholder: "Promote ... on @channel for ..." },
    );
    return;
  }

  if (result.status === "CHANNEL_NOT_VERIFIED") {
    await ctx.api.sendMessage(chatId, "That target channel is not verified yet. Ask the channel owner to use /register_channel first.");
    return;
  }

  if (result.status === "POSTER_NOT_FOUND") {
    await ctx.api.sendMessage(chatId, "The target channel is verified, but I could not find the poster account. Please re-register the channel.");
    return;
  }

  const draftMessage = await ctx.api.sendMessage(
    chatId,
    [
      "Campaign draft created.",
      "",
      formatCampaignSummary(result.campaign),
    ].join("\n"),
  );
  rememberCampaignMessage(ctx.state, chatId, draftMessage, result.campaign.id, "DRAFT");
  if (result.campaign.approvedText) {
    const actions = await buildDraftActionButtons(ctx, telegramUserId, result.campaign);
    const copyMessage = await ctx.api.sendMessage(chatId, result.campaign.approvedText, {
      replyMarkup: actions,
    });
    rememberCampaignMessage(ctx.state, chatId, copyMessage, result.campaign.id, "DRAFT");
  }
}

export async function publishCampaignToChannel(ctx: TelegramBotContext, campaign: Campaign, telegramUserId: string) {
  const channelUsername = campaign.targetTelegramChannelUsername;
  if (!channelUsername) throw new Error("Campaign target channel is missing.");

  const approvedText = campaign.approvedText?.trim();
  if (!approvedText) throw new Error("Campaign approved ad text is missing.");

  const sentMessage = await ctx.api.sendMessage(channelUsername, approvedText);
  const publicChannelUsername = channelUsername.replace(/^@/, "");
  const postUrl = `https://t.me/${publicChannelUsername}/${sentMessage.message_id}`;
  const verification = await ctx.useCases.submitCampaignPostUrlFromPoster({
    telegramUserId,
    campaignId: campaign.id,
    submittedPostUrl: postUrl,
    observedText: approvedText,
  });

  if (verification.check.status !== "PASSED") {
    throw new Error(verification.check.reason ?? "Bot-published post did not verify");
  }

  return { postUrl, verifiedCampaign: verification.campaign };
}

export async function acceptCampaignAndPublish(ctx: TelegramBotContext, chatId: number, telegramUserId: string, campaignId: string): Promise<void> {
  const campaign = await ctx.useCases.acceptCampaignOffer(telegramUserId, campaignId);
  const advertiser = await ctx.useCases.getUserByWallet(campaign.advertiserWalletAddress);
  const published = await publishCampaignToChannel(ctx, campaign, telegramUserId);
  if (advertiser?.telegramUserId) {
    await ctx.api.sendMessage(
      Number(advertiser.telegramUserId),
      [`Poster accepted ${campaign.id}.`, `The bot published the ad here: ${published.postUrl}`, `Status: ${published.verifiedCampaign?.status ?? "ACTIVE"}`].join("\n"),
    );
  }
  await ctx.api.sendMessage(chatId, ["Offer accepted.", `I posted the approved ad in ${campaign.targetTelegramChannelUsername}.`, published.postUrl, "", "The campaign is now active."].join("\n"));
}

export async function rejectCampaign(ctx: TelegramBotContext, chatId: number, telegramUserId: string, campaignId: string): Promise<void> {
  const campaign = await ctx.useCases.rejectCampaignOffer(telegramUserId, campaignId);
  const advertiser = await ctx.useCases.getUserByWallet(campaign.advertiserWalletAddress);
  if (advertiser?.telegramUserId) {
    await ctx.api.sendMessage(Number(advertiser.telegramUserId), `Poster rejected ${campaign.id}.`);
  }
  await ctx.api.sendMessage(chatId, `Rejected ${campaign.id}.`);
}

export async function counterCampaign(
  ctx: TelegramBotContext,
  chatId: number,
  telegramUserId: string,
  campaignId: string,
  counterMessage: string,
): Promise<void> {
  const wallet = await ctx.useCases.getDevWallet(telegramUserId);
  if (!wallet) throw new Error("No dev wallet exists yet. Use /dev_create_wallet first.");
  const campaign = await ctx.useCases.getCampaign(campaignId);
  if (!campaign) throw new Error("Campaign not found");

  let recipientTelegramUserId: number | null = null;
  let senderRole: "ADVERTISER" | "POSTER";
  let recipientRole: "ADVERTISER" | "POSTER";
  if (campaign.advertiserWalletAddress.toLowerCase() === wallet.address.toLowerCase()) {
    senderRole = "ADVERTISER";
    recipientRole = "POSTER";
    const poster = campaign.posterWalletAddress ? await ctx.useCases.getUserByWallet(campaign.posterWalletAddress) : null;
    recipientTelegramUserId = poster?.telegramUserId ? Number(poster.telegramUserId) : null;
  } else if (campaign.posterWalletAddress?.toLowerCase() === wallet.address.toLowerCase()) {
    senderRole = "POSTER";
    recipientRole = "ADVERTISER";
    const advertiser = await ctx.useCases.getUserByWallet(campaign.advertiserWalletAddress);
    recipientTelegramUserId = advertiser?.telegramUserId ? Number(advertiser.telegramUserId) : null;
  } else {
    throw new Error("Only campaign participants can submit a counteroffer.");
  }
  if (!recipientTelegramUserId) {
    throw new Error("The other party is not linked to Telegram yet.");
  }
  const result = await ctx.useCases.suggestCounterReply(campaignId, counterMessage, { senderRole, recipientRole });
  const updatedCampaign = result.campaign;

  ctx.state.pendingCounterDraftByChat.set(chatId, {
    campaignId: updatedCampaign.id,
    suggestionReply: result.suggestion.reply,
    suggestedAmount: result.suggestion.suggestedAmount,
    suggestedDurationSeconds: result.suggestion.suggestedDurationSeconds,
    recipientTelegramUserId,
    senderTelegramUserId: chatId,
    senderRole,
    recipientRole,
  });

  await ctx.api.sendMessage(
    chatId,
    ["<b>Counteroffer Draft</b>", "", highlightNegotiationTerms(result.suggestion.reply), "", "Review it, then send or revise."].join("\n"),
    { replyMarkup: counterDraftActionButtons(updatedCampaign.id), parseMode: "HTML" },
  );
}

export async function sendPreparedCounterCampaign(ctx: TelegramBotContext, chatId: number, campaignId: string): Promise<void> {
  const draft = ctx.state.pendingCounterDraftByChat.get(chatId);
  if (!draft || draft.campaignId !== campaignId) {
    throw new Error("No counter draft is ready for this campaign. Create a counter first.");
  }

  const campaign = await ctx.useCases.getCampaign(campaignId);
  if (!campaign) throw new Error("Campaign not found");
  const recipientChatId = draft.recipientTelegramUserId;
  await ctx.api.sendMessage(
    recipientChatId,
    [`<b>Counteroffer</b> for <code>${escapeHtml(campaign.id)}</code>:`, "", highlightNegotiationTerms(draft.suggestionReply)].join("\n"),
    { replyMarkup: counterResponseActionButtons(campaign.id), parseMode: "HTML" },
  );

  ctx.state.pendingCounterProposalByChatCampaign.set(counterProposalKey(recipientChatId, campaign.id), {
    campaignId: campaign.id,
    suggestionReply: draft.suggestionReply,
    suggestedAmount: draft.suggestedAmount,
    suggestedDurationSeconds: draft.suggestedDurationSeconds,
    senderTelegramUserId: draft.senderTelegramUserId,
    senderRole: draft.senderRole,
    recipientRole: draft.recipientRole,
  });

  ctx.state.pendingCounterDraftByChat.delete(chatId);
  await ctx.api.sendMessage(chatId, "Counter sent.");
}

export async function acceptCounterProposal(ctx: TelegramBotContext, chatId: number, telegramUserId: string, campaignId: string): Promise<void> {
  const proposal = ctx.state.pendingCounterProposalByChatCampaign.get(counterProposalKey(chatId, campaignId));
  if (!proposal) throw new Error("No counter proposal is pending for this campaign.");
  if (!proposal.suggestedAmount || !proposal.suggestedDurationSeconds) {
    throw new Error("This counter proposal did not include explicit amount and duration. Ask for a revised counter.");
  }

  const campaign = await ctx.useCases.getCampaign(campaignId);
  if (!campaign) throw new Error("Campaign not found");
  const wallet = await ctx.useCases.getDevWallet(telegramUserId);
  if (!wallet) throw new Error("No dev wallet exists yet. Use /dev_create_wallet first.");
  if (proposal.recipientRole === "ADVERTISER") {
    if (campaign.advertiserWalletAddress.toLowerCase() !== wallet.address.toLowerCase()) {
      throw new Error("Only the advertiser can accept this counter proposal.");
    }
  } else if (campaign.posterWalletAddress?.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error("Only the poster can accept this counter proposal.");
  }

  const updated = await ctx.useCases.acceptCounterOffer(campaignId, proposal.suggestedAmount, proposal.suggestedDurationSeconds);
  ctx.state.pendingCounterProposalByChatCampaign.delete(counterProposalKey(chatId, campaignId));
  await ctx.api.sendMessage(chatId, `Counter accepted. Updated campaign:\n${formatCampaignSummary(updated)}`);
  await ctx.api.sendMessage(proposal.senderTelegramUserId, `Your counteroffer for ${updated.id} was accepted.`);
}

export async function rejectCounterProposal(ctx: TelegramBotContext, chatId: number, telegramUserId: string, campaignId: string): Promise<void> {
  const proposal = ctx.state.pendingCounterProposalByChatCampaign.get(counterProposalKey(chatId, campaignId));
  if (!proposal) throw new Error("No counter proposal is pending for this campaign.");
  const campaign = await ctx.useCases.getCampaign(campaignId);
  if (!campaign) throw new Error("Campaign not found");
  const wallet = await ctx.useCases.getDevWallet(telegramUserId);
  if (!wallet) throw new Error("No dev wallet exists yet. Use /dev_create_wallet first.");

  if (proposal.recipientRole === "ADVERTISER") {
    if (campaign.advertiserWalletAddress.toLowerCase() !== wallet.address.toLowerCase()) {
      throw new Error("Only the advertiser can reject this counter proposal.");
    }
    const result = await ctx.useCases.rejectCounterOfferAsAdvertiser(telegramUserId, campaignId);
    ctx.state.pendingCounterProposalByChatCampaign.delete(counterProposalKey(chatId, campaignId));

    await ctx.api.sendMessage(
      proposal.senderTelegramUserId,
      [
        `Advertiser rejected the counteroffer for ${result.campaign.id}.`,
        result.txHash ? `Funds were unlocked back to advertiser balance.\nRefund tx: ${result.txHash}` : "Funds were unlocked back to advertiser balance.",
      ].join("\n"),
    );

    await ctx.api.sendMessage(
      chatId,
      [
        `Counter rejected for ${result.campaign.id}.`,
        result.txHash ? `Funds were unlocked back to advertiser balance.\nRefund tx: ${result.txHash}` : "Funds were unlocked back to advertiser balance.",
      ].join("\n"),
    );
    return;
  }

  if (campaign.posterWalletAddress?.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error("Only the poster can reject this counter proposal.");
  }

  ctx.state.pendingCounterProposalByChatCampaign.delete(counterProposalKey(chatId, campaignId));
  await ctx.api.sendMessage(proposal.senderTelegramUserId, `Poster rejected the counteroffer for ${campaign.id}.`);
  await ctx.api.sendMessage(chatId, `Counter rejected for ${campaign.id}.`);
}

export async function reviseCampaignCopy(ctx: TelegramBotContext, chatId: number, telegramUserId: string, campaignId: string, instruction: string | null): Promise<void> {
  const result = await ctx.useCases.reviseCampaignCopy(campaignId, instruction);
  const revisionMessage = await ctx.api.sendMessage(chatId, `Updated copy for ${result.campaign.id}.`);
  rememberCampaignMessage(ctx.state, chatId, revisionMessage, result.campaign.id, "DRAFT");
  if (result.campaign.approvedText) {
    const actions = await buildDraftActionButtons(ctx, telegramUserId, result.campaign);
    const copyMessage = await ctx.api.sendMessage(chatId, result.campaign.approvedText, {
      replyMarkup: actions,
    });
    rememberCampaignMessage(ctx.state, chatId, copyMessage, result.campaign.id, "DRAFT");
  }
}

export async function resolveSendOfferCampaignId(ctx: TelegramBotContext, telegramUserId: string, message: TelegramMessage, commandCampaignId?: string): Promise<string | null> {
  if (commandCampaignId?.startsWith("cmp_")) return commandCampaignId;

  const replyCampaignId = campaignIdFromReply(ctx.state, message);
  if (replyCampaignId) return replyCampaignId;

  const campaigns = await ctx.useCases.listCampaigns();
  const wallet = await ctx.useCases.getDevWallet(telegramUserId);
  const advertiserWallet = wallet?.address.toLowerCase();
  const pendingUserId = pendingAdvertiserUserId(telegramUserId);
  const candidates = campaigns
    .filter((campaign) => {
      if (!["DRAFT", "AWAITING_FUNDS", "FUNDED"].includes(campaign.status)) return false;
      if (campaign.advertiserUserId === pendingUserId) return true;
      if (advertiserWallet && campaign.advertiserWalletAddress.toLowerCase() === advertiserWallet) return true;
      return false;
    })
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  return candidates.length === 1 ? candidates[0].id : null;
}

export async function sendOfferFromCampaignId(ctx: TelegramBotContext, chatId: number, telegramUserId: string, campaignId: string): Promise<void> {
  const existingWallet = await ctx.useCases.getDevWallet(telegramUserId);
  if (!existingWallet) {
    await ctx.api.sendMessage(
      chatId,
      [
        "The campaign draft is ready. Before I can send it to the publisher, we need a wallet for the funded offer.",
        "",
        'Click "Create Wallet", add funds, then send offer again.',
      ].join("\n"),
      {
        replyMarkup: {
          inline_keyboard: [[{ text: "Create Wallet", callback_data: "dev:create_wallet" }]],
        },
      },
    );
    return;
  }
  await sendDevWalletOverview(ctx, chatId, telegramUserId);
  const result = await ctx.useCases.fundDevCampaignAndMarkOffered(telegramUserId, campaignId);
  const campaign = result.campaign;
  const poster = campaign.posterWalletAddress ? await ctx.useCases.getUserByWallet(campaign.posterWalletAddress) : null;
  if (!poster?.telegramUserId) throw new Error("Poster Telegram account is not linked.");

  const offerMessage = await ctx.api.sendMessage(
    Number(poster.telegramUserId),
    [
      `<b>Offer for ${escapeHtml(campaign.targetTelegramChannelUsername ?? "this channel")}</b>`,
      "",
      `<b>Amount:</b> ${escapeHtml(campaign.amount)}`,
      `<b>Duration:</b> ${escapeHtml(formatDuration(campaign.durationSeconds))}`,
      `<b>Rule:</b> Publish the approved copy exactly and keep it live for the full duration.`,
      "Payment condition: payment is made only after the post is verified to match the approved content and remain live for the required duration.",
      "",
      "Approved ad copy is in the next message so it is easy to copy on mobile.",
    ].join("\n"),
    { parseMode: "HTML" },
  );
  rememberCampaignMessage(ctx.state, Number(poster.telegramUserId), offerMessage, campaign.id, "OFFER");
  if (campaign.approvedText) {
    const copyMessage = await ctx.api.sendMessage(Number(poster.telegramUserId), campaign.approvedText, {
      replyMarkup: offerActionButtons(campaign.id),
    });
    rememberCampaignMessage(ctx.state, Number(poster.telegramUserId), copyMessage, campaign.id, "OFFER");
  }
  await ctx.api.sendMessage(
    chatId,
    [
      result.funding ? `Funds locked for ${campaign.id}. On-chain campaign: ${result.funding.onchainCampaignId.toString()}` : `Funds were already locked for ${campaign.id}.`,
      `Offer sent to @${campaign.targetTelegramChannelUsername?.replace(/^@/, "") ?? "poster"}.`,
      "",
      "Signed authorization:",
      result.funding?.authorizationMessage ?? "Already funded earlier.",
      result.funding ? `Signature: ${result.funding.authorizationSignature}` : null,
      result.funding ? `Tx: ${result.funding.txHash}` : null,
    ]
      .filter((line): line is string => line !== null)
      .join("\n"),
  );
}

export async function showCampaigns(ctx: TelegramBotContext, chatId: number): Promise<void> {
  const campaigns = await ctx.useCases.listCampaigns();
  if (campaigns.length === 0) {
    await ctx.api.sendMessage(chatId, "No campaigns yet.");
    return;
  }

  await ctx.api.sendMessage(
    chatId,
    campaigns
      .slice(0, 10)
      .map((campaign) => `${campaign.id}: ${campaign.amount} for ${campaign.targetTelegramChannelUsername ?? "no channel"} (${campaign.status})`)
      .join("\n"),
  );
}

export async function promptCampaignDraft(ctx: TelegramBotContext, chatId: number): Promise<void> {
  await sendPromptForReply(ctx, chatId, campaignOpeningPrompt(), "CAMPAIGN_DRAFT", {
    placeholder: "Promote ... on @channel for ...",
  });
}

export async function promptRegisterChannel(ctx: TelegramBotContext, chatId: number): Promise<void> {
  await sendPromptForReply(ctx, chatId, "Reply to this message with the channel username you want to register.\nExample: @exampleChannel", "REGISTER_CHANNEL", {
    placeholder: "@exampleChannel",
  });
}

export async function fundCampaignOnly(ctx: TelegramBotContext, chatId: number, telegramUserId: string, campaignId: string): Promise<void> {
  const result = await ctx.useCases.fundDevCampaignFromBalance(telegramUserId, campaignId);
  await ctx.api.sendMessage(
    chatId,
    [`Funds locked for ${result.campaign.id}.`, `On-chain campaign: ${result.onchainCampaignId.toString()}`, `Tx: ${result.txHash}`, "", `Next: /send_offer ${result.campaign.id}`].join("\n"),
  );
}

export async function acceptCounterOffer(ctx: TelegramBotContext, chatId: number, campaignId: string, amount: string, duration: string): Promise<void> {
  const campaign = await ctx.useCases.acceptCounterOffer(campaignId, amount, parseDuration(duration));
  const poster = campaign.posterWalletAddress ? await ctx.useCases.getUserByWallet(campaign.posterWalletAddress) : null;
  if (poster?.telegramUserId) {
    await ctx.api.sendMessage(
      Number(poster.telegramUserId),
      `Advertiser accepted updated terms for ${campaign.id}: ${campaign.amount} for ${formatDuration(campaign.durationSeconds)}.\n\n/send_offer ${campaign.id} will resend the final offer.`,
    );
  }
  await ctx.api.sendMessage(chatId, `Counter accepted. Updated campaign is back in OFFERED-ready state:\n${formatCampaignSummary(campaign)}`);
}

export function offerReplyAction(text: string): "ACCEPT" | "REJECT" | "COUNTER" {
  const normalized = text.toLowerCase();
  if (["accept", "accepted", "yes", "ok", "okay"].includes(normalized)) return "ACCEPT";
  if (["reject", "decline", "declined", "no"].includes(normalized)) return "REJECT";
  return "COUNTER";
}

import { TelegramBotContext } from "./context";
import { fetchTelegramPostHtml, parseTelegramPostUrl } from "./postUtils";

export async function registerChannelFromText(ctx: TelegramBotContext, chatId: number, telegramUserId: string, rawInput: string): Promise<void> {
  const telegramChannelUsername = rawInput.trim();
  if (!/^@[a-zA-Z0-9_]{5,}$/.test(telegramChannelUsername)) {
    await ctx.api.sendMessage(chatId, "Please send a valid channel username, for example @exampleChannel.");
    return;
  }

  if (!ctx.config.custodialDevMode) {
    await ctx.api.sendMessage(chatId, `Channel registration in bot is enabled in dev mode only right now. Use ${ctx.config.clientUrl} for wallet linking first.`);
    return;
  }

  const wallet = await ctx.useCases.ensureDevWallet(telegramUserId);
  const user = await ctx.useCases.upsertUser({
    walletAddress: wallet.address,
    telegramUserId,
  });

  const registration = await ctx.useCases.registerChannel({
    ownerUserId: user.id,
    telegramChannelUsername,
  });
  const channel = registration.channel;

  if (registration.status === "ALREADY_VERIFIED") {
    await ctx.api.sendMessage(chatId, `This channel is already verified: @${channel.telegramChannelUsername}`);
    return;
  }

  ctx.state.pendingChannelVerification.set(chatId, channel.id);

  if (registration.status === "PENDING_EXISTS") {
    await ctx.api.sendMessage(
      chatId,
      [
        `Channel registration is already pending for ${telegramChannelUsername}.`,
        `Verification code: ${channel.verificationCode}`,
        "",
        "Post this exact code in the channel, then submit the public post URL.",
      ].join("\n"),
    );
    return;
  }

  await ctx.api.sendMessage(
    chatId,
    [
      `Channel registration created for ${telegramChannelUsername}.`,
      `Verification code: ${channel.verificationCode}`,
      "",
      "Post this exact code in the channel, then submit the public post URL (verification step wiring is next).",
    ].join("\n"),
  );
}

export async function verifyChannelFromPostUrl(ctx: TelegramBotContext, chatId: number, telegramUserId: string, postUrl: string): Promise<boolean> {
  if (!ctx.config.custodialDevMode) {
    await ctx.api.sendMessage(chatId, "Channel verification in bot is currently enabled in dev mode only.");
    return false;
  }

  const wallet = await ctx.useCases.ensureDevWallet(telegramUserId);
  const user = await ctx.useCases.getUserByWallet(wallet.address);
  if (!user) {
    await ctx.api.sendMessage(chatId, "Please create a dev wallet first with /dev_create_wallet.");
    return false;
  }

  const channels = await ctx.useCases.listChannels(user.id);
  const pendingChannelId = ctx.state.pendingChannelVerification.get(chatId);
  const pendingChannel =
    (pendingChannelId ? channels.find((channel) => channel.id === pendingChannelId) : null) ??
    channels.filter((channel) => channel.status === "PENDING").sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];

  if (!pendingChannel) {
    await ctx.api.sendMessage(chatId, "No pending channel verification found. Use /register_channel first.");
    return false;
  }

  const expectedChannel = pendingChannel.telegramChannelUsername?.replace(/^@/, "").toLowerCase();
  if (!expectedChannel || !pendingChannel.verificationCode) {
    await ctx.api.sendMessage(chatId, "Channel verification data is missing. Please register the channel again.");
    return false;
  }

  const urlParts = parseTelegramPostUrl(postUrl);
  if (!urlParts) {
    await ctx.api.sendMessage(chatId, "That is not a valid public Telegram post URL.");
    return false;
  }

  if (urlParts.channel.toLowerCase() !== expectedChannel) {
    await ctx.api.sendMessage(chatId, `URL channel does not match @${expectedChannel}.`);
    return false;
  }

  const html = await fetchTelegramPostHtml(postUrl);
  if (!html) {
    await ctx.api.sendMessage(chatId, "Could not fetch the post for verification. Make sure the channel and post are public.");
    return false;
  }

  if (!html.includes(pendingChannel.verificationCode)) {
    await ctx.api.sendMessage(chatId, "Verification code was not found in that post. Please post the exact code and resend URL.");
    return false;
  }

  await ctx.useCases.verifyChannel(pendingChannel.id, postUrl);
  ctx.state.pendingChannelVerification.delete(chatId);
  await ctx.api.sendMessage(chatId, `Channel verified: @${expectedChannel}`);
  return true;
}

import { AppUseCases } from '../../application/useCases/createAppUseCases';
import { AppConfig } from '../../config';
import { Campaign } from '../../domain/types';
import { formatDevTokenAmount, formatDevUsdcAmount, parseDevUsdcAmount } from '../blockchain/viem/devWalletGateway';

type TelegramChat = {
  id: number;
  username?: string;
};

type TelegramUser = {
  id: number;
};

type TelegramMessage = {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  reply_to_message?: TelegramMessage;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
};

type TelegramResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

type CampaignMessagePurpose = 'DRAFT' | 'OFFER';

export type TelegramLongPollingBot = {
  stop(): void;
};

export function startTelegramLongPollingBot(config: AppConfig, useCases: AppUseCases): TelegramLongPollingBot {
  if (!config.telegramBotToken) {
    console.log('[telegram]: TELEGRAM_BOT_TOKEN missing; long polling disabled');
    return { stop() {} };
  }

  let stopped = false;
  let offset = 0;
  const pendingChannelRegistration = new Set<number>();
  const pendingChannelVerification = new Map<number, string>();
  const pendingCampaignDraft = new Set<number>();
  const campaignByMessage = new Map<string, { campaignId: string; purpose: CampaignMessagePurpose }>();
  const balanceWatchers = new Map<number, { telegramUserId: string; lastSignature: string }>();
  const apiBaseUrl = `https://api.telegram.org/bot${config.telegramBotToken}`;
  let balanceMonitorRunning = false;

  async function requestTelegram<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${apiBaseUrl}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const payload = (await response.json()) as TelegramResponse<T>;
    if (!payload.ok || payload.result === undefined) {
      throw new Error(payload.description ?? `Telegram ${method} failed`);
    }

    return payload.result;
  }

  async function sendMessage(chatId: number | string, text: string): Promise<TelegramMessage> {
    return await requestTelegram<TelegramMessage>('sendMessage', {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    });
  }

  function rememberCampaignMessage(chatId: number, message: TelegramMessage, campaignId: string, purpose: CampaignMessagePurpose): void {
    campaignByMessage.set(`${chatId}:${message.message_id}`, { campaignId, purpose });
  }

  function campaignContextFromReply(message: TelegramMessage): { campaignId: string; purpose: CampaignMessagePurpose } | null {
    const reply = message.reply_to_message;
    if (!reply) return null;
    return campaignByMessage.get(`${message.chat.id}:${reply.message_id}`) ?? null;
  }

  function campaignIdFromReply(message: TelegramMessage): string | null {
    return campaignContextFromReply(message)?.campaignId ?? null;
  }

  async function runDevCommand(chatId: number, action: () => Promise<void>): Promise<void> {
    if (!config.custodialDevMode) {
      await sendMessage(chatId, 'Dev custodial wallet mode is off.');
      return;
    }

    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[telegram]: dev command failed', message);
      await sendMessage(chatId, `Dev command failed: ${message}`);
    }
  }

  async function sendDevWalletOverview(chatId: number, telegramUserId: string): Promise<boolean> {
    const wallet = await useCases.getDevWallet(telegramUserId);
    if (!wallet) {
      await sendMessage(
        chatId,
        [
          'No wallet is linked to this Telegram account yet.',
          'When you are ready to send a funded offer, I will ask you to create one with /dev_create_wallet.',
        ].join('\n'),
      );
      return false;
    }

    try {
      const overview = await useCases.getDevWalletMajorBalances(telegramUserId);
      balanceWatchers.set(chatId, {
        telegramUserId,
        lastSignature: balanceSignature(overview.balances),
      });
      await sendMessage(
        chatId,
        [
          `Wallet: ${overview.wallet.address}`,
          `Provider: ${overview.wallet.provider}`,
          '',
          'Balances:',
          ...formatMajorBalances(overview.balances),
        ].join('\n'),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'balance lookup failed';
      await sendMessage(
        chatId,
        [
          `Wallet: ${wallet.address}`,
          `Provider: ${wallet.provider}`,
          '',
          `I could not read balances yet: ${message}`,
        ].join('\n'),
      );
    }

    return true;
  }

  async function pollKnownBalances(): Promise<void> {
    if (balanceMonitorRunning) return;
    balanceMonitorRunning = true;

    try {
      for (const [chatId, watcher] of balanceWatchers) {
        try {
          const overview = await useCases.getDevWalletMajorBalances(watcher.telegramUserId);
          const signature = balanceSignature(overview.balances);
          if (signature === watcher.lastSignature) continue;

          balanceWatchers.set(chatId, { ...watcher, lastSignature: signature });
          await sendMessage(
            chatId,
            [
              'Balance updated.',
              '',
              `Wallet: ${overview.wallet.address}`,
              '',
              ...formatMajorBalances(overview.balances),
            ].join('\n'),
          );
        } catch (error) {
          console.error('[telegram]: balance monitor failed', error instanceof Error ? error.message : error);
        }
      }
    } finally {
      balanceMonitorRunning = false;
    }
  }

  async function registerChannelFromText(chatId: number, telegramUserId: string, rawInput: string): Promise<void> {
    const telegramChannelUsername = rawInput.trim();
    if (!/^@[a-zA-Z0-9_]{5,}$/.test(telegramChannelUsername)) {
      await sendMessage(chatId, 'Please send a valid channel username, for example @exampleChannel.');
      return;
    }

    if (!config.custodialDevMode) {
      await sendMessage(chatId, `Channel registration in bot is enabled in dev mode only right now. Use ${config.clientUrl} for wallet linking first.`);
      return;
    }

    const wallet = await useCases.ensureDevWallet(telegramUserId);
    const user = await useCases.upsertUser({
      walletAddress: wallet.address,
      telegramUserId,
    });

    const registration = await useCases.registerChannel({
      ownerUserId: user.id,
      telegramChannelUsername,
    });
    const channel = registration.channel;

    if (registration.status === 'ALREADY_VERIFIED') {
      await sendMessage(chatId, `This channel is already verified: @${channel.telegramChannelUsername}`);
      return;
    }

    pendingChannelVerification.set(chatId, channel.id);

    if (registration.status === 'PENDING_EXISTS') {
      await sendMessage(
        chatId,
        [
          `Channel registration is already pending for ${telegramChannelUsername}.`,
          `Verification code: ${channel.verificationCode}`,
          '',
          'Post this exact code in the channel, then submit the public post URL.',
        ].join('\n'),
      );
      return;
    }

    await sendMessage(
      chatId,
      [
        `Channel registration created for ${telegramChannelUsername}.`,
        `Verification code: ${channel.verificationCode}`,
        '',
        'Post this exact code in the channel, then submit the public post URL (verification step wiring is next).',
      ].join('\n'),
    );
  }

  async function verifyChannelFromPostUrl(chatId: number, telegramUserId: string, postUrl: string): Promise<boolean> {
    if (!config.custodialDevMode) {
      await sendMessage(chatId, 'Channel verification in bot is currently enabled in dev mode only.');
      return false;
    }

    const wallet = await useCases.ensureDevWallet(telegramUserId);
    const user = await useCases.getUserByWallet(wallet.address);
    if (!user) {
      await sendMessage(chatId, 'Please create a dev wallet first with /dev_create_wallet.');
      return false;
    }

    const channels = await useCases.listChannels(user.id);
    const pendingChannelId = pendingChannelVerification.get(chatId);
    const pendingChannel =
      (pendingChannelId ? channels.find((channel) => channel.id === pendingChannelId) : null) ??
      channels
        .filter((channel) => channel.status === 'PENDING')
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];

    if (!pendingChannel) {
      await sendMessage(chatId, 'No pending channel verification found. Use /register_channel first.');
      return false;
    }

    const expectedChannel = pendingChannel.telegramChannelUsername?.replace(/^@/, '').toLowerCase();
    if (!expectedChannel || !pendingChannel.verificationCode) {
      await sendMessage(chatId, 'Channel verification data is missing. Please register the channel again.');
      return false;
    }

    const urlParts = parseTelegramPostUrl(postUrl);
    if (!urlParts) {
      await sendMessage(chatId, 'That is not a valid public Telegram post URL.');
      return false;
    }

    if (urlParts.channel.toLowerCase() !== expectedChannel) {
      await sendMessage(chatId, `URL channel does not match @${expectedChannel}.`);
      return false;
    }

    const html = await fetchTelegramPostHtml(postUrl);
    if (!html) {
      await sendMessage(chatId, 'Could not fetch the post for verification. Make sure the channel and post are public.');
      return false;
    }

    if (!html.includes(pendingChannel.verificationCode)) {
      await sendMessage(chatId, 'Verification code was not found in that post. Please post the exact code and resend URL.');
      return false;
    }

    await useCases.verifyChannel(pendingChannel.id, postUrl);
    pendingChannelVerification.delete(chatId);
    await sendMessage(chatId, `Channel verified: @${expectedChannel}`);
    return true;
  }

  async function verifyCampaignPostFromUrl(chatId: number, telegramUserId: string, postUrl: string): Promise<boolean> {
    if (!config.custodialDevMode) {
      await sendMessage(chatId, 'Campaign post verification in bot is currently enabled in dev mode only.');
      return false;
    }

    const urlParts = parseTelegramPostUrl(postUrl);
    if (!urlParts) return false;

    const campaign = await useCases.findAwaitingPostCampaignForPoster(telegramUserId, urlParts.channel);
    if (!campaign) return false;

    const html = await fetchTelegramPostHtml(postUrl);
    if (!html) {
      await sendMessage(chatId, 'Could not fetch the post. Make sure the channel and post are public.');
      return true;
    }

    const observedText = extractTelegramPostText(html);
    const result = await useCases.submitCampaignPostUrlFromPoster({
      telegramUserId,
      campaignId: campaign.id,
      submittedPostUrl: postUrl,
      observedText,
    });
    const advertiser = result.campaign?.advertiserWalletAddress
      ? await useCases.getUserByWallet(result.campaign.advertiserWalletAddress)
      : null;

    if (result.check.status === 'PASSED') {
      await sendMessage(
        chatId,
        [
          `Post verified for ${campaign.id}.`,
          'The campaign is now active. I will use this URL for final checks later.',
        ].join('\n'),
      );
      if (advertiser?.telegramUserId) {
        await sendMessage(Number(advertiser.telegramUserId), `The poster submitted and verified the post for ${campaign.id}:\n${postUrl}`);
      }
      return true;
    }

    await sendMessage(
      chatId,
      [
        `Post verification failed for ${campaign.id}.`,
        result.check.reason ?? 'The post did not match the approved ad.',
        '',
        'Please publish the approved text exactly and send the post URL again.',
      ].join('\n'),
    );
    if (advertiser?.telegramUserId) {
      await sendMessage(Number(advertiser.telegramUserId), `Post verification failed for ${campaign.id}: ${result.check.reason ?? 'unknown reason'}`);
    }
    return true;
  }

  async function createCampaignDraftFromText(chatId: number, telegramUserId: string, rawInput: string): Promise<void> {
    if (!config.custodialDevMode) {
      await sendMessage(chatId, `Campaign drafting in the bot is enabled in dev mode only right now. Use ${config.clientUrl} for wallet actions.`);
      return;
    }

    const token = resolveRequestedToken(rawInput, config);
    if (!token) {
      await sendMessage(chatId, 'That currency is not configured yet. For now, use USDC or set the matching token address in server/.env.');
      return;
    }

    const result = await useCases.createCampaignDraftFromMessage({
      advertiserUserId: pendingAdvertiserUserId(telegramUserId),
      advertiserWalletAddress: pendingAdvertiserWalletAddress(telegramUserId),
      tokenAddress: token.address,
      message: rawInput,
    });

    if (result.status === 'BLOCKED') {
      await sendMessage(
        chatId,
        [
          'I cannot create that campaign yet because the content looks risky.',
          ...result.recommendation.safety.reasons.map((reason) => `- ${reason}`),
          ...result.recommendation.safety.suggestedFixes.map((fix) => `Fix: ${fix}`),
        ].join('\n'),
      );
      return;
    }

    if (result.status === 'NEEDS_INPUT') {
      pendingCampaignDraft.add(chatId);
      await sendMessage(
        chatId,
        [
          'Almost. I need a little more detail before I can draft the ad.',
          `Still missing: ${formatMissingFields(result.recommendation.intake.missingFields)}`,
          '',
          'Send it in one message when you are ready.',
          'Example: Promote Grandma Ads on @openagents2026 for 100 USDC for 24 hours. Caption: Sponsored posts with escrow, without spreadsheets.',
        ].join('\n'),
      );
      return;
    }

    if (result.status === 'CHANNEL_NOT_VERIFIED') {
      await sendMessage(chatId, 'That target channel is not verified yet. Ask the channel owner to use /register_channel first.');
      return;
    }

    if (result.status === 'POSTER_NOT_FOUND') {
      await sendMessage(chatId, 'The target channel is verified, but I could not find the poster account. Please re-register the channel.');
      return;
    }

    const draftMessage = await sendMessage(
      chatId,
      [
        'Campaign draft created.',
        '',
        formatCampaignSummary(result.campaign),
        '',
        'Recommended copy is in the next message so it is easy to copy on mobile.',
        '',
        `Next: /revise_copy ${result.campaign.id} make it more direct`,
        `Confirm and send funded offer: /send_offer ${result.campaign.id}`,
      ].join('\n'),
    );
    rememberCampaignMessage(chatId, draftMessage, result.campaign.id, 'DRAFT');
    if (result.campaign.approvedText) {
      const copyMessage = await sendMessage(chatId, result.campaign.approvedText);
      rememberCampaignMessage(chatId, copyMessage, result.campaign.id, 'DRAFT');
    }
  }

  async function publishCampaignToChannel(campaign: Campaign, telegramUserId: string) {
    const channelUsername = campaign.targetTelegramChannelUsername;
    if (!channelUsername) throw new Error('Campaign target channel is missing.');

    const approvedText = campaign.approvedText?.trim();
    if (!approvedText) throw new Error('Campaign approved ad text is missing.');

    const sentMessage = await sendMessage(channelUsername, approvedText);
    const publicChannelUsername = channelUsername.replace(/^@/, '');
    const postUrl = `https://t.me/${publicChannelUsername}/${sentMessage.message_id}`;
    const verification = await useCases.submitCampaignPostUrlFromPoster({
      telegramUserId,
      campaignId: campaign.id,
      submittedPostUrl: postUrl,
      observedText: approvedText,
    });

    if (verification.check.status !== 'PASSED') {
      throw new Error(verification.check.reason ?? 'Bot-published post did not verify');
    }

    return { postUrl, verifiedCampaign: verification.campaign };
  }

  async function handleChannelPost(message: TelegramMessage, isEdited: boolean): Promise<void> {
    const channelUsername = message.chat.username;
    if (!channelUsername) return;

    const observedText = getMessageText(message);
    if (!observedText) return;

    if (!isEdited) {
      const campaign = await useCases.findCampaignBySubmittedPost(channelUsername, String(message.message_id));
      if (campaign) {
        console.log(`[telegram]: observed campaign channel post ${campaign.id} in @${channelUsername}/${message.message_id}`);
      }
      return;
    }

    const result = await useCases.handleObservedCampaignPostEdit({
      channelUsername,
      messageId: String(message.message_id),
      observedText,
    });
    if (!result) return;
    if (result.status === 'UNCHANGED') return;

    const advertiser = await useCases.getUserByWallet(result.campaign.advertiserWalletAddress);
    const poster = result.campaign.posterWalletAddress ? await useCases.getUserByWallet(result.campaign.posterWalletAddress) : null;
    const notice = [
      `Campaign ${result.campaign.id} changed after it was active.`,
      result.result.reason ?? 'The post no longer matches the approved ad.',
      result.txHash ? `Refund tx: ${result.txHash}` : 'Refund transaction was not sent because there is no on-chain campaign id.',
    ].join('\n');

    if (advertiser?.telegramUserId) await sendMessage(Number(advertiser.telegramUserId), notice);
    if (poster?.telegramUserId) await sendMessage(Number(poster.telegramUserId), notice);
  }

  async function acceptCampaignAndPublish(chatId: number, telegramUserId: string, campaignId: string): Promise<void> {
    const campaign = await useCases.acceptCampaignOffer(telegramUserId, campaignId);
    const advertiser = await useCases.getUserByWallet(campaign.advertiserWalletAddress);
    const published = await publishCampaignToChannel(campaign, telegramUserId);
    if (advertiser?.telegramUserId) {
      await sendMessage(
        Number(advertiser.telegramUserId),
        [
          `Poster accepted ${campaign.id}.`,
          `The bot published the ad here: ${published.postUrl}`,
          `Status: ${published.verifiedCampaign?.status ?? 'ACTIVE'}`,
        ].join('\n'),
      );
    }
    await sendMessage(
      chatId,
      [
        'Offer accepted.',
        `I posted the approved ad in ${campaign.targetTelegramChannelUsername}.`,
        published.postUrl,
        '',
        'The campaign is now active.',
      ].join('\n'),
    );
  }

  async function rejectCampaign(chatId: number, telegramUserId: string, campaignId: string): Promise<void> {
    const campaign = await useCases.rejectCampaignOffer(telegramUserId, campaignId);
    const advertiser = await useCases.getUserByWallet(campaign.advertiserWalletAddress);
    if (advertiser?.telegramUserId) {
      await sendMessage(Number(advertiser.telegramUserId), `Poster rejected ${campaign.id}.`);
    }
    await sendMessage(chatId, `Rejected ${campaign.id}.`);
  }

  async function counterCampaign(chatId: number, campaignId: string, counterMessage: string): Promise<void> {
    const result = await useCases.suggestCounterReply(campaignId, counterMessage);
    const advertiser = await useCases.getUserByWallet(result.campaign.advertiserWalletAddress);
    if (advertiser?.telegramUserId) {
      await sendMessage(
        Number(advertiser.telegramUserId),
        [
          `Counteroffer for ${result.campaign.id}:`,
          '',
          result.suggestion.reply,
          '',
          `To accept manually: /accept_counter ${result.campaign.id} <amount> <duration>`,
        ].join('\n'),
      );
    }
    await sendMessage(chatId, 'Counter sent to the advertiser.');
  }

  async function reviseCampaignCopy(chatId: number, campaignId: string, instruction: string | null): Promise<void> {
    const result = await useCases.reviseCampaignCopy(campaignId, instruction);
    const revisionMessage = await sendMessage(
      chatId,
      [
        `Updated copy for ${result.campaign.id}.`,
        '',
        'The new copy is in the next message so it is easy to copy on mobile.',
        `Why: ${result.suggestion.rationale}`,
      ].join('\n'),
    );
    rememberCampaignMessage(chatId, revisionMessage, result.campaign.id, 'DRAFT');
    if (result.campaign.approvedText) {
      const copyMessage = await sendMessage(chatId, result.campaign.approvedText);
      rememberCampaignMessage(chatId, copyMessage, result.campaign.id, 'DRAFT');
    }
  }

  async function handleMessage(message: TelegramMessage): Promise<void> {
    const text = message.text?.trim() ?? '';
    const chatId = message.chat.id;
    const telegramUserId = String(message.from?.id ?? chatId);

    if (pendingCampaignDraft.has(chatId) && !text.startsWith('/')) {
      pendingCampaignDraft.delete(chatId);
      await createCampaignDraftFromText(chatId, telegramUserId, text);
      return;
    }

    if (pendingChannelRegistration.has(chatId) && text.startsWith('@')) {
      pendingChannelRegistration.delete(chatId);
      await registerChannelFromText(chatId, telegramUserId, text);
      return;
    }

    if (isTelegramPostUrl(text)) {
      const campaignHandled = await verifyCampaignPostFromUrl(chatId, telegramUserId, text);
      if (campaignHandled) return;

      const handled = await verifyChannelFromPostUrl(chatId, telegramUserId, text);
      if (handled) return;
    }

    const replyCampaignContext = campaignContextFromReply(message);
    if (replyCampaignContext && text && !text.startsWith('/')) {
      await runDevCommand(chatId, async () => {
        if (replyCampaignContext.purpose === 'DRAFT') {
          await reviseCampaignCopy(chatId, replyCampaignContext.campaignId, text);
          return;
        }

        const normalized = text.toLowerCase();
        if (['accept', 'accepted', 'yes', 'ok', 'okay'].includes(normalized)) {
          await acceptCampaignAndPublish(chatId, telegramUserId, replyCampaignContext.campaignId);
          return;
        }
        if (['reject', 'decline', 'declined', 'no'].includes(normalized)) {
          await rejectCampaign(chatId, telegramUserId, replyCampaignContext.campaignId);
          return;
        }
        await counterCampaign(chatId, replyCampaignContext.campaignId, text);
      });
      return;
    }

    if (text.startsWith('/start')) {
      pendingCampaignDraft.add(chatId);
      await sendMessage(chatId, campaignOpeningPrompt());
      return;
    }

    if (text.startsWith('/help')) {
      await sendMessage(
        chatId,
        [
          'Available commands:',
          '/start - Open the bot intro',
          '/link - Link your wallet from the web app',
          '/register_channel - Register a Telegram channel',
          '/new_campaign - Draft a sponsored post campaign',
          '/campaign_draft <details> - Draft a campaign in one message',
          '/revise_copy <campaignId> <instruction> - Improve approved ad copy',
          '/send_offer <campaignId> - Lock funds and send offer to the poster',
          '/fund_campaign <campaignId> - Lock funds only',
          '/accept <campaignId>, /reject <campaignId>, /counter <campaignId> <terms>',
          '/my_campaigns - View campaign status',
          '/balance - Check your ad balance in the web app',
          '',
          config.custodialDevMode
            ? 'Dev wallet commands: /dev_create_wallet, /dev_balance, /dev_mint 1000, /dev_deposit 100, /dev_withdraw 25, /sign hello'
            : 'Dev wallet mode is off.',
        ].join('\n'),
      );
      return;
    }

    if (text.startsWith('/new_campaign')) {
      pendingCampaignDraft.add(chatId);
      await sendMessage(chatId, campaignOpeningPrompt());
      return;
    }

    if (text.startsWith('/campaign_draft')) {
      const details = text.replace(/^\/campaign_draft(?:@\w+)?\s*/i, '').trim();
      if (!details) {
        await sendMessage(chatId, 'Send details after the command, like /campaign_draft Promote my app on @channel for 100 USDC for 24 hours.');
        return;
      }

      await createCampaignDraftFromText(chatId, telegramUserId, details);
      return;
    }

    if (text.startsWith('/revise_copy')) {
      await runDevCommand(chatId, async () => {
        const [, firstArg, ...restArgs] = text.split(/\s+/);
        const firstArgLooksLikeCampaign = Boolean(firstArg?.startsWith('cmp_'));
        const campaignId = firstArgLooksLikeCampaign ? firstArg : campaignIdFromReply(message);
        const instruction = (firstArgLooksLikeCampaign ? restArgs : [firstArg, ...restArgs]).filter(Boolean).join(' ');
        if (!campaignId) throw new Error('Usage: /revise_copy <campaignId> <instruction>');
        await reviseCampaignCopy(chatId, campaignId, instruction || null);
      });
      return;
    }

    if (text.startsWith('/fund_campaign')) {
      await runDevCommand(chatId, async () => {
        const [, campaignId] = text.split(/\s+/);
        if (!campaignId) throw new Error('Usage: /fund_campaign <campaignId>');
        const result = await useCases.fundDevCampaignFromBalance(telegramUserId, campaignId);
        await sendMessage(
          chatId,
          [
            `Funds locked for ${result.campaign.id}.`,
            `On-chain campaign: ${result.onchainCampaignId.toString()}`,
            `Tx: ${result.txHash}`,
            '',
            `Next: /send_offer ${result.campaign.id}`,
          ].join('\n'),
        );
      });
      return;
    }

    if (text.startsWith('/send_offer')) {
      await runDevCommand(chatId, async () => {
        const [, campaignIdFromCommand] = text.split(/\s+/);
        const campaignId = campaignIdFromCommand?.startsWith('cmp_') ? campaignIdFromCommand : campaignIdFromReply(message);
        if (!campaignId) throw new Error('Usage: /send_offer <campaignId>');
        const existingWallet = await useCases.getDevWallet(telegramUserId);
        if (!existingWallet) {
          await sendMessage(
            chatId,
            [
              'The campaign draft is ready. Before I can send it to the publisher, we need a wallet for the funded offer.',
              '',
              'Run /dev_create_wallet, add funds, then come back with:',
              `/send_offer ${campaignId}`,
            ].join('\n'),
          );
          return;
        }
        await sendDevWalletOverview(chatId, telegramUserId);
        const result = await useCases.fundDevCampaignAndMarkOffered(telegramUserId, campaignId);
        const campaign = result.campaign;
        const offer = await useCases.generatePosterOffer(campaign.id);
        const poster = campaign.posterWalletAddress ? await useCases.getUserByWallet(campaign.posterWalletAddress) : null;
        if (!poster?.telegramUserId) throw new Error('Poster Telegram account is not linked.');
        const authorizationMessage = formatOfferAuthorization(campaign);
        const authorization = await useCases.signDevWalletMessage(telegramUserId, authorizationMessage);

        const offerMessage = await sendMessage(
          Number(poster.telegramUserId),
          [
            offer ?? formatCampaignSummary(campaign),
            '',
            'Approved ad copy is in the next message so it is easy to copy on mobile.',
            '',
            `Accept: /accept ${campaign.id}`,
            `Reject: /reject ${campaign.id}`,
            `Counter: reply to this message with your terms, or use /counter ${campaign.id} 150 USDC for 24h`,
          ].join('\n'),
        );
        rememberCampaignMessage(Number(poster.telegramUserId), offerMessage, campaign.id, 'OFFER');
        if (campaign.approvedText) {
          const copyMessage = await sendMessage(Number(poster.telegramUserId), campaign.approvedText);
          rememberCampaignMessage(Number(poster.telegramUserId), copyMessage, campaign.id, 'OFFER');
        }
        await sendMessage(
          chatId,
          [
            result.funding
              ? `Funds locked for ${campaign.id}. On-chain campaign: ${result.funding.onchainCampaignId.toString()}`
              : `Funds were already locked for ${campaign.id}.`,
            `Offer sent to @${campaign.targetTelegramChannelUsername?.replace(/^@/, '') ?? 'poster'}.`,
            '',
            'Signed authorization:',
            authorization.message,
            `Signature: ${authorization.signature}`,
            result.funding ? `Tx: ${result.funding.txHash}` : null,
          ]
            .filter((line): line is string => line !== null)
            .join('\n'),
        );
      });
      return;
    }

    if (text.startsWith('/accept_counter')) {
      await runDevCommand(chatId, async () => {
        const [, campaignId, amount, duration] = text.split(/\s+/);
        if (!campaignId || !amount || !duration) throw new Error('Usage: /accept_counter <campaignId> <amount> <duration>');
        const campaign = await useCases.acceptCounterOffer(campaignId, amount, parseDuration(duration));
        const poster = campaign.posterWalletAddress ? await useCases.getUserByWallet(campaign.posterWalletAddress) : null;
        if (poster?.telegramUserId) {
          await sendMessage(Number(poster.telegramUserId), `Advertiser accepted updated terms for ${campaign.id}: ${campaign.amount} for ${formatDuration(campaign.durationSeconds)}.\n\n/send_offer ${campaign.id} will resend the final offer.`);
        }
        await sendMessage(chatId, `Counter accepted. Updated campaign is back in OFFERED-ready state:\n${formatCampaignSummary(campaign)}`);
      });
      return;
    }

    if (text.startsWith('/counter')) {
      await runDevCommand(chatId, async () => {
        const [, firstArg, ...restArgs] = text.split(/\s+/);
        const replyCampaignId = campaignIdFromReply(message);
        const firstArgLooksLikeCampaign = Boolean(firstArg?.startsWith('cmp_'));
        const campaignId = firstArgLooksLikeCampaign ? firstArg : replyCampaignId;
        const counterMessage = (firstArgLooksLikeCampaign ? restArgs : [firstArg, ...restArgs]).filter(Boolean).join(' ').trim();
        if (!campaignId || !counterMessage) throw new Error('Usage: /counter <campaignId> <terms>');
        await counterCampaign(chatId, campaignId, counterMessage);
      });
      return;
    }

    if (text.startsWith('/accept')) {
      await runDevCommand(chatId, async () => {
        const [, campaignIdFromCommand] = text.split(/\s+/);
        const campaignId = campaignIdFromCommand ?? campaignIdFromReply(message);
        if (!campaignId) throw new Error('Usage: /accept <campaignId>');
        await acceptCampaignAndPublish(chatId, telegramUserId, campaignId);
      });
      return;
    }

    if (text.startsWith('/reject')) {
      await runDevCommand(chatId, async () => {
        const [, campaignIdFromCommand] = text.split(/\s+/);
        const campaignId = campaignIdFromCommand ?? campaignIdFromReply(message);
        if (!campaignId) throw new Error('Usage: /reject <campaignId>');
        await rejectCampaign(chatId, telegramUserId, campaignId);
      });
      return;
    }

    if (text.startsWith('/dev_create_wallet') || text.startsWith('/dev_wallet')) {
      await runDevCommand(chatId, async () => {
        const wallet = await useCases.ensureDevWallet(telegramUserId);
        await sendMessage(chatId, `Dev wallet:\n${wallet.address}\n\nProvider: ${wallet.provider}`);
        await sendDevWalletOverview(chatId, telegramUserId);
      });
      return;
    }

    if (text.startsWith('/sign')) {
      await runDevCommand(chatId, async () => {
        const messageToSign = text.replace(/^\/sign(?:@\w+)?\s*/i, '').trim();
        if (!messageToSign) throw new Error('Usage: /sign <message>');
        const result = await useCases.signDevWalletMessage(telegramUserId, messageToSign);
        await sendMessage(
          chatId,
          [
            'Message signed.',
            `Wallet: ${result.wallet.address}`,
            `Message: ${result.message}`,
            `Signature: ${result.signature}`,
          ].join('\n'),
        );
      });
      return;
    }

    if (text.startsWith('/dev_balance') || text.startsWith('/balance')) {
      if (!config.custodialDevMode && text.startsWith('/balance')) {
        await sendMessage(chatId, `Wallet balances are shown in the web app: ${config.clientUrl}`);
        return;
      }

      await runDevCommand(chatId, async () => {
        await sendDevWalletOverview(chatId, telegramUserId);
      });
      return;
    }

    if (text.startsWith('/dev_mint')) {
      await runDevCommand(chatId, async () => {
        const amount = parseCommandAmount(text, '1000');
        const result = await useCases.mintDevWalletMockUsdc(telegramUserId, amount);
        await sendMessage(chatId, `Minted ${formatDevUsdcAmount(amount)} mock USDC to ${result.wallet.address}.\nTx: ${result.txHash}`);
      });
      return;
    }

    if (text.startsWith('/dev_deposit')) {
      await runDevCommand(chatId, async () => {
        const amount = parseCommandAmount(text);
        const result = await useCases.depositDevWalletMockUsdc(telegramUserId, amount);
        await sendMessage(
          chatId,
          [
            `Deposited ${formatDevUsdcAmount(amount)} mock USDC into escrow.`,
            `Approve tx: ${result.approvalTxHash}`,
            `Deposit tx: ${result.depositTxHash}`,
          ].join('\n'),
        );
      });
      return;
    }

    if (text.startsWith('/dev_withdraw')) {
      await runDevCommand(chatId, async () => {
        const amount = parseCommandAmount(text);
        const result = await useCases.withdrawDevWalletMockUsdc(telegramUserId, amount);
        await sendMessage(chatId, `Withdrew ${formatDevUsdcAmount(amount)} mock USDC from escrow.\nTx: ${result.txHash}`);
      });
      return;
    }

    if (text.startsWith('/link')) {
      await sendMessage(chatId, `Open the web app to connect your wallet: ${config.clientUrl}`);
      return;
    }

    if (text.startsWith('/register_channel')) {
      const channelFromCommand = text.split(/\s+/)[1];
      if (channelFromCommand && channelFromCommand.startsWith('@')) {
        await registerChannelFromText(chatId, telegramUserId, channelFromCommand);
        return;
      }

      pendingChannelRegistration.add(chatId);
      await sendMessage(chatId, 'Send the channel username you want to register, like @exampleChannel.');
      return;
    }

    if (text.startsWith('/my_campaigns')) {
      const campaigns = await useCases.listCampaigns();
      if (campaigns.length === 0) {
        await sendMessage(chatId, 'No campaigns yet.');
        return;
      }

      await sendMessage(
        chatId,
        campaigns
          .slice(0, 10)
          .map(
            (campaign) =>
              `${campaign.id}: ${campaign.amount} for ${campaign.targetTelegramChannelUsername ?? 'no channel'} (${campaign.status})`,
          )
          .join('\n'),
      );
      return;
    }

    await sendMessage(chatId, 'I did not understand that yet. Try /help.');
  }

  async function poll(): Promise<void> {
    console.log('[telegram]: long polling started');

    while (!stopped) {
      try {
        const updates = await requestTelegram<TelegramUpdate[]>('getUpdates', {
          offset,
          timeout: 30,
          allowed_updates: ['message', 'channel_post', 'edited_channel_post', 'callback_query'],
        });

        for (const update of updates) {
          offset = update.update_id + 1;
          if (update.message) {
            await handleMessage(update.message);
          }
          if (update.channel_post) {
            await handleChannelPost(update.channel_post, false);
          }
          if (update.edited_channel_post) {
            await handleChannelPost(update.edited_channel_post, true);
          }
        }
      } catch (error) {
        console.error('[telegram]: polling error', error instanceof Error ? error.message : error);
        await sleep(3000);
      }
    }

    console.log('[telegram]: long polling stopped');
  }

  const balanceMonitor = config.custodialDevMode
    ? setInterval(() => {
        void pollKnownBalances();
      }, 30_000)
    : null;

  void requestTelegram('deleteWebhook', { drop_pending_updates: false })
    .catch((error) => {
      console.error('[telegram]: failed to delete webhook before polling', error instanceof Error ? error.message : error);
    })
    .finally(() => {
      void poll();
    });

  return {
    stop() {
      stopped = true;
      if (balanceMonitor) clearInterval(balanceMonitor);
    },
  };
}

function formatCampaignSummary(campaign: Campaign): string {
  return [
    `${campaign.id}: ${campaign.amount} for ${campaign.targetTelegramChannelUsername ?? 'no channel'}`,
    `Token: ${campaign.tokenAddress}`,
    `Duration: ${formatDuration(campaign.durationSeconds)}`,
    `Status: ${campaign.status}`,
    campaign.onchainCampaignId ? `On-chain campaign: ${campaign.onchainCampaignId}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function campaignOpeningPrompt(): string {
  return [
    'Tell me about the ad you want to run.',
    '',
    'You can write it naturally. I just need the channel, price, currency, how long the post should stay up, and the caption or goal.',
    '',
    'For example:',
    'Promote Grandma Ads on @openagents2026 for 100 USDC for 24 hours. Caption: Sponsored posts with escrow, without spreadsheets.',
    '',
    'I will draft the first version, then we can tune the wording before anything is sent.',
  ].join('\n');
}

function formatMissingFields(fields: string[]): string {
  const labels: Record<string, string> = {
    targetChannel: 'target channel',
    amount: 'price',
    durationSeconds: 'duration',
    adText: 'caption or goal',
  };
  return fields.map((field) => labels[field] ?? field).join(', ');
}

function formatOfferAuthorization(campaign: Campaign): string {
  return [
    'I authorize Grandma Ads to lock funds for this sponsored post offer.',
    `Campaign: ${campaign.id}`,
    `Target channel: ${campaign.targetTelegramChannelUsername ?? 'not set'}`,
    `Amount: ${campaign.amount}`,
    `Token: ${campaign.tokenAddress}`,
    `Duration: ${formatDuration(campaign.durationSeconds)}`,
    'The poster is paid only if the approved ad is published and verification passes.',
  ].join('\n');
}

function pendingAdvertiserUserId(telegramUserId: string): string {
  return `telegram:${telegramUserId}`;
}

function pendingAdvertiserWalletAddress(telegramUserId: string): string {
  return `pending:${telegramUserId}`;
}

function resolveRequestedToken(rawInput: string, config: AppConfig): { symbol: string; address: string } | null {
  const requested = rawInput.match(/\b(USDC|USDT|DAI|WBTC)\b/i)?.[1]?.toUpperCase() ?? 'USDC';
  const tokenAddresses: Record<string, string> = {
    USDC: config.usdcTokenAddress,
    USDT: config.usdtTokenAddress,
    DAI: config.daiTokenAddress,
    WBTC: config.wbtcTokenAddress,
  };
  const address = tokenAddresses[requested];
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return null;
  return { symbol: requested, address };
}

function parseDuration(value: string): number {
  const match = value.match(/^(\d+)(h|hr|hrs|hour|hours|d|day|days)$/i);
  if (!match) throw new Error('Duration must look like 24h or 1d.');
  const amount = Number(match[1]);
  return /^d|day/i.test(match[2]) ? amount * 86_400 : amount * 3_600;
}

function formatDuration(durationSeconds: number): string {
  if (durationSeconds % 86_400 === 0) return `${durationSeconds / 86_400}d`;
  if (durationSeconds % 3_600 === 0) return `${durationSeconds / 3_600}h`;
  return `${durationSeconds}s`;
}

function formatMajorBalances(
  balances: Awaited<ReturnType<AppUseCases['getDevWalletMajorBalances']>>['balances'],
): string[] {
  const visible = balances.filter((balance) => {
    if (balance.isNative) return true;
    return balance.walletBalance > 0n || (balance.escrowBalance ?? 0n) > 0n;
  });

  const lines = visible.map((balance) => {
    const wallet = formatDevTokenAmount(balance.walletBalance, balance.decimals);
    if (balance.escrowBalance === null) return `${balance.symbol}: wallet ${wallet}`;

    const escrow = formatDevTokenAmount(balance.escrowBalance, balance.decimals);
    return `${balance.symbol}: wallet ${wallet}, available in escrow ${escrow}`;
  });

  const hasSpendableToken = visible.some((balance) => !balance.isNative && (balance.walletBalance > 0n || (balance.escrowBalance ?? 0n) > 0n));
  if (!hasSpendableToken) {
    lines.push('No USDC, USDT, DAI, or WBTC balance found yet.');
    lines.push('Send one of those tokens to the wallet, then use /balance to refresh.');
  }

  return lines;
}

function balanceSignature(balances: Awaited<ReturnType<AppUseCases['getDevWalletMajorBalances']>>['balances']): string {
  return balances
    .map((balance) => `${balance.symbol}:${balance.walletBalance.toString()}:${balance.escrowBalance?.toString() ?? 'native'}`)
    .join('|');
}

function getMessageText(message: TelegramMessage): string | null {
  return message.text ?? message.caption ?? null;
}

function isTelegramPostUrl(value: string): boolean {
  return /^https?:\/\/t\.me\/[A-Za-z0-9_]+\/\d+$/i.test(value.trim());
}

function parseTelegramPostUrl(value: string): { channel: string; messageId: string } | null {
  try {
    const parsed = new URL(value.trim());
    if (parsed.hostname !== 't.me') return null;

    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length !== 2) return null;
    const [channel, messageId] = parts;
    if (!/^\d+$/.test(messageId)) return null;

    return { channel, messageId };
  } catch {
    return null;
  }
}

async function fetchTelegramPostHtml(postUrl: string): Promise<string | null> {
  try {
    const response = await fetch(postUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; grandma-ads-bot/0.1)',
      },
    });

    if (!response.ok) return null;
    return response.text();
  } catch {
    return null;
  }
}

function extractTelegramPostText(html: string): string | null {
  const match = html.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  if (!match) return null;

  return decodeHtml(
    match[1]
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .trim(),
  );
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
}

function parseCommandAmount(text: string, defaultAmount?: string): bigint {
  const [, amount = defaultAmount] = text.split(/\s+/);
  if (!amount) throw new Error('Amount is required, for example /dev_deposit 100');
  return parseDevUsdcAmount(amount);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

import { AppUseCases } from '../../application/useCases/createAppUseCases';
import { startMessage } from '../../bot/messages';
import { AppConfig } from '../../config';
import { formatDevUsdcAmount, parseDevUsdcAmount } from '../blockchain/viem/devWalletGateway';

type TelegramChat = {
  id: number;
};

type TelegramUser = {
  id: number;
};

type TelegramMessage = {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

type TelegramResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

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
  const apiBaseUrl = `https://api.telegram.org/bot${config.telegramBotToken}`;

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

  async function sendMessage(chatId: number, text: string): Promise<void> {
    await requestTelegram('sendMessage', {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    });
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

    const channel = await useCases.registerChannel({
      ownerUserId: user.id,
      telegramChannelUsername,
    });
    pendingChannelVerification.set(chatId, channel.id);

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
      await sendMessage(chatId, 'Please create a dev wallet first with /dev_wallet.');
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

  async function handleMessage(message: TelegramMessage): Promise<void> {
    const text = message.text?.trim() ?? '';
    const chatId = message.chat.id;
    const telegramUserId = String(message.from?.id ?? chatId);

    if (pendingChannelRegistration.has(chatId) && text.startsWith('@')) {
      pendingChannelRegistration.delete(chatId);
      await registerChannelFromText(chatId, telegramUserId, text);
      return;
    }

    if (isTelegramPostUrl(text)) {
      const handled = await verifyChannelFromPostUrl(chatId, telegramUserId, text);
      if (handled) return;
    }

    if (text.startsWith('/start')) {
      await sendMessage(chatId, startMessage(config.clientUrl));
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
          '/my_campaigns - View campaign status',
          '/balance - Check your ad balance in the web app',
          '',
          config.custodialDevMode
            ? 'Dev wallet commands: /dev_wallet, /dev_balance, /dev_mint 1000, /dev_deposit 100, /dev_withdraw 25'
            : 'Dev wallet mode is off.',
        ].join('\n'),
      );
      return;
    }

    if (text.startsWith('/dev_wallet')) {
      await runDevCommand(chatId, async () => {
        const wallet = await useCases.ensureDevWallet(telegramUserId);
        await sendMessage(chatId, `Dev wallet:\n${wallet.address}\n\nThis is a local/test wallet generated by the server.`);
      });
      return;
    }

    if (text.startsWith('/dev_balance') || text.startsWith('/balance')) {
      if (!config.custodialDevMode && text.startsWith('/balance')) {
        await sendMessage(chatId, `Wallet balances are shown in the web app: ${config.clientUrl}`);
        return;
      }

      await runDevCommand(chatId, async () => {
        const balance = await useCases.getDevWalletBalance(telegramUserId);
        await sendMessage(
          chatId,
          [
            `Dev wallet: ${balance.walletAddress}`,
            `Wallet mock USDC: ${formatDevUsdcAmount(balance.tokenBalance)}`,
            `Available in escrow: ${formatDevUsdcAmount(balance.escrowBalance)}`,
          ].join('\n'),
        );
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
          allowed_updates: ['message', 'callback_query'],
        });

        for (const update of updates) {
          offset = update.update_id + 1;
          if (update.message) {
            await handleMessage(update.message);
          }
        }
      } catch (error) {
        console.error('[telegram]: polling error', error instanceof Error ? error.message : error);
        await sleep(3000);
      }
    }

    console.log('[telegram]: long polling stopped');
  }

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
    },
  };
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

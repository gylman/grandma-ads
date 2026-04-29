import { AppUseCases } from '../../application/useCases/createAppUseCases';
import { startMessage } from '../../bot/messages';
import { AppConfig } from '../../config';

type TelegramChat = {
  id: number;
};

type TelegramMessage = {
  message_id: number;
  chat: TelegramChat;
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

  async function handleMessage(message: TelegramMessage): Promise<void> {
    const text = message.text?.trim() ?? '';
    const chatId = message.chat.id;

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
        ].join('\n'),
      );
      return;
    }

    if (text.startsWith('/link')) {
      await sendMessage(chatId, `Open the web app to connect your wallet: ${config.clientUrl}`);
      return;
    }

    if (text.startsWith('/register_channel')) {
      await sendMessage(chatId, 'Send the channel username you want to register, like @exampleChannel.');
      return;
    }

    if (text.startsWith('/balance')) {
      await sendMessage(chatId, `Wallet balances are shown in the web app: ${config.clientUrl}`);
      return;
    }

    if (text.startsWith('/my_campaigns')) {
      const campaigns = useCases.listCampaigns();
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

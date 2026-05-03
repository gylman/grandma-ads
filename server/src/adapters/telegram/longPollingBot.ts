import { AppUseCases } from "../../application/useCases/createAppUseCases";
import { AppConfig } from "../../config";
import { createTelegramApi } from "./api";
import { createBalanceMonitor } from "./devWalletFlow";
import { createFinalSettlementWorker } from "./finalSettlementWorker";
import { handleCallbackQuery } from "./callbackHandler";
import { handleChannelPost } from "./channelPostHandler";
import { sleep, TelegramBotContext } from "./context";
import { telegramCommands } from "./keyboards";
import { handleMessage } from "./messageHandler";
import { createTelegramBotState } from "./state";
import { TelegramLongPollingBot, TelegramUpdate } from "./types";

export function startTelegramLongPollingBot(config: AppConfig, useCases: AppUseCases): TelegramLongPollingBot {
  if (!config.telegramBotToken) {
    console.log("[telegram]: TELEGRAM_BOT_TOKEN missing; long polling disabled");
    return { stop() {} };
  }

  let stopped = false;
  let offset = 0;
  const ctx: TelegramBotContext = {
    config,
    useCases,
    api: createTelegramApi(config.telegramBotToken),
    state: createTelegramBotState(),
  };
  const balanceMonitorWorker = createBalanceMonitor(ctx);
  const finalSettlementWorker = createFinalSettlementWorker(ctx);

  async function poll(): Promise<void> {
    console.log("[telegram]: long polling started");

    while (!stopped) {
      try {
        const updates = await ctx.api.request<TelegramUpdate[]>("getUpdates", {
          offset,
          timeout: 30,
          allowed_updates: ["message", "channel_post", "edited_channel_post", "callback_query"],
        });

        for (const update of updates) {
          offset = update.update_id + 1;
          if (update.message) {
            await handleMessage(ctx, update.message);
          }
          if (update.callback_query) {
            await handleCallbackQuery(ctx, update.callback_query);
          }
          if (update.channel_post) {
            await handleChannelPost(ctx, update.channel_post, false);
          }
          if (update.edited_channel_post) {
            await handleChannelPost(ctx, update.edited_channel_post, true);
          }
        }
      } catch (error) {
        console.error("[telegram]: polling error", error instanceof Error ? error.message : error);
        await sleep(3000);
      }
    }

    console.log("[telegram]: long polling stopped");
  }

  const balanceMonitor = config.custodialDevMode
    ? setInterval(() => {
        void balanceMonitorWorker.pollKnownBalances();
      }, 30_000)
    : null;
  const finalSettlementMonitor = config.custodialDevMode
    ? setInterval(() => {
        void finalSettlementWorker.pollDueCampaigns();
      }, 30_000)
    : null;

  void ctx.api.request("setMyCommands", {
    commands: telegramCommands(config.custodialDevMode),
  }).catch((error) => {
    console.error("[telegram]: failed to set bot commands", error instanceof Error ? error.message : error);
  });

  void ctx.api.request("deleteWebhook", { drop_pending_updates: false })
    .catch((error) => {
      console.error("[telegram]: failed to delete webhook before polling", error instanceof Error ? error.message : error);
    })
    .finally(() => {
      void poll();
    });

  return {
    stop() {
      stopped = true;
      if (balanceMonitor) clearInterval(balanceMonitor);
      if (finalSettlementMonitor) clearInterval(finalSettlementMonitor);
    },
  };
}

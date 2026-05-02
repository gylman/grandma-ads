import { AppUseCases } from "../../application/useCases/createAppUseCases";
import { AppConfig } from "../../config";
import { TelegramApi } from "./api";
import { PromptType, TelegramBotState } from "./state";

export type TelegramBotContext = {
  config: AppConfig;
  useCases: AppUseCases;
  api: TelegramApi;
  state: TelegramBotState;
};

export async function sendPromptForReply(
  ctx: TelegramBotContext,
  chatId: number,
  text: string,
  type: PromptType,
  options?: { campaignId?: string; placeholder?: string },
): Promise<void> {
  const prompt = await ctx.api.sendMessage(chatId, text, {
    replyMarkup: {
      force_reply: true,
      selective: true,
      input_field_placeholder: options?.placeholder,
    },
  });
  ctx.state.pendingPromptByChat.set(chatId, {
    type,
    promptMessageId: prompt.message_id,
    campaignId: options?.campaignId,
  });
}

export async function runDevCommand(ctx: TelegramBotContext, chatId: number, action: () => Promise<void>): Promise<void> {
  if (!ctx.config.custodialDevMode) {
    await ctx.api.sendMessage(chatId, "Dev custodial wallet mode is off.");
    return;
  }

  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[telegram]: dev command failed", message);
    await ctx.api.sendMessage(chatId, `Dev command failed: ${message}`);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

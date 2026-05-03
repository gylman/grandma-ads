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
  options?: { campaignId?: string; placeholder?: string; seedText?: string },
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
    seedText: options?.seedText,
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
    await ctx.api.sendMessage(chatId, `I could not complete that yet.\n\n${message}`);
  }
}

export async function runWithProcessing<T>(
  ctx: TelegramBotContext,
  chatId: number,
  action: () => Promise<T>,
): Promise<T> {
  const processing = await ctx.api.sendMessage(chatId, "⏳ Processing...");

  try {
    return await action();
  } finally {
    await ctx.api.deleteMessage(chatId, processing.message_id).catch(() => {});
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

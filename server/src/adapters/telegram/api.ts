import { TelegramForceReplyMarkup, TelegramMessage, TelegramReplyMarkup, TelegramResponse } from "./types";

export type TelegramApi = ReturnType<typeof createTelegramApi>;

export function createTelegramApi(botToken: string) {
  const apiBaseUrl = `https://api.telegram.org/bot${botToken}`;

  async function request<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${apiBaseUrl}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const payload = (await response.json()) as TelegramResponse<T>;
    if (!payload.ok || payload.result === undefined) {
      throw new Error(payload.description ?? `Telegram ${method} failed`);
    }

    return payload.result;
  }

  async function sendMessage(
    chatId: number | string,
    text: string,
    options?: {
      replyMarkup?: TelegramReplyMarkup | TelegramForceReplyMarkup;
      replyToMessageId?: number;
      parseMode?: "HTML" | "MarkdownV2";
    },
  ): Promise<TelegramMessage> {
    return await request<TelegramMessage>("sendMessage", {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      reply_markup: options?.replyMarkup,
      reply_to_message_id: options?.replyToMessageId,
      parse_mode: options?.parseMode,
    });
  }

  async function answerCallbackQuery(callbackQueryId: string): Promise<void> {
    await request<boolean>("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
    });
  }

  return {
    request,
    sendMessage,
    answerCallbackQuery,
  };
}

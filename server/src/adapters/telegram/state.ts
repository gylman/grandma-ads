import { TelegramMessage } from "./types";

export type CampaignMessagePurpose = "DRAFT" | "OFFER";
export type PromptType = "CAMPAIGN_DRAFT" | "REVISE_COPY" | "REGISTER_CHANNEL" | "DEV_MINT" | "DEV_DEPOSIT" | "DEV_WITHDRAW" | "COUNTER_OFFER";

export type PendingPrompt = {
  type: PromptType;
  promptMessageId: number;
  campaignId?: string;
};

export type BalanceWatcher = {
  telegramUserId: string;
  lastSignature: string;
};

export type TelegramBotState = ReturnType<typeof createTelegramBotState>;

export function createTelegramBotState() {
  return {
    pendingChannelVerification: new Map<number, string>(),
    pendingPromptByChat: new Map<number, PendingPrompt>(),
    campaignByMessage: new Map<string, { campaignId: string; purpose: CampaignMessagePurpose }>(),
    balanceWatchers: new Map<number, BalanceWatcher>(),
  };
}

export function rememberCampaignMessage(
  state: TelegramBotState,
  chatId: number,
  message: TelegramMessage,
  campaignId: string,
  purpose: CampaignMessagePurpose,
): void {
  state.campaignByMessage.set(`${chatId}:${message.message_id}`, { campaignId, purpose });
}

export function campaignContextFromReply(
  state: TelegramBotState,
  message: TelegramMessage,
): { campaignId: string; purpose: CampaignMessagePurpose } | null {
  const reply = message.reply_to_message;
  if (!reply) return null;
  return state.campaignByMessage.get(`${message.chat.id}:${reply.message_id}`) ?? null;
}

export function campaignIdFromReply(state: TelegramBotState, message: TelegramMessage): string | null {
  return campaignContextFromReply(state, message)?.campaignId ?? null;
}

export function clearChatState(state: TelegramBotState, chatId: number): void {
  state.balanceWatchers.delete(chatId);
  state.pendingChannelVerification.delete(chatId);
  state.pendingPromptByChat.delete(chatId);

  for (const [key] of state.campaignByMessage) {
    if (key.startsWith(`${chatId}:`)) {
      state.campaignByMessage.delete(key);
    }
  }
}

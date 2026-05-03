export type TelegramChat = {
  id: number;
  username?: string;
};

export type TelegramUser = {
  id: number;
  username?: string;
};

export type TelegramPhotoSize = {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
};

export type TelegramMessage = {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  reply_to_message?: TelegramMessage;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

export type TelegramInlineKeyboardButton = {
  text: string;
  callback_data: string;
};

export type TelegramReplyMarkup = {
  inline_keyboard: TelegramInlineKeyboardButton[][];
};

export type TelegramForceReplyMarkup = {
  force_reply: true;
  selective?: boolean;
  input_field_placeholder?: string;
};

export type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
};

export type TelegramResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

export type TelegramLongPollingBot = {
  stop(): void;
};

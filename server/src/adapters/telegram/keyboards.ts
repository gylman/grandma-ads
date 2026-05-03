import { TelegramReplyKeyboardMarkup, TelegramReplyMarkup } from "./types";

export const FIXED_BUTTONS = {
  start: "Start",
  newAd: "Create Ad",
  myAds: "My Ads",
  registerChannel: "Register Channel",
  balance: "Wallet",
  help: "Help",
} as const;

export function fixedMainKeyboard(): TelegramReplyKeyboardMarkup {
  return {
    keyboard: [
      [FIXED_BUTTONS.start],
      [FIXED_BUTTONS.newAd, FIXED_BUTTONS.myAds],
      [FIXED_BUTTONS.registerChannel, FIXED_BUTTONS.balance],
      [FIXED_BUTTONS.help],
    ],
    resize_keyboard: true,
    input_field_placeholder: "Choose an action or write a message",
  };
}

export function mainMenuButtons(): TelegramReplyMarkup {
  return {
    inline_keyboard: [
      [{ text: "Create Campaign", callback_data: "menu:new_campaign" }],
      [{ text: "Register Channel", callback_data: "menu:register_channel" }],
      [{ text: "My Campaigns", callback_data: "menu:my_campaigns" }],
      [{ text: "Wallet", callback_data: "menu:balance" }],
    ],
  };
}

export function devWalletButtons(hasWallet: boolean): TelegramReplyMarkup {
  if (!hasWallet) {
    return {
      inline_keyboard: [[{ text: "Create Wallet", callback_data: "dev:create_wallet" }]],
    };
  }

  return {
    inline_keyboard: [
      [{ text: "Mint", callback_data: "dev:prompt_mint" }],
      [{ text: "Deposit", callback_data: "dev:prompt_deposit" }],
      [{ text: "Withdraw", callback_data: "dev:prompt_withdraw" }],
    ],
  };
}

export function campaignListButtons(campaigns: Array<{ id: string; onchainCampaignId: string | null; status: string }>): TelegramReplyMarkup {
  return {
    inline_keyboard: campaigns.map((campaign, index) => [
      {
        text: `${campaign.onchainCampaignId ? `Ad #${campaign.onchainCampaignId}` : `Draft ${index + 1}`} - ${campaign.status}`,
        callback_data: `campaign:open:${campaign.id}`,
      },
    ]),
  };
}

export function offerActionButtons(campaignId: string): TelegramReplyMarkup {
  return {
    inline_keyboard: [
      [{ text: "Accept Offer", callback_data: `offer:accept:${campaignId}` }],
      [{ text: "Reject Offer", callback_data: `offer:reject:${campaignId}` }],
      [{ text: "Counter Offer", callback_data: `offer:counter:${campaignId}` }],
    ],
  };
}

export function counterDraftActionButtons(campaignId: string): TelegramReplyMarkup {
  return {
    inline_keyboard: [
      [{ text: "Revise", callback_data: `counter_draft:revise:${campaignId}` }],
      [{ text: "Send Counter Offer", callback_data: `counter_draft:send:${campaignId}` }],
    ],
  };
}

export function counterResponseActionButtons(campaignId: string): TelegramReplyMarkup {
  return {
    inline_keyboard: [
      [{ text: "Accept Counter", callback_data: `counter_response:accept:${campaignId}` }],
      [{ text: "Reject Counter", callback_data: `counter_response:reject:${campaignId}` }],
      [{ text: "Counter Back", callback_data: `counter_response:counter:${campaignId}` }],
    ],
  };
}

export function checkBalanceButton(): TelegramReplyMarkup {
  return {
    inline_keyboard: [[{ text: "Check Balance", callback_data: "dev:balance" }]],
  };
}

export function telegramCommands(custodialDevMode: boolean): Array<{ command: string; description: string }> {
  const commands = [
    { command: "start", description: "Show the main bot menu" },
    { command: "menu", description: "Show the main bot menu" },
    { command: "help", description: "Show available commands" },
    { command: "new_campaign", description: "Create a campaign draft" },
    { command: "campaign_draft", description: "Draft a campaign from one message" },
    { command: "revise_copy", description: "Revise approved ad copy" },
    { command: "send_offer", description: "Lock funds and send offer" },
    { command: "send_counter", description: "Send prepared counteroffer draft" },
    { command: "accept_counter_proposal", description: "Accept received counter proposal" },
    { command: "reject_counter_proposal", description: "Reject received counter proposal" },
    { command: "register_channel", description: "Register a Telegram channel" },
    { command: "my_campaigns", description: "List campaigns" },
    { command: "balance", description: "Show balances" },
    { command: "link", description: "Open wallet linking flow" },
  ];

  if (!custodialDevMode) return commands;

  return [
    ...commands,
    { command: "dev_create_wallet", description: "Create or show dev wallet" },
    { command: "dev_balance", description: "Show dev balances" },
    { command: "dev_mint", description: "Mint mock USDC or USDT" },
    { command: "dev_deposit", description: "Deposit mock USDC or USDT to escrow" },
    { command: "dev_withdraw", description: "Withdraw mock USDC or USDT from escrow" },
    { command: "dev_clear", description: "Clear your dev wallet and campaigns" },
    { command: "sign", description: "Sign a test message" },
  ];
}

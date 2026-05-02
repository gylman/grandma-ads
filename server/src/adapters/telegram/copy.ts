export function campaignOpeningPrompt(): string {
  return [
    "Tell me about the ad you want to run.",
    "",
    "You can write it naturally. I just need the channel, price, currency, how long the post should stay up, and the caption or goal.",
    "",
    "I will draft the first version, then we can tune the wording before anything is sent.",
    "",
    "For example:",
    "Promote Grandma Ads on @openagents2026 for 100 USDC for 24 hours. Caption: Sponsored posts with escrow, without spreadsheets.",
  ].join("\n");
}

export function formatMissingFields(fields: string[]): string {
  const labels: Record<string, string> = {
    targetChannel: "target channel",
    amount: "price",
    durationSeconds: "duration",
    adText: "caption or goal",
  };
  return fields.map((field) => labels[field] ?? field).join(", ");
}

export function helpText(custodialDevMode: boolean): string {
  return [
    "Available commands:",
    "/start - Open the bot intro",
    "/link - Link your wallet from the web app",
    "/register_channel - Register a Telegram channel",
    "/new_campaign - Draft a sponsored post campaign",
    "/campaign_draft <details> - Draft a campaign in one message",
    "/revise_copy <campaignId> <instruction> - Improve approved ad copy",
    "/send_offer <campaignId> - Lock funds and send offer to the poster",
    "/fund_campaign <campaignId> - Lock funds only",
    "/accept <campaignId>, /reject <campaignId>, /counter <campaignId> <terms>",
    "/my_campaigns - View campaign status",
    "/balance - Check your ad balance in the web app",
    "/menu - Open quick action buttons",
    "",
    custodialDevMode ? "Dev wallet commands: /dev_create_wallet, /dev_balance, /dev_mint 1000, /dev_deposit 100, /dev_withdraw 25, /dev_clear, /sign hello" : "Dev wallet mode is off.",
  ].join("\n");
}

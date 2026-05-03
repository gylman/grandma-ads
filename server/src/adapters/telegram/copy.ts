export function campaignOpeningPrompt(): string {
  return [
    "Tell me about the ad you want to run.",
    "",
    "You can write it naturally. I just need:",
    "- Channel link",
    "- Price",
    "- Currency",
    "- Duration",
    "- Caption",
    "",
    "You can also include an image.",
    "",
    "I will draft the first version, then we can tune the wording before anything is sent.",
    "",
    "For example:",
    "Promote Grandma Ads on https://t.me/openagents2026 for 100 USDC for 24 hours.",
    "Caption: Sponsored posts with escrow, without spreadsheets.",
  ].join("\n");
}

export function startText(): string {
  return [
    "Welcome.",
    "",
    "This bot helps you create and manage Telegram ads with escrow.",
    "",
    "How it works:",
    "- Register your channel",
    "- Create an ad",
    "- Lock funds safely",
    "- Run the ad only when both sides agree",
    "",
    "Choose an action below.",
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
    "/send_counter <campaignId> - Send your prepared counteroffer draft",
    "/accept_counter_proposal <campaignId> - Accept a received counter proposal",
    "/reject_counter_proposal <campaignId> - Reject a received counter proposal",
    "/my_campaigns - View campaign status",
    "/balance - Check your ad balance in the web app",
    "/menu - Open quick action buttons",
    "",
    custodialDevMode ? "Dev wallet commands: /dev_create_wallet, /dev_balance, /dev_mint 1000, /dev_deposit 100, /dev_withdraw 25, /dev_clear, /sign hello" : "Dev wallet mode is off.",
  ].join("\n");
}

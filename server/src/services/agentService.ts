import { Campaign, CampaignIntakeResult } from '../domain/types';

export function extractCampaignIntake(message: string): CampaignIntakeResult {
  const channel = message.match(/@([a-zA-Z0-9_]{5,})/)?.[0];
  const amountMatch = message.match(/\b(\d+(?:\.\d+)?)\s*(USDC|USD|DAI|ETH)?\b/i);
  const durationMatch = message.match(/\b(\d+)\s*(hour|hours|hr|hrs|day|days|d)\b/i);

  const durationSeconds = durationMatch
    ? Number(durationMatch[1]) * (/^d|day/i.test(durationMatch[2]) ? 86_400 : 3_600)
    : undefined;

  const missingFields = [
    !channel ? 'targetChannel' : null,
    !amountMatch ? 'amount' : null,
    !durationSeconds ? 'durationSeconds' : null,
  ].filter((field): field is string => field !== null);

  return {
    targetChannel: channel,
    amount: amountMatch?.[1],
    tokenSymbol: amountMatch?.[2]?.toUpperCase() ?? (amountMatch ? 'USDC' : undefined),
    durationSeconds,
    adText: message.trim() || undefined,
    missingFields,
  };
}

export function generatePosterOffer(campaign: Campaign): string {
  const channel = campaign.targetTelegramChannelUsername ?? 'your channel';
  const hours = Math.round(campaign.durationSeconds / 3600);

  return [
    `You have a sponsored post offer for ${channel}.`,
    `Amount: ${campaign.amount}`,
    `Duration: ${hours} hour${hours === 1 ? '' : 's'}.`,
    '',
    'Please publish this ad exactly as shown. If you change the text, image, or link, verification may fail and payment will not be released.',
    '',
    'Payment is released only if the approved post stays live for the full duration.',
  ].join('\n');
}

export function explainVerificationFailure(reason: string | null): string {
  if (!reason) return 'The post could not be verified. Please check the post URL and try again.';
  return `${reason} Please repost or edit the message exactly as shown, then submit the post URL again.`;
}

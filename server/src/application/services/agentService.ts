import { Campaign, CampaignIntakeResult } from '../../domain/types';

export function extractCampaignIntake(message: string): CampaignIntakeResult {
  const channel = message.match(/@([a-zA-Z0-9_]{5,})/)?.[0];
  const amountMatch = message.match(/\b(\d+(?:\.\d+)?)\s*(USDC|USD|DAI|ETH)?\b/i);
  const durationMatch = message.match(/\b(\d+)\s*(second|seconds|sec|secs|s|minute|minutes|min|mins|m|hour|hours|hr|hrs|h|day|days|d)\b/i);

  const durationSeconds = durationMatch
    ? Number(durationMatch[1]) * durationUnitSeconds(durationMatch[2])
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

  return [
    `You have a sponsored post offer for ${channel}.`,
    `Amount: ${campaign.amount}`,
    `Duration: ${formatDuration(campaign.durationSeconds)}.`,
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

function durationUnitSeconds(unit: string): number {
  if (/^d|day/i.test(unit)) return 86_400;
  if (/^h|hr|hour/i.test(unit)) return 3_600;
  if (/^m|min|minute/i.test(unit)) return 60;
  return 1;
}

function formatDuration(durationSeconds: number): string {
  if (durationSeconds % 86_400 === 0) return `${durationSeconds / 86_400} day${durationSeconds === 86_400 ? '' : 's'}`;
  if (durationSeconds % 3_600 === 0) return `${durationSeconds / 3_600} hour${durationSeconds === 3_600 ? '' : 's'}`;
  if (durationSeconds % 60 === 0) return `${durationSeconds / 60} minute${durationSeconds === 60 ? '' : 's'}`;
  return `${durationSeconds} seconds`;
}

import { Channel, Campaign } from '../domain/types';

export const exactPostWarning =
  'Please publish this ad exactly as shown. If you change the text, image, or link, verification may fail and payment will not be released.';

export function startMessage(clientUrl: string): string {
  return [
    'Welcome. This bot helps advertisers and Telegram channel owners run sponsored posts with escrow.',
    '',
    `Wallet actions happen in the web app: ${clientUrl}`,
    'Use /link to connect your wallet, or /register_channel to opt in as a poster.',
  ].join('\n');
}

export function channelVerificationMessage(channel: Channel): string {
  return [
    `Post this exact code in @${channel.telegramChannelUsername}:`,
    '',
    channel.verificationCode ?? '',
    '',
    'Then send the public Telegram post URL here.',
  ].join('\n');
}

export function postingInstructions(campaign: Campaign): string {
  return [
    exactPostWarning,
    '',
    campaign.approvedText ?? '[Image only ad]',
    '',
    'After posting, send the Telegram post URL.',
  ].join('\n');
}

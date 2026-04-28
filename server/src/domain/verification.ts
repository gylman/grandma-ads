export type TelegramPostParts = {
  channel: string;
  messageId: string;
};

export type VerifyPostInput = {
  submittedPostUrl: string;
  expectedChannelUsername: string | null;
  expectedText: string | null;
  observedText?: string | null;
  expectedImageHash?: string | null;
  observedImageHash?: string | null;
};

export type VerifyPostResult = {
  passed: boolean;
  reason: string | null;
  messageId: string | null;
  normalizedExpectedText: string | null;
  normalizedObservedText: string | null;
};

export function parseTelegramPostUrl(url: string): TelegramPostParts | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 't.me' && parsed.hostname !== 'telegram.me') return null;

    const [channel, messageId] = parsed.pathname.split('/').filter(Boolean);
    if (!channel || !messageId || !/^\d+$/.test(messageId)) return null;

    return { channel, messageId };
  } catch {
    return null;
  }
}

export function normalizeAdText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .split('\n')
    .map((line) => line.trim().replace(/[ \t]+/g, ' '))
    .join('\n')
    .trim();
}

export function verifyPostSnapshot(input: VerifyPostInput): VerifyPostResult {
  const parts = parseTelegramPostUrl(input.submittedPostUrl);
  if (!parts) {
    return _failed('That does not look like a public Telegram post URL.', null, null, null);
  }

  if (input.expectedChannelUsername && parts.channel.toLowerCase() !== input.expectedChannelUsername.replace(/^@/, '').toLowerCase()) {
    return _failed('The post URL is not from the approved Telegram channel.', parts.messageId, null, null);
  }

  const normalizedExpected = input.expectedText ? normalizeAdText(input.expectedText) : null;
  const normalizedObserved = input.observedText ? normalizeAdText(input.observedText) : null;

  if (normalizedExpected && normalizedExpected !== normalizedObserved) {
    return _failed('The post was found, but the text does not match the approved ad.', parts.messageId, normalizedExpected, normalizedObserved);
  }

  if (input.expectedImageHash && input.expectedImageHash !== input.observedImageHash) {
    return _failed('The post image does not match the approved ad image.', parts.messageId, normalizedExpected, normalizedObserved);
  }

  return {
    passed: true,
    reason: null,
    messageId: parts.messageId,
    normalizedExpectedText: normalizedExpected,
    normalizedObservedText: normalizedObserved,
  };
}

function _failed(
  reason: string,
  messageId: string | null,
  normalizedExpectedText: string | null,
  normalizedObservedText: string | null,
): VerifyPostResult {
  return {
    passed: false,
    reason,
    messageId,
    normalizedExpectedText,
    normalizedObservedText,
  };
}

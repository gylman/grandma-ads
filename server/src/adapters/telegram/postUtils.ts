import { TelegramMessage } from "./types";

export function getMessageText(message: TelegramMessage): string | null {
  return message.text ?? message.caption ?? null;
}

export function getLargestPhotoFileId(message: TelegramMessage): string | null {
  const photos = message.photo;
  if (!photos || photos.length === 0) return null;
  return photos[photos.length - 1]?.file_id ?? null;
}

export function isTelegramPostUrl(value: string): boolean {
  return /^https?:\/\/t\.me\/[A-Za-z0-9_]+\/\d+$/i.test(value.trim());
}

export function parseTelegramPostUrl(value: string): { channel: string; messageId: string } | null {
  try {
    const parsed = new URL(value.trim());
    if (parsed.hostname !== "t.me") return null;

    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length !== 2) return null;
    const [channel, messageId] = parts;
    if (!/^\d+$/.test(messageId)) return null;

    return { channel, messageId };
  } catch {
    return null;
  }
}

export async function fetchTelegramPostHtml(postUrl: string): Promise<string | null> {
  try {
    const response = await fetch(postUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; grandma-ads-bot/0.1)",
      },
    });

    if (!response.ok) return null;
    return response.text();
  } catch {
    return null;
  }
}

export function extractTelegramPostText(html: string): string | null {
  const match = html.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  if (!match) return null;

  return decodeHtml(
    match[1]
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>\s*<p[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .trim(),
  );
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}

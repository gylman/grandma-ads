export function pendingAdvertiserUserId(telegramUserId: string): string {
  return `telegram:${telegramUserId}`;
}

export function pendingAdvertiserWalletAddress(telegramUserId: string): string {
  return `pending:${telegramUserId}`;
}

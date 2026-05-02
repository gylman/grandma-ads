export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function highlightNegotiationTerms(text: string): string {
  let html = escapeHtml(text);

  // Amount + token, e.g. 100 USDC, 150.5 USDT
  html = html.replace(/\b(\d+(?:\.\d+)?)\s*(USDC|USDT|DAI|WBTC|USD|ETH)\b/gi, (_match, amount, token) => {
    return `<b>${amount} ${token.toUpperCase()}</b>`;
  });

  // Duration, e.g. 24 hours, 24h, 1 day
  html = html.replace(/\b(\d+)\s*(h|hr|hrs|hour|hours|d|day|days)\b/gi, (_match, value, unit) => {
    return `<b>${value} ${unit}</b>`;
  });

  return html;
}

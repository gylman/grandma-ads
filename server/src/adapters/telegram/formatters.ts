import { AppUseCases } from "../../application/useCases/createAppUseCases";
import { Campaign } from "../../domain/types";
import { formatDevTokenAmount } from "../blockchain/viem/devWalletGateway";
import { escapeHtml } from "./richText";

export function formatCampaignReference(campaign: Pick<Campaign, "onchainCampaignId">): string {
  return campaign.onchainCampaignId ? `#${campaign.onchainCampaignId}` : "Draft";
}

export function formatCampaignLabel(campaign: Pick<Campaign, "onchainCampaignId">): string {
  return campaign.onchainCampaignId ? `Ad ${formatCampaignReference(campaign)}` : "Draft ad";
}

export function formatCampaignSummary(campaign: Campaign): string {
  return [
    "Channel:",
    formatChannelLink(campaign.targetTelegramChannelUsername),
    "",
    "Price:",
    campaign.amount,
    "",
    "Token:",
    campaign.tokenAddress,
    "",
    "Duration:",
    formatDuration(campaign.durationSeconds),
    "",
    "Status:",
    campaign.status,
    campaign.onchainCampaignId ? "" : null,
    campaign.onchainCampaignId ? "Ad ID:" : null,
    campaign.onchainCampaignId ? `#${campaign.onchainCampaignId}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function formatDuration(durationSeconds: number): string {
  if (durationSeconds % 86_400 === 0) return `${durationSeconds / 86_400} day${durationSeconds === 86_400 ? "" : "s"}`;
  if (durationSeconds % 3_600 === 0) return `${durationSeconds / 3_600} hour${durationSeconds === 3_600 ? "" : "s"}`;
  if (durationSeconds % 60 === 0) return `${durationSeconds / 60} minute${durationSeconds === 60 ? "" : "s"}`;
  return `${durationSeconds} seconds`;
}

export function formatChannelLink(channel: string | null | undefined): string {
  if (!channel) return "Not set";
  const username = channel.replace(/^@/, "");
  return `https://t.me/${username}`;
}

export function formatMajorBalances(balances: Awaited<ReturnType<AppUseCases["getDevWalletMajorBalances"]>>["balances"]): string[] {
  const visible = balances.filter((balance) => {
    if (balance.isNative) return true;
    return balance.walletBalance > 0n || (balance.escrowBalance ?? 0n) > 0n;
  });

  const lines = visible.flatMap((balance) => {
    const wallet = formatDevTokenAmount(balance.walletBalance, balance.decimals);
    if (balance.escrowBalance === null) return [balance.symbol, `- Wallet: ${wallet}`];

    const escrow = formatDevTokenAmount(balance.escrowBalance, balance.decimals);
    return [balance.symbol, `- Wallet: ${wallet}`, `- Available in escrow: ${escrow}`, "- Locked in escrow: 0"];
  });

  const hasSpendableToken = visible.some((balance) => !balance.isNative && (balance.walletBalance > 0n || (balance.escrowBalance ?? 0n) > 0n));
  if (!hasSpendableToken) {
    if (lines.length > 0) lines.push("");
    lines.push("No USDC, USDT, DAI, or WBTC balance found yet.");
    lines.push('Send one of those tokens to the wallet, then tap "Wallet" to refresh.');
  }

  return lines;
}

export function formatWalletOverviewText(input: {
  walletAddress: string;
  balances: Awaited<ReturnType<AppUseCases["getDevWalletMajorBalances"]>>["balances"];
}): string {
  return ["👛 Wallet:", input.walletAddress, "", "💰 Balances:", "", ...formatMajorBalances(input.balances)].join("\n");
}

export function formatAdReceiptHtml(campaign: Campaign, title: string): string {
  return [
    `<b>${escapeHtml(title)}</b>`,
    "",
    campaign.onchainCampaignId ? `<b>Ad:</b> #${escapeHtml(campaign.onchainCampaignId)}` : null,
    `<b>Channel:</b> ${escapeHtml(formatChannelLink(campaign.targetTelegramChannelUsername))}`,
    `<b>Advertiser:</b> <code>${escapeHtml(campaign.advertiserEnsName ?? campaign.advertiserWalletAddress)}</code>`,
    campaign.posterEnsName || campaign.posterWalletAddress ? `<b>Publisher:</b> <code>${escapeHtml(campaign.posterEnsName ?? campaign.posterWalletAddress ?? "")}</code>` : null,
    `<b>Amount:</b> ${escapeHtml(campaign.amount)}`,
    `<b>Duration:</b> ${escapeHtml(formatDuration(campaign.durationSeconds))}`,
    campaign.approvedText ? "" : null,
    campaign.approvedText ? `<b>Caption:</b>\n${escapeHtml(campaign.approvedText)}` : null,
    campaign.requestedImageFileId ? "" : null,
    campaign.requestedImageFileId ? "Image: included" : null,
  ].filter((line): line is string => line !== null).join("\n");
}

export function balanceSignature(balances: Awaited<ReturnType<AppUseCases["getDevWalletMajorBalances"]>>["balances"]): string {
  return balances.map((balance) => `${balance.symbol}:${balance.walletBalance.toString()}:${balance.escrowBalance?.toString() ?? "native"}`).join("|");
}

export function friendlyBalanceLookupError(message: string): string {
  if (message.includes('function "balanceOf" returned no data')) {
    return "The configured token address on this chain is not an ERC-20 token contract, or it is from an older deployment. Update the token addresses in server/.env and restart the server.";
  }
  if (message.includes('function "balances" returned no data')) {
    return "The configured escrow contract address does not match the current deployment. Update ESCROW_CONTRACT_ADDRESS in server/.env and restart the server.";
  }
  return message;
}

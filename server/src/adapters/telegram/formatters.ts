import { AppUseCases } from "../../application/useCases/createAppUseCases";
import { Campaign } from "../../domain/types";
import { formatDevTokenAmount } from "../blockchain/viem/devWalletGateway";

export function formatCampaignSummary(campaign: Campaign): string {
  return [
    `${campaign.id}: ${campaign.amount} for ${campaign.targetTelegramChannelUsername ?? "no channel"}`,
    campaign.ensName ? `ENS: ${campaign.ensName}` : null,
    `Token: ${campaign.tokenAddress}`,
    `Duration: ${formatDuration(campaign.durationSeconds)}`,
    `Status: ${campaign.status}`,
    campaign.onchainCampaignId ? `On-chain campaign: ${campaign.onchainCampaignId}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function formatDuration(durationSeconds: number): string {
  if (durationSeconds % 86_400 === 0) return `${durationSeconds / 86_400}d`;
  if (durationSeconds % 3_600 === 0) return `${durationSeconds / 3_600}h`;
  return `${durationSeconds}s`;
}

export function formatMajorBalances(balances: Awaited<ReturnType<AppUseCases["getDevWalletMajorBalances"]>>["balances"]): string[] {
  const visible = balances.filter((balance) => {
    if (balance.isNative) return true;
    return balance.walletBalance > 0n || (balance.escrowBalance ?? 0n) > 0n;
  });

  const lines = visible.map((balance) => {
    const wallet = formatDevTokenAmount(balance.walletBalance, balance.decimals);
    if (balance.escrowBalance === null) return `${balance.symbol}: wallet ${wallet}`;

    const escrow = formatDevTokenAmount(balance.escrowBalance, balance.decimals);
    return `${balance.symbol}: wallet ${wallet}, available in escrow ${escrow}`;
  });

  const hasSpendableToken = visible.some((balance) => !balance.isNative && (balance.walletBalance > 0n || (balance.escrowBalance ?? 0n) > 0n));
  if (!hasSpendableToken) {
    lines.push("No USDC, USDT, DAI, or WBTC balance found yet.");
    lines.push('Send one of those tokens to the wallet, then click "Check Balance".');
  }

  return lines;
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

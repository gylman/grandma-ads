import { AppConfig } from "../../config";
import { parseDevUsdcAmount } from "../blockchain/viem/devWalletGateway";

export function resolveRequestedToken(rawInput: string, config: AppConfig): { symbol: string; address: string } | null {
  const requested = rawInput.match(/\b(USDC|USDT|DAI|WBTC)\b/i)?.[1]?.toUpperCase() ?? "USDC";
  const tokenAddresses: Record<string, string> = {
    USDC: config.usdcTokenAddress,
    USDT: config.usdtTokenAddress,
    DAI: config.daiTokenAddress,
    WBTC: config.wbtcTokenAddress,
  };
  const address = tokenAddresses[requested];
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return null;
  return { symbol: requested, address };
}

export function parseDevTokenAmountInput(value: string): { amount: bigint; tokenSymbol: string } {
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]{1,6})?)\s*([A-Za-z]*)$/);
  if (!match) {
    throw new Error('Amount format should look like "100 USDC".');
  }

  const amount = match[1];
  const tokenSymbol = ((match[2] ?? "").toUpperCase() || "USDC");
  if (!["USDC", "USDT"].includes(tokenSymbol)) {
    throw new Error('Use USDC or USDT in this flow, like "100 USDC" or "100 USDT".');
  }

  return {
    amount: parseDevUsdcAmount(amount),
    tokenSymbol,
  };
}

export function parseTokenAmountForButton(value: string, decimals: number): bigint {
  const normalized = value.trim();
  if (!normalized) return 0n;
  const [whole, fraction = ""] = normalized.split(".");
  const wholePart = BigInt(whole || "0");
  const fractionPart = BigInt(fraction.padEnd(decimals, "0").slice(0, decimals) || "0");
  return wholePart * 10n ** BigInt(decimals) + fractionPart;
}

export function parseDuration(value: string): number {
  const match = value.trim().match(/^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i);
  if (!match) throw new Error("Duration must look like 20s, 2m, 24h, or 1d.");
  const amount = Number(match[1]);
  const unit = match[2];
  if (/^d|day/i.test(unit)) return amount * 86_400;
  if (/^h|hr|hour/i.test(unit)) return amount * 3_600;
  if (/^m|min|minute/i.test(unit)) return amount * 60;
  return amount;
}

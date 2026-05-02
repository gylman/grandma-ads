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

export function parseUsdcAmountInput(value: string): bigint {
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]{1,6})?)\s*([A-Za-z]*)$/);
  if (!match) {
    throw new Error('Amount format should look like "100 USDC".');
  }

  const amount = match[1];
  const token = (match[2] ?? "").toUpperCase();
  if (token && token !== "USDC") {
    throw new Error("Only USDC is supported in this flow right now. Use format like 100 USDC.");
  }

  return parseDevUsdcAmount(amount);
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
  const match = value.match(/^(\d+)(h|hr|hrs|hour|hours|d|day|days)$/i);
  if (!match) throw new Error("Duration must look like 24h or 1d.");
  const amount = Number(match[1]);
  return /^d|day/i.test(match[2]) ? amount * 86_400 : amount * 3_600;
}

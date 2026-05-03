import { formatDevTokenAmount } from "../blockchain/viem/devWalletGateway";
import { TelegramBotContext, runWithProcessing, sendPromptForReply } from "./context";
import { balanceSignature, formatWalletOverviewText, friendlyBalanceLookupError, shortAddress } from "./formatters";
import { devWalletButtons } from "./keyboards";
import { explorerTxUrl, htmlLink } from "./proofLinks";
import { escapeHtml } from "./richText";
import { parseDevTokenAmountInput, parseTokenAmountForButton } from "./tokenUtils";

export async function sendDevWalletOverview(ctx: TelegramBotContext, chatId: number, telegramUserId: string): Promise<boolean> {
  const wallet = await ctx.useCases.getDevWallet(telegramUserId);
  if (!wallet) {
    await ctx.api.sendMessage(
      chatId,
      ["No wallet is linked to this Telegram account yet.", "Click Create Wallet to continue."].join("\n"),
      { replyMarkup: devWalletButtons(false) },
    );
    return false;
  }

  try {
    const overview = await ctx.useCases.getDevWalletMajorBalances(telegramUserId);
    const user = await ctx.useCases.getUserByWallet(overview.wallet.address);
    const lockedByTokenAddress = await lockedBalancesForAdvertiser(ctx, overview.wallet.address, overview.balances);
    ctx.state.balanceWatchers.set(chatId, {
      telegramUserId,
      lastSignature: balanceSignature(overview.balances),
    });
    await ctx.api.sendMessage(chatId, formatWalletOverviewText({ walletAddress: overview.wallet.address, ensName: user?.ensName ?? null, balances: overview.balances, lockedByTokenAddress }), {
      replyMarkup: devWalletButtons(true),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "balance lookup failed";
    const user = await ctx.useCases.getUserByWallet(wallet.address);
    await ctx.api.sendMessage(
      chatId,
      [`👛 Wallet:`, user?.ensName ?? wallet.address, user?.ensName ? `Address: ${shortAddress(wallet.address)}` : null, "", `I could not read balances yet: ${friendlyBalanceLookupError(message)}`]
        .filter((line): line is string => line !== null)
        .join("\n"),
    );
  }

  return true;
}

export function createBalanceMonitor(ctx: TelegramBotContext): { pollKnownBalances(): Promise<void> } {
  let balanceMonitorRunning = false;

  async function pollKnownBalances(): Promise<void> {
    if (balanceMonitorRunning) return;
    balanceMonitorRunning = true;

    try {
      for (const [chatId, watcher] of ctx.state.balanceWatchers) {
        try {
          const overview = await ctx.useCases.getDevWalletMajorBalances(watcher.telegramUserId);
          const signature = balanceSignature(overview.balances);
          if (signature === watcher.lastSignature) continue;

          ctx.state.balanceWatchers.set(chatId, { ...watcher, lastSignature: signature });
          const user = await ctx.useCases.getUserByWallet(overview.wallet.address);
          const lockedByTokenAddress = await lockedBalancesForAdvertiser(ctx, overview.wallet.address, overview.balances);
          await ctx.api.sendMessage(chatId, ["Balance updated.", "", formatWalletOverviewText({ walletAddress: overview.wallet.address, ensName: user?.ensName ?? null, balances: overview.balances, lockedByTokenAddress })].join("\n"), {
            replyMarkup: devWalletButtons(true),
          });
        } catch (error) {
          console.error("[telegram]: balance monitor failed", error instanceof Error ? error.message : error);
        }
      }
    } finally {
      balanceMonitorRunning = false;
    }
  }

  return { pollKnownBalances };
}

async function lockedBalancesForAdvertiser(
  ctx: TelegramBotContext,
  walletAddress: string,
  balances: Awaited<ReturnType<TelegramBotContext["useCases"]["getDevWalletMajorBalances"]>>["balances"],
): Promise<Record<string, bigint>> {
  const tokenDecimals = new Map(
    balances
      .filter((balance) => balance.address)
      .map((balance) => [balance.address!.toLowerCase(), balance.decimals]),
  );
  const lockedStatuses = new Set(["FUNDED", "OFFERED", "NEGOTIATING", "ACCEPTED", "AWAITING_POST", "VERIFYING_POST", "ACTIVE"]);
  const lockedByTokenAddress: Record<string, bigint> = {};
  const campaigns = await ctx.useCases.listCampaigns();

  for (const campaign of campaigns) {
    if (!lockedStatuses.has(campaign.status)) continue;
    if (campaign.advertiserWalletAddress.toLowerCase() !== walletAddress.toLowerCase()) continue;

    const tokenAddress = campaign.tokenAddress.toLowerCase();
    const decimals = tokenDecimals.get(tokenAddress);
    if (decimals === undefined) continue;

    try {
      lockedByTokenAddress[tokenAddress] = (lockedByTokenAddress[tokenAddress] ?? 0n) + parseTokenAmountForButton(campaign.amount, decimals);
    } catch {
      continue;
    }
  }

  return lockedByTokenAddress;
}

export async function promptMint(ctx: TelegramBotContext, chatId: number): Promise<void> {
  await sendPromptForReply(ctx, chatId, "Reply with the amount and token.\n\nExamples:\n1000 USDC\n1000 USDT", "DEV_MINT", {
    placeholder: "1000 USDC",
  });
}

export async function promptDeposit(ctx: TelegramBotContext, chatId: number): Promise<void> {
  await sendPromptForReply(
    ctx,
    chatId,
    "Reply with the amount and token to deposit.\n\nExamples:\n100 USDC\n100 USDT",
    "DEV_DEPOSIT",
    { placeholder: "100 USDC" },
  );
}

export async function promptWithdraw(ctx: TelegramBotContext, chatId: number): Promise<void> {
  await sendPromptForReply(
    ctx,
    chatId,
    "Reply with the amount and token to withdraw.\n\nExamples:\n25 USDC\n25 USDT",
    "DEV_WITHDRAW",
    { placeholder: "25 USDC" },
  );
}

export async function createDevWallet(ctx: TelegramBotContext, chatId: number, telegramUserId: string, telegramUsername?: string | null): Promise<void> {
  const wallet = await ctx.useCases.ensureDevWallet(telegramUserId, telegramUsername);
  const user = await ctx.useCases.getUserByWallet(wallet.address);
  await ctx.api.sendMessage(chatId, `<b>Wallet created.</b>\n\n<b>ENS:</b>\n<code>${escapeHtml(user?.ensName ?? "not assigned")}</code>\n\n<b>Address:</b>\n<code>${escapeHtml(wallet.address)}</code>`, {
    parseMode: "HTML",
  });
  await sendDevWalletOverview(ctx, chatId, telegramUserId);
}

export async function sendDevBalanceWithActions(ctx: TelegramBotContext, chatId: number, telegramUserId: string): Promise<void> {
  const shown = await sendDevWalletOverview(ctx, chatId, telegramUserId);
  void shown;
}

export async function mintMockUsdc(ctx: TelegramBotContext, chatId: number, telegramUserId: string, rawAmount: string): Promise<void> {
  const { amount, tokenSymbol } = parseDevTokenAmountInput(rawAmount);
  const result = await runWithProcessing(ctx, chatId, async () => ctx.useCases.mintDevWalletMockToken(telegramUserId, tokenSymbol, amount));
  const user = await ctx.useCases.getUserByWallet(result.wallet.address);
  await ctx.api.sendMessage(
    chatId,
    `<b>Mint Complete</b>\n\n<b>Amount:</b> ${escapeHtml(formatDevTokenAmount(amount, result.token.decimals))} ${escapeHtml(result.token.symbol)}\n<b>Wallet:</b> <code>${escapeHtml(user?.ensName ?? shortAddress(result.wallet.address))}</code>\n\n${htmlLink("View Mint Transaction", explorerTxUrl(ctx.config, result.txHash))}`,
    {
      parseMode: "HTML",
    },
  );
  await sendDevWalletOverview(ctx, chatId, telegramUserId);
}

export async function depositMockUsdc(ctx: TelegramBotContext, chatId: number, telegramUserId: string, rawAmount: string): Promise<void> {
  const { amount, tokenSymbol } = parseDevTokenAmountInput(rawAmount);
  const result = await runWithProcessing(ctx, chatId, async () => ctx.useCases.depositDevWalletToken(telegramUserId, tokenSymbol, amount));
  await ctx.api.sendMessage(
    chatId,
    [
      `Deposited ${escapeHtml(formatDevTokenAmount(amount, result.token.decimals))} ${escapeHtml(result.token.symbol)} into escrow.`,
      "",
      htmlLink("View Deposit Transaction", explorerTxUrl(ctx.config, result.txHash)),
    ].join("\n"),
    { parseMode: "HTML" },
  );
  await sendDevWalletOverview(ctx, chatId, telegramUserId);
}

export async function withdrawMockUsdc(ctx: TelegramBotContext, chatId: number, telegramUserId: string, rawAmount: string): Promise<void> {
  const { amount, tokenSymbol } = parseDevTokenAmountInput(rawAmount);
  const result = await runWithProcessing(ctx, chatId, async () => ctx.useCases.withdrawDevWalletToken(telegramUserId, tokenSymbol, amount));
  await ctx.api.sendMessage(
    chatId,
    [
      `Withdrew ${escapeHtml(formatDevTokenAmount(amount, result.token.decimals))} ${escapeHtml(result.token.symbol)} from escrow.`,
      "",
      htmlLink("View Withdrawal Transaction", explorerTxUrl(ctx.config, result.txHash)),
    ].join("\n"),
    { parseMode: "HTML" },
  );
  await sendDevWalletOverview(ctx, chatId, telegramUserId);
}

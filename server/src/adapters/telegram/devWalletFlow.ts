import { formatDevUsdcAmount } from "../blockchain/viem/devWalletGateway";
import { TelegramBotContext, sendPromptForReply } from "./context";
import { balanceSignature, formatMajorBalances, friendlyBalanceLookupError } from "./formatters";
import { checkBalanceButton, devWalletButtons } from "./keyboards";
import { escapeHtml } from "./richText";
import { parseUsdcAmountInput } from "./tokenUtils";

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
    ctx.state.balanceWatchers.set(chatId, {
      telegramUserId,
      lastSignature: balanceSignature(overview.balances),
    });
    await ctx.api.sendMessage(chatId, [`Wallet: ${overview.wallet.address}`, `Provider: ${overview.wallet.provider}`, "", "Balances:", ...formatMajorBalances(overview.balances)].join("\n"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "balance lookup failed";
    await ctx.api.sendMessage(
      chatId,
      [`Wallet: ${wallet.address}`, `Provider: ${wallet.provider}`, "", `I could not read balances yet: ${friendlyBalanceLookupError(message)}`].join("\n"),
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
          await ctx.api.sendMessage(chatId, ["Balance updated.", "", `Wallet: ${overview.wallet.address}`, "", ...formatMajorBalances(overview.balances)].join("\n"));
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

export async function promptMint(ctx: TelegramBotContext, chatId: number): Promise<void> {
  await sendPromptForReply(ctx, chatId, "Reply with amount and token.\nExample: 1000 USDC", "DEV_MINT", {
    placeholder: "1000 USDC",
  });
}

export async function promptDeposit(ctx: TelegramBotContext, chatId: number): Promise<void> {
  await sendPromptForReply(
    ctx,
    chatId,
    "Reply with amount and token to deposit.\nExample: 100 USDC",
    "DEV_DEPOSIT",
    { placeholder: "100 USDC" },
  );
}

export async function promptWithdraw(ctx: TelegramBotContext, chatId: number): Promise<void> {
  await sendPromptForReply(
    ctx,
    chatId,
    "Reply with amount and token to withdraw.\nExample: 25 USDC",
    "DEV_WITHDRAW",
    { placeholder: "25 USDC" },
  );
}

export async function createDevWallet(ctx: TelegramBotContext, chatId: number, telegramUserId: string, telegramUsername?: string | null): Promise<void> {
  const wallet = await ctx.useCases.ensureDevWallet(telegramUserId, telegramUsername);
  const user = await ctx.useCases.getUserByWallet(wallet.address);
  await ctx.api.sendMessage(chatId, `<b>Wallet Created</b>\n\n<b>ENS:</b> <code>${escapeHtml(user?.ensName ?? "not assigned")}</code>\n<b>Address:</b> <code>${escapeHtml(wallet.address)}</code>\n<b>Provider:</b> ${escapeHtml(wallet.provider)}`, {
    parseMode: "HTML",
  });
  await sendDevWalletOverview(ctx, chatId, telegramUserId);
  await ctx.api.sendMessage(chatId, "Wallet actions:", { replyMarkup: devWalletButtons(true) });
}

export async function sendDevBalanceWithActions(ctx: TelegramBotContext, chatId: number, telegramUserId: string): Promise<void> {
  const shown = await sendDevWalletOverview(ctx, chatId, telegramUserId);
  if (shown) {
    await ctx.api.sendMessage(chatId, "Wallet actions:", { replyMarkup: devWalletButtons(true) });
  }
}

export async function mintMockUsdc(ctx: TelegramBotContext, chatId: number, telegramUserId: string, rawAmount: string): Promise<void> {
  const amount = parseUsdcAmountInput(rawAmount);
  const result = await ctx.useCases.mintDevWalletMockUsdc(telegramUserId, amount);
  await ctx.api.sendMessage(
    chatId,
    `<b>Mint Complete</b>\n\n<b>Amount:</b> ${escapeHtml(formatDevUsdcAmount(amount))} USDC\n<b>Wallet:</b> <code>${escapeHtml(result.wallet.address)}</code>\n<b>Tx:</b> <code>${escapeHtml(result.txHash)}</code>`,
    {
      replyMarkup: checkBalanceButton(),
      parseMode: "HTML",
    },
  );
}

export async function depositMockUsdc(ctx: TelegramBotContext, chatId: number, telegramUserId: string, rawAmount: string): Promise<void> {
  const amount = parseUsdcAmountInput(rawAmount);
  const result = await ctx.useCases.depositDevWalletMockUsdc(telegramUserId, amount);
  await ctx.api.sendMessage(chatId, [`Deposited ${formatDevUsdcAmount(amount)} mock USDC into escrow with a gasless relay.`, `Sponsored tx: ${result.txHash}`].join("\n"));
}

export async function withdrawMockUsdc(ctx: TelegramBotContext, chatId: number, telegramUserId: string, rawAmount: string): Promise<void> {
  const amount = parseUsdcAmountInput(rawAmount);
  const result = await ctx.useCases.withdrawDevWalletMockUsdc(telegramUserId, amount);
  await ctx.api.sendMessage(chatId, `Withdrew ${formatDevUsdcAmount(amount)} mock USDC from escrow.\nTx: ${result.txHash}`);
}

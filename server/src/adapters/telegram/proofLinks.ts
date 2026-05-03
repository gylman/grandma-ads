import { AppConfig } from "../../config";
import { Campaign, CampaignEnsEventType } from "../../domain/types";

export function eventSlug(type: CampaignEnsEventType): string {
  return type.toLowerCase();
}

export function explorerTxUrl(config: AppConfig, txHash: string): string {
  const baseUrl = config.chainId === 11155111 ? "https://sepolia.etherscan.io" : "https://etherscan.io";
  return `${baseUrl}/tx/${txHash}`;
}

export function adProofUrl(config: AppConfig, onchainCampaignId: string | number | bigint): string {
  return `${config.clientUrl.replace(/\/$/, "")}/proof/ads/${String(onchainCampaignId)}`;
}

export function adEventProofUrl(
  config: AppConfig,
  onchainCampaignId: string | number | bigint,
  eventType: CampaignEnsEventType,
): string {
  return `${adProofUrl(config, onchainCampaignId)}/${eventSlug(eventType)}`;
}

export function htmlLink(label: string, url: string): string {
  return `<a href="${escapeAttribute(url)}">${escapeHtml(label)}</a>`;
}

export function fundingProofLinks(config: AppConfig, campaign: Campaign, txHash: string): string[] {
  if (!campaign.onchainCampaignId) {
    return [htmlLink("View Funding Transaction", explorerTxUrl(config, txHash))];
  }

  return [
    htmlLink("View Funding Proof", adEventProofUrl(config, campaign.onchainCampaignId, "LOCKED")),
    htmlLink("View Ad Record", adProofUrl(config, campaign.onchainCampaignId)),
    htmlLink("View Funding Transaction", explorerTxUrl(config, txHash)),
  ];
}

export function eventProofLinks(
  config: AppConfig,
  campaign: Campaign,
  eventType: CampaignEnsEventType,
  label: string,
  txHash?: string | null,
): string[] {
  if (!campaign.onchainCampaignId) return txHash ? [htmlLink(`View ${label} Transaction`, explorerTxUrl(config, txHash))] : [];

  return [
    htmlLink(`View ${label} Proof`, adEventProofUrl(config, campaign.onchainCampaignId, eventType)),
    htmlLink("View Ad Record", adProofUrl(config, campaign.onchainCampaignId)),
    txHash ? htmlLink(`View ${label} Transaction`, explorerTxUrl(config, txHash)) : null,
  ].filter((item): item is string => item !== null);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

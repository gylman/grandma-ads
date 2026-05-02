import { AgentGateway } from '../../application/ports/agentGateway';
import { checkContentSafety } from '../../domain/moderation';
import { Campaign } from '../../domain/types';
import { extractCampaignIntake, generatePosterOffer } from '../../application/services/agentService';

export function createDeterministicAgentGateway(): AgentGateway {
  return {
    async analyzeCampaignRequest(message) {
      const intake = extractCampaignIntake(message);
      const safety = checkContentSafety(intake.adText ?? message);
      const recommendedAdText = intake.adText ?? 'Sponsored post';

      return {
        intake,
        safety,
        recommendedAdText,
        summary: summarizeIntake(intake.targetChannel, intake.amount, intake.durationSeconds),
      };
    },

    async suggestAdCopy({ campaign, instruction }) {
      const base = campaign.approvedText ?? campaign.requestedText ?? 'Check out this project.';
      const instructionSuffix = instruction ? `\n\n${instruction}` : '';
      return {
        text: `${base}${instructionSuffix}`.trim(),
        rationale: 'Fallback copy keeps the current approved text because OPENAI_API_KEY is not configured.',
      };
    },

    async generatePosterOffer(campaign: Campaign) {
      return generatePosterOffer(campaign);
    },

    async suggestCounterReply({ campaign, counterMessage }) {
      return {
        reply: [
          `Counter received for ${campaign.id}.`,
          `Current offer: ${campaign.amount} for ${formatDuration(campaign.durationSeconds)}.`,
          `Poster request: ${counterMessage}`,
          'Advertiser can reply with /accept_counter <campaignId> <amount> <duration>, for example /accept_counter cmp_1 120 24h.',
        ].join('\n'),
        suggestedAmount: null,
        suggestedDurationSeconds: null,
      };
    },
  };
}

function summarizeIntake(targetChannel?: string, amount?: string, durationSeconds?: number): string {
  return `Draft for ${targetChannel ?? 'a channel'} with ${amount ?? 'unknown'} USDC for ${durationSeconds ? formatDuration(durationSeconds) : 'unknown duration'}.`;
}

function formatDuration(durationSeconds: number): string {
  if (durationSeconds % 86_400 === 0) return `${durationSeconds / 86_400}d`;
  if (durationSeconds % 3_600 === 0) return `${durationSeconds / 3_600}h`;
  return `${durationSeconds}s`;
}

import { AgentGateway, AdCopySuggestion, CampaignDraftRecommendation, CounterOfferSuggestion } from '../../application/ports/agentGateway';
import { extractCampaignIntake, generatePosterOffer } from '../../application/services/agentService';
import { AppConfig } from '../../config';
import { checkContentSafety } from '../../domain/moderation';
import { Campaign, RiskLevel } from '../../domain/types';

type JsonSchema = Record<string, unknown>;

export function createOpenAiAgentGateway(config: AppConfig): AgentGateway {
  async function requestStructured<T>(input: { system: string; user: string; schemaName: string; schema: JsonSchema }): Promise<T> {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.openaiModel,
        input: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: input.schemaName,
            strict: true,
            schema: input.schema,
          },
        },
      }),
    });

    const payload = (await response.json()) as unknown;
    if (!response.ok) {
      throw new Error(`OpenAI request failed: ${extractOpenAiError(payload)}`);
    }

    return JSON.parse(extractOutputText(payload)) as T;
  }

  return {
    async analyzeCampaignRequest(message): Promise<CampaignDraftRecommendation> {
      const fallbackIntake = extractCampaignIntake(message);
      const result = await requestStructured<{
        targetChannel: string | null;
        amount: string | null;
        tokenSymbol: string | null;
        durationSeconds: number | null;
        adText: string | null;
        recommendedAdText: string;
        missingFields: string[];
        allowed: boolean;
        riskLevel: RiskLevel;
        reasons: string[];
        suggestedFixes: string[];
        summary: string;
      }>({
        schemaName: 'campaign_intake',
        schema: campaignIntakeSchema,
        system: [
          'You are the campaign intake and safety assistant for a Telegram sponsored-post escrow marketplace.',
          'Extract structured campaign terms, suggest concise ad copy, and flag prohibited content.',
          'Do not invent budget, duration, target channel, or token. If missing, return null and include the field in missingFields.',
          'Allowed ad formats are text, image, and image plus caption. Keep recommendations simple and non-technical.',
          'Return JSON only.',
        ].join('\n'),
        user: message,
      });

      const intake = {
        targetChannel: result.targetChannel ?? fallbackIntake.targetChannel,
        amount: result.amount ?? fallbackIntake.amount,
        tokenSymbol: result.tokenSymbol ?? fallbackIntake.tokenSymbol ?? undefined,
        durationSeconds: result.durationSeconds ?? fallbackIntake.durationSeconds,
        adText: result.adText ?? fallbackIntake.adText,
        missingFields: mergeMissingFields(result.missingFields, fallbackIntake.missingFields),
      };
      const deterministicSafety = checkContentSafety(intake.adText ?? message);
      const safety = {
        allowed: result.allowed && deterministicSafety.allowed,
        riskLevel: deterministicSafety.allowed ? result.riskLevel : deterministicSafety.riskLevel,
        reasons: [...new Set([...result.reasons, ...deterministicSafety.reasons])],
        suggestedFixes: [...new Set([...result.suggestedFixes, ...deterministicSafety.suggestedFixes])],
      };

      return {
        intake,
        safety,
        recommendedAdText: result.recommendedAdText,
        summary: result.summary,
      };
    },

    async suggestAdCopy({ campaign, instruction }): Promise<AdCopySuggestion> {
      return requestStructured<AdCopySuggestion>({
        schemaName: 'ad_copy_suggestion',
        schema: adCopySchema,
        system: [
          'You improve Telegram sponsored-post copy.',
          'Keep the copy concise, concrete, and suitable for exact copy/paste into a Telegram channel.',
          'Do not add prohibited claims, deceptive financial guarantees, or unsupported promises.',
          'Return JSON only.',
        ].join('\n'),
        user: JSON.stringify({
          channel: campaign.targetTelegramChannelUsername,
          amount: campaign.amount,
          durationSeconds: campaign.durationSeconds,
          currentText: campaign.approvedText ?? campaign.requestedText,
          instruction: instruction ?? null,
        }),
      });
    },

    async generatePosterOffer(campaign: Campaign): Promise<string> {
      const result = await requestStructured<{ message: string }>({
        schemaName: 'poster_offer',
        schema: posterOfferSchema,
        system: [
          'You write clear Telegram bot offer messages for channel owners.',
          'Include amount, duration, target channel, exact posting rule, and payment condition.',
          'Do not change campaign terms. Do not say funds are released unless verification passes.',
          'Return JSON only.',
        ].join('\n'),
        user: JSON.stringify(campaign),
      });

      return result.message || generatePosterOffer(campaign);
    },

    async suggestCounterReply({ campaign, counterMessage }): Promise<CounterOfferSuggestion> {
      return requestStructured<CounterOfferSuggestion>({
        schemaName: 'counter_offer_reply',
        schema: counterOfferSchema,
        system: [
          'You help negotiate Telegram sponsored-post campaign offers.',
          'Summarize the counteroffer clearly for the advertiser.',
          'You may suggest a reasonable reply, but you must not finalize changes or approve more money without advertiser confirmation.',
          'Return JSON only.',
        ].join('\n'),
        user: JSON.stringify({ campaign, counterMessage }),
      });
    },
  };
}

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const nullableInteger = { anyOf: [{ type: 'integer' }, { type: 'null' }] };

const campaignIntakeSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    targetChannel: nullableString,
    amount: nullableString,
    tokenSymbol: nullableString,
    durationSeconds: nullableInteger,
    adText: nullableString,
    recommendedAdText: { type: 'string' },
    missingFields: {
      type: 'array',
      items: { type: 'string', enum: ['targetChannel', 'amount', 'durationSeconds', 'adText'] },
    },
    allowed: { type: 'boolean' },
    riskLevel: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
    reasons: { type: 'array', items: { type: 'string' } },
    suggestedFixes: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: [
    'targetChannel',
    'amount',
    'tokenSymbol',
    'durationSeconds',
    'adText',
    'recommendedAdText',
    'missingFields',
    'allowed',
    'riskLevel',
    'reasons',
    'suggestedFixes',
    'summary',
  ],
};

const adCopySchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text: { type: 'string' },
    rationale: { type: 'string' },
  },
  required: ['text', 'rationale'],
};

const posterOfferSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    message: { type: 'string' },
  },
  required: ['message'],
};

const counterOfferSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reply: { type: 'string' },
    suggestedAmount: nullableString,
    suggestedDurationSeconds: nullableInteger,
  },
  required: ['reply', 'suggestedAmount', 'suggestedDurationSeconds'],
};

function extractOutputText(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) throw new Error('OpenAI response was not an object');

  const direct = (payload as { output_text?: unknown }).output_text;
  if (typeof direct === 'string') return direct;

  const output = (payload as { output?: unknown }).output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (typeof item !== 'object' || item === null) continue;
      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) continue;

      for (const part of content) {
        if (typeof part !== 'object' || part === null) continue;
        const text = (part as { text?: unknown }).text;
        if (typeof text === 'string') return text;
      }
    }
  }

  throw new Error('OpenAI response did not include output text');
}

function extractOpenAiError(payload: unknown): string {
  if (typeof payload === 'object' && payload !== null) {
    const error = (payload as { error?: { message?: string } }).error;
    if (error?.message) return error.message;
  }

  return 'unknown error';
}

function mergeMissingFields(openAiFields: string[], fallbackFields: string[]): CampaignDraftRecommendation['intake']['missingFields'] {
  return [...new Set([...openAiFields, ...fallbackFields])] as CampaignDraftRecommendation['intake']['missingFields'];
}

import { SafetyResult } from './types';

const prohibitedRules = [
  { label: 'drugs', pattern: /\b(cocaine|heroin|fentanyl|meth|mdma)\b/i },
  { label: 'adult sexual content', pattern: /\b(porn|xxx|escort|onlyfans leak)\b/i },
  { label: 'scams or phishing', pattern: /\b(seed phrase|wallet drainer|free airdrop claim|phishing)\b/i },
  { label: 'malware', pattern: /\b(malware|keylogger|trojan|ransomware)\b/i },
  { label: 'illegal goods or services', pattern: /\b(fake passport|stolen card|carding)\b/i },
  { label: 'hate or extremist content', pattern: /\b(nazi|isis|white power)\b/i },
  { label: 'deceptive financial guarantees', pattern: /\b(guaranteed profit|risk[- ]free returns|100x guaranteed)\b/i },
];

export function checkContentSafety(text: string | null | undefined): SafetyResult {
  const content = text?.trim() ?? '';
  const reasons = prohibitedRules.filter((rule) => rule.pattern.test(content)).map((rule) => rule.label);

  if (reasons.length > 0) {
    return {
      allowed: false,
      riskLevel: 'HIGH',
      reasons,
      suggestedFixes: ['Remove prohibited claims or content before sending this offer.'],
    };
  }

  return {
    allowed: true,
    riskLevel: content.length === 0 ? 'LOW' : 'LOW',
    reasons: [],
    suggestedFixes: [],
  };
}

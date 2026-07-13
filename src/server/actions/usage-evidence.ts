import type { CostEvidence, TokenEvidence } from '../types.js';

export type RuntimeUsageEvidence = {
  tokens: TokenEvidence;
  cost: CostEvidence;
};

export function normalizeUsageEvidence(usage: Record<string, unknown> | null | undefined): RuntimeUsageEvidence {
  const input = tokenCount(usage?.['prompt_tokens'] ?? usage?.['input_tokens']);
  const output = tokenCount(usage?.['completion_tokens'] ?? usage?.['output_tokens']);
  const reportedTotal = tokenCount(usage?.['total_tokens']);
  const derivedTotal = input !== null || output !== null ? (input ?? 0) + (output ?? 0) : null;
  const total = reportedTotal ?? derivedTotal;
  const amount = finiteAmount(usage?.['cost']);
  const currency = currencyCode(usage?.['currency']);
  const rounds = tokenCount(usage?.['usage_rounds']);
  const tokenRounds = tokenCount(usage?.['token_reported_rounds']);
  const costRounds = tokenCount(usage?.['cost_reported_rounds']);

  return {
    tokens: total === null
      ? { status: 'unavailable', reason: 'provider_did_not_report_tokens' }
      : {
          status: 'available',
          source: 'provider_reported',
          completeness: rounds !== null && tokenRounds !== null && tokenRounds < rounds ? 'partial' : 'complete',
          input,
          output,
          total,
        },
    cost: amount !== null && currency !== null
      ? {
          status: 'available',
          source: 'provider_reported',
          completeness: rounds !== null && costRounds !== null && costRounds < rounds ? 'partial' : 'complete',
          amount,
          currency,
        }
      : { status: 'unavailable', reason: 'provider_did_not_report_cost' },
  };
}

export function mergeProviderUsage(usages: Array<Record<string, unknown> | null | undefined>): Record<string, number | string> {
  let input = 0;
  let output = 0;
  let total = 0;
  let hasInput = false;
  let hasOutput = false;
  let hasTotal = false;
  let cost = 0;
  let costCurrency: string | null = null;
  let costIsConsistent = true;
  let hasCost = false;
  let tokenReportedRounds = 0;
  let costReportedRounds = 0;

  for (const usage of usages) {
    const normalized = normalizeUsageEvidence(usage);
    const roundCost = normalized.cost;
    if (roundCost.status === 'available') {
      if (costCurrency !== null && costCurrency !== roundCost.currency) costIsConsistent = false;
      costCurrency ??= roundCost.currency;
      cost += roundCost.amount;
      hasCost = true;
      costReportedRounds += 1;
    }
    const evidence = normalized.tokens;
    if (evidence.status !== 'available') continue;
    tokenReportedRounds += 1;
    if (evidence.input !== null) {
      input += evidence.input;
      hasInput = true;
    }
    if (evidence.output !== null) {
      output += evidence.output;
      hasOutput = true;
    }
    total += evidence.total;
    hasTotal = true;
  }

  return {
    ...(hasInput ? { prompt_tokens: input } : {}),
    ...(hasOutput ? { completion_tokens: output } : {}),
    ...(hasTotal ? { total_tokens: total } : {}),
    ...(hasCost && costIsConsistent && costCurrency ? { cost, currency: costCurrency } : {}),
    usage_rounds: usages.length,
    token_reported_rounds: tokenReportedRounds,
    cost_reported_rounds: costReportedRounds,
  };
}

function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function finiteAmount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function currencyCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

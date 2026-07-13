import { describe, expect, it } from 'vitest';
import { mergeProviderUsage, normalizeUsageEvidence } from '../src/server/actions/usage-evidence.js';

describe('runtime usage evidence', () => {
  it('records provider-reported tokens without inventing a cost', () => {
    expect(normalizeUsageEvidence({
      prompt_tokens: 120,
      completion_tokens: 30,
      total_tokens: 150,
    })).toEqual({
      tokens: {
        status: 'available',
        source: 'provider_reported',
        completeness: 'complete',
        input: 120,
        output: 30,
        total: 150,
      },
      cost: {
        status: 'unavailable',
        reason: 'provider_did_not_report_cost',
      },
    });
  });

  it('adds every provider continuation round instead of keeping only the last response', () => {
    expect(normalizeUsageEvidence(mergeProviderUsage([
      { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
      { prompt_tokens: 160, completion_tokens: 25, total_tokens: 185 },
    ])).tokens).toEqual({
      status: 'available',
      source: 'provider_reported',
      completeness: 'complete',
      input: 260,
      output: 65,
      total: 325,
    });
  });

  it('marks absent token data unavailable instead of displaying a fake zero', () => {
    expect(normalizeUsageEvidence(undefined)).toEqual({
      tokens: {
        status: 'unavailable',
        reason: 'provider_did_not_report_tokens',
      },
      cost: {
        status: 'unavailable',
        reason: 'provider_did_not_report_cost',
      },
    });
  });

  it('records cost only when the provider explicitly reports amount and currency', () => {
    expect(normalizeUsageEvidence(mergeProviderUsage([
      { cost: 0.0125, currency: 'usd' },
    ])).cost).toEqual({
      status: 'available',
      source: 'provider_reported',
      completeness: 'complete',
      amount: 0.0125,
      currency: 'USD',
    });
  });

  it('marks totals partial when any continuation round omits token usage', () => {
    expect(normalizeUsageEvidence(mergeProviderUsage([
      { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      undefined,
    ])).tokens).toMatchObject({
      status: 'available',
      source: 'provider_reported',
      completeness: 'partial',
      total: 120,
    });
  });
});

const PRICES_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'gpt-5-mini': { input: 0.25, output: 2.0 },
  'gpt-5.5': { input: 1.25, output: 10.0 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
};

// Modelo fora da tabela: assume preço alto para o orçamento errar para o lado seguro.
const FALLBACK = { input: 5.0, output: 25.0 };

export function estimateCostBrl(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  usdBrlRate: number,
): number {
  const p = PRICES_USD_PER_MTOK[modelId] ?? FALLBACK;
  const usd = (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
  return usd * usdBrlRate;
}

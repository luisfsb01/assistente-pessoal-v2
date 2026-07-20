import { addDays } from './dates.js';

/** Intervalo de importação do banco a partir do último dia importado com sucesso.
 *  - sem estado: importa só ontem.
 *  - normal: reconsulta os últimos dias para capturar lançamentos tardios.
 *  - após indisponibilidade: recupera do dia seguinte ao último até ontem.
 *  - teto de `maxLookbackDays` para não puxar um intervalo gigante. */
export function computeSyncRange(
  lastImported: string | null,
  yesterday: string,
  maxLookbackDays = 30,
  lateArrivalLookbackDays = 3,
): { from: string; to: string } {
  if (!lastImported) return { from: yesterday, to: yesterday };
  const floor = addDays(yesterday, -maxLookbackDays);
  const nextUnimported = addDays(lastImported, 1);
  const recentWindow = addDays(yesterday, -lateArrivalLookbackDays);
  let from = nextUnimported < recentWindow ? nextUnimported : recentWindow;
  if (from < floor) from = floor;
  if (from > yesterday) from = yesterday;
  return { from, to: yesterday };
}

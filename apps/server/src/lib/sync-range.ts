import { addDays } from './dates.js';

/** Intervalo de importação do banco a partir do último dia importado com sucesso.
 *  - sem estado: importa só ontem.
 *  - normal: importa só ontem.
 *  - após indisponibilidade: recupera do dia seguinte ao último até ontem.
 *  - teto de `maxLookbackDays` para não puxar um intervalo gigante. */
export function computeSyncRange(
  lastImported: string | null,
  yesterday: string,
  maxLookbackDays = 30,
): { from: string; to: string } {
  if (!lastImported) return { from: yesterday, to: yesterday };
  const floor = addDays(yesterday, -maxLookbackDays);
  let from = addDays(lastImported, 1);
  if (from < floor) from = floor;
  if (from > yesterday) from = yesterday;
  return { from, to: yesterday };
}

/** Interpretação pura dos payloads de status do Banco MCP — sem I/O.
 *
 *  Dois sinais independentes indicam banco com problema:
 *   1. provider_status.your_banks_affected — incidente upstream no provedor/banco.
 *   2. item_status — conexão em LOGIN_ERROR / erro de execução que o usuário
 *      precisa reconectar.
 */

export interface BankHealthProblem {
  kind: 'provider_incident' | 'connection_error';
  bank: string | null;
  detail: string;
  severity?: string;
}

export interface BankHealthSummary {
  problems: BankHealthProblem[];
  providerDegraded: boolean;
}

const HEALTHY_ITEM_STATUSES = new Set(['UPDATED', 'UPDATING']);

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function inferBank(incidentName: string, connectedBanks: string[]): string | null {
  const lower = incidentName.toLowerCase();
  return connectedBanks.find((b) => lower.includes(b.toLowerCase())) ?? null;
}

export function summarizeBankHealth(providerStatus: unknown, itemStatus: unknown): BankHealthSummary {
  const problems: BankHealthProblem[] = [];

  const provider = asRecord(providerStatus);
  const providerDegraded = provider?.degraded === true;
  const connectedBanks = asArray(provider?.your_connected_banks).map((b) => String(b));
  for (const raw of asArray(provider?.your_banks_affected)) {
    const inc = asRecord(raw);
    if (!inc) continue;
    const name = String(inc.name ?? '').trim();
    if (!name) continue;
    problems.push({
      kind: 'provider_incident',
      bank: inferBank(name, connectedBanks),
      detail: name,
      severity: inc.impact != null ? String(inc.impact) : undefined,
    });
  }

  const itemsRoot = asRecord(itemStatus);
  for (const raw of asArray(itemsRoot?.items)) {
    const it = asRecord(raw);
    if (!it) continue;
    const status = String(it.status ?? '');
    const execution = String(it.executionStatus ?? '');
    const ok = HEALTHY_ITEM_STATUSES.has(status) && (execution === '' || execution === 'SUCCESS');
    if (ok) continue;
    const connector = asRecord(it.connector);
    problems.push({
      kind: 'connection_error',
      bank: connector?.name != null ? String(connector.name) : null,
      detail: execution && execution !== 'SUCCESS' ? `${status} (${execution})` : status,
      severity: status,
    });
  }

  return { problems, providerDegraded };
}

/** Alerta enviado quando a revisão diária importou zero E há problema no banco. */
export function formatBankHealthAlert(summary: BankHealthSummary): string {
  const lines = [
    '⚠️ Não trouxe gastos de ontem para conferência — e detectei um problema nos bancos, então provavelmente é por isso (não é o seu sistema):',
    '',
  ];
  for (const p of summary.problems) {
    const prefix = p.bank ? `${p.bank}: ` : '';
    lines.push(`• ${prefix}${p.detail}`);
  }
  lines.push('');
  lines.push('Assim que o banco normalizar, os lançamentos entram no próximo update. 🔁');
  return lines.join('\n');
}

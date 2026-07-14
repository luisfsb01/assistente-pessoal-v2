import { getConfig } from './config.js';
import { mapProviderTx, type BankTransaction } from './banco-map.js';
import { summarizeBankHealth, type BankHealthSummary } from './banco-health.js';

export type { BankTransaction };

export function isBankConfigured(): boolean {
  return Boolean(getConfig().BANCO_MCP_TOKEN);
}

// ── Estado da sessão MCP (cache em módulo) ──────────────────────────────────
let sessionId: string | null = null;
let reqId = 1;

const BANCO_MCP_BASE_URL = 'https://api.mcp.ai';

/** Envia um request JSON-RPC ao endpoint Streamable-HTTP e parseia o corpo SSE. */
async function mcpRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
  const id = reqId++;
  const headers: Record<string, string> = {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
  };
  // Bearer em toda requisição: sessões recriadas já nascem autenticadas.
  const token = getConfig().BANCO_MCP_TOKEN;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (sessionId) headers['mcp-session-id'] = sessionId;

  const res = await fetch(`${BANCO_MCP_BASE_URL}/banco`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });

  if (!res.ok) {
    const body = await res.text().then((t) => t.slice(0, 300));
    throw new Error(`Banco MCP HTTP ${res.status}: ${body}`);
  }

  const newSession = res.headers.get('mcp-session-id');
  if (newSession) sessionId = newSession;

  const text = await res.text();
  const dataLine = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('data: '));
  if (!dataLine) throw new Error(`Banco MCP: no data line in response. Raw: ${text.slice(0, 300)}`);

  const parsed = JSON.parse(dataLine.slice('data: '.length)) as {
    id?: number;
    result?: unknown;
    error?: { message?: string };
  };

  if (parsed.error) {
    throw new Error(`Banco MCP JSON-RPC error: ${parsed.error.message ?? JSON.stringify(parsed.error)}`);
  }
  return parsed.result;
}

async function ensureSession(): Promise<void> {
  if (sessionId) return;
  await mcpRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'assistente-pessoal-v2', version: '1.0' },
  });
}

async function callToolRaw(name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = (await mcpRequest('tools/call', { name, arguments: args })) as {
    content?: Array<{ type: string; text: string }>;
  } | null;

  const text = result?.content?.[0]?.text;
  if (text === undefined || text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Sessão expirada aparece como erro de "session", 404 ou 401. */
export function isStaleSessionError(message: string): boolean {
  return /session|404|401|authentication_required/i.test(message);
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const attempt = async (): Promise<unknown> => {
    await ensureSession();
    const result = await callToolRaw(name, args);
    // O servidor responde 200 mesmo em erro de negócio, com { error, message } no payload.
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      const r = result as { error?: string; message?: string };
      if (r.error) {
        if (r.error === 'free_tier_limit_reached') {
          throw new Error(
            'Limite do plano grátis do Banco MCP atingido. Assine um plano em https://app.mcp.ai para continuar importando transações.',
          );
        }
        throw new Error(`Banco MCP: ${r.message ?? r.error}`);
      }
    }
    return result;
  };
  try {
    return await attempt();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isStaleSessionError(msg)) {
      sessionId = null;
      try {
        return await attempt();
      } catch (retryErr) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        if (/401|authentication_required/i.test(retryMsg)) {
          throw new Error(
            'Banco MCP: token inválido ou expirado. Renove o BANCO_MCP_TOKEN em https://app.mcp.ai/agent-auth?toolkit=tk_pub_openfinance',
          );
        }
        throw retryErr;
      }
    }
    throw err;
  }
}

// ── API pública ──────────────────────────────────────────────────────────────

/** Saúde dos bancos: incidentes do provedor + status das conexões.
 *  Falha de rede degrada para "sem problemas detectados". */
export async function checkBankHealth(): Promise<BankHealthSummary> {
  const [provider, items] = await Promise.all([
    callTool('openfinance_provider_status', {}).catch(() => null),
    callTool('openfinance_get_item_status', {}).catch(() => null),
  ]);
  return summarizeBankHealth(provider, items);
}

export async function listBankTransactions(sinceDate: string, toDate?: string): Promise<BankTransaction[]> {
  const accountsResult = (await callTool('openfinance_list_accounts', {})) as {
    results?: Array<{ id: string; type: 'BANK' | 'CREDIT' }>;
  } | null;

  const accounts = accountsResult?.results ?? [];
  const all: BankTransaction[] = [];
  for (const account of accounts) {
    const txResult = (await callTool('openfinance_list_transactions', {
      account_id: account.id,
      from: sinceDate,
      to: toDate ?? sinceDate,
      page_size: 200,
    })) as { results?: Array<Record<string, unknown>> } | null;

    for (const tx of txResult?.results ?? []) {
      const mapped = mapProviderTx(tx, account.type);
      if (mapped) all.push(mapped);
    }
  }
  return all;
}

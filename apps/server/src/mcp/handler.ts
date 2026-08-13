import { timingSafeEqual } from 'node:crypto';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { bearerToken } from '../api/auth.js';
import { FixedWindowRateLimiter } from '../lib/rate-limit.js';
import { createFinanceMcpServer } from './finance-tools.js';

export type McpBridge = {
  fetch(request: Request): Promise<Response>;
};

function equalSecret(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function jsonRpcAuthError(status: 401 | 403): Response {
  return Response.json(
    {
      jsonrpc: '2.0',
      error: { code: -32001, message: status === 401 ? 'Authentication required' : 'Forbidden' },
      id: null,
    },
    {
      status,
      headers: status === 401 ? { 'WWW-Authenticate': 'Bearer realm="assistente-pessoal-v2"' } : undefined,
    },
  );
}

/** Cria a ponte autenticada. Sem token configurado, a rota falha fechada. */
export function createMcpBridge(expectedToken?: string): McpBridge {
  const handler = createMcpHandler(() => createFinanceMcpServer());
  const limiter = new FixedWindowRateLimiter(120, 60_000);

  return {
    async fetch(request: Request): Promise<Response> {
      if (!expectedToken) return jsonRpcAuthError(403);
      if (!equalSecret(bearerToken(request.headers.get('Authorization') ?? undefined), expectedToken)) {
        return jsonRpcAuthError(401);
      }
      if (!limiter.allow('authenticated-hermes')) {
        return Response.json(
          { jsonrpc: '2.0', error: { code: -32002, message: 'Too many requests' }, id: null },
          { status: 429 },
        );
      }
      return handler.fetch(request);
    },
  };
}

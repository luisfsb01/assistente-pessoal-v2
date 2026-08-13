import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import { createMcpBridge } from './handler.js';

describe('createMcpBridge', () => {
  const request = (authorization?: string) => new Request('https://assistente.example/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' },
    } }),
  });

  it('falha fechado quando o token não foi configurado', async () => {
    const response = await createMcpBridge().fetch(request('Bearer qualquer'));
    expect(response.status).toBe(403);
  });

  it('recusa token ausente ou incorreto sem revelar as ferramentas', async () => {
    const bridge = createMcpBridge('segredo-forte');
    expect((await bridge.fetch(request())).status).toBe(401);
    const wrong = await bridge.fetch(request('Bearer segredo-fraco'));
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).not.toContain('finance_');
  });

  it('aceita o token correto e encaminha ao protocolo MCP', async () => {
    const response = await createMcpBridge('segredo-forte').fetch(request('Bearer segredo-forte'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/json|event-stream/);
    expect(await response.text()).toContain('assistente-pessoal-v2');
  });
});

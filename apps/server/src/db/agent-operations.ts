import { supabase } from './client.js';

export type AgentOperationStatus = 'running' | 'succeeded' | 'failed';

export type AgentOperation = {
  id: string;
  source: 'hermes';
  tool_name: string;
  idempotency_key: string;
  status: AgentOperationStatus;
  request: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error_code: string | null;
  started_at: string;
  completed_at: string | null;
  verified_at: string | null;
};

const COLUMNS =
  'id, source, tool_name, idempotency_key, status, request, result, error_code, started_at, completed_at, verified_at';

export async function beginAgentOperation(input: {
  toolName: string;
  idempotencyKey: string;
  request: Record<string, unknown>;
}): Promise<{ operation: AgentOperation; created: boolean }> {
  const { data, error } = await supabase
    .from('agent_operations')
    .insert({
      source: 'hermes',
      tool_name: input.toolName,
      idempotency_key: input.idempotencyKey,
      request: input.request,
    })
    .select(COLUMNS)
    .single();

  if (!error) return { operation: data as AgentOperation, created: true };
  if (error.code !== '23505') throw error;

  const { data: existing, error: readError } = await supabase
    .from('agent_operations')
    .select(COLUMNS)
    .eq('source', 'hermes')
    .eq('idempotency_key', input.idempotencyKey)
    .single();
  if (readError) throw readError;
  return { operation: existing as AgentOperation, created: false };
}

export async function completeAgentOperation(
  id: string,
  result: Record<string, unknown>,
): Promise<AgentOperation> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('agent_operations')
    .update({ status: 'succeeded', result, completed_at: now, verified_at: now, error_code: null })
    .eq('id', id)
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return data as AgentOperation;
}

export async function failAgentOperation(id: string, errorCode: string): Promise<AgentOperation> {
  const { data, error } = await supabase
    .from('agent_operations')
    .update({
      status: 'failed',
      error_code: errorCode,
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return data as AgentOperation;
}

export async function listAgentOperations(limit = 20): Promise<AgentOperation[]> {
  const { data, error } = await supabase
    .from('agent_operations')
    .select(COLUMNS)
    .eq('source', 'hermes')
    .order('started_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 50));
  if (error) throw error;
  return (data ?? []) as AgentOperation[];
}

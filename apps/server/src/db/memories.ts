import { supabase } from './client.js';

export type MemorySubject = 'luis' | 'esposa' | 'casal';
export type MemoryType = 'preference' | 'habit' | 'fact' | 'decision' | 'person';

export type Memory = {
  id: string;
  subject: MemorySubject;
  type: MemoryType;
  content: string;
};

export async function insertMemory(m: {
  subject: MemorySubject;
  type: MemoryType;
  content: string;
  embedding: number[];
  source: string;
}): Promise<void> {
  const { error } = await supabase.from('memories').insert({
    subject: m.subject,
    type: m.type,
    content: m.content,
    embedding: m.embedding,
    source: m.source,
  });
  if (error) throw error;
}

export async function searchMemories(
  embedding: number[],
  subjects: MemorySubject[],
  count = 6,
): Promise<Memory[]> {
  const { data, error } = await supabase.rpc('match_memories', {
    query_embedding: embedding,
    subjects,
    match_count: count,
  });
  if (error) throw error;
  return (data ?? []).map((r: { id: string; subject: string; type: string; content: string }) => ({
    id: r.id,
    subject: r.subject as MemorySubject,
    type: r.type as MemoryType,
    content: r.content,
  }));
}

export async function updateMemoryContent(
  id: string,
  content: string,
  embedding: number[],
): Promise<void> {
  const { error } = await supabase
    .from('memories')
    .update({ content, embedding, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function expireMemory(id: string): Promise<void> {
  const { error } = await supabase.from('memories').update({ active: false }).eq('id', id);
  if (error) throw error;
}

export async function listActiveMemories(cap = 200): Promise<Memory[]> {
  const { data, error } = await supabase
    .from('memories')
    .select('id, subject, type, content')
    .eq('active', true)
    .order('updated_at', { ascending: false })
    .limit(cap);
  if (error) throw error;
  return (data ?? []) as Memory[];
}

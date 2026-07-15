import { supabase } from './client.js';

export type KnowledgeChunk = { content: string; embedding: number[] };
export type KnowledgeMatch = { path: string; content: string; similarity: number };

/** Hash do arquivo indexado (gravado em todo chunk; lido do chunk 0). Null = nunca indexado. */
export async function getIndexedFileHash(path: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('knowledge_index')
    .select('file_hash')
    .eq('path', path)
    .eq('chunk_no', 0)
    .maybeSingle();
  if (error) throw error;
  return (data?.file_hash as string | undefined) ?? null;
}

/** Reindexação atômica por arquivo: apaga os chunks antigos do path e grava os novos. */
export async function replaceFileChunks(
  path: string,
  fileHash: string,
  chunks: KnowledgeChunk[],
): Promise<void> {
  const del = await supabase.from('knowledge_index').delete().eq('path', path);
  if (del.error) throw del.error;
  if (chunks.length === 0) return;
  const rows = chunks.map((c, i) => ({
    path,
    chunk_no: i,
    content: c.content,
    embedding: c.embedding,
    file_hash: fileHash,
  }));
  const { error } = await supabase.from('knowledge_index').insert(rows);
  if (error) throw error;
}

export async function deleteFileChunks(path: string): Promise<void> {
  const { error } = await supabase.from('knowledge_index').delete().eq('path', path);
  if (error) throw error;
}

/** Busca semântica sobre Sources+Wiki (função match_knowledge da migração 0005). */
export async function searchKnowledge(embedding: number[], count = 6): Promise<KnowledgeMatch[]> {
  const { data, error } = await supabase.rpc('match_knowledge', {
    query_embedding: embedding,
    match_count: count,
  });
  if (error) throw error;
  return (data ?? []).map((r: { path: string; content: string; similarity: number }) => ({
    path: r.path,
    content: r.content,
    similarity: r.similarity,
  }));
}

import { searchMemories, type Memory, type MemorySubject } from '../db/memories.js';
import { embedText } from './embeddings.js';

export async function recallMemories(
  text: string,
  subjects: MemorySubject[],
): Promise<Memory[]> {
  const embedding = await embedText(text);
  return searchMemories(embedding, subjects, 6);
}

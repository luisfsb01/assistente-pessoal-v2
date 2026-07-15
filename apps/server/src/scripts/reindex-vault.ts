// Reconstrói o índice semântico a partir dos arquivos do vault
// (uso: npm run job:reindex-vault -w apps/server)
import { reindexVault } from '../knowledge/indexer.js';

const out = await reindexVault();
console.log(`reindex: ${out.indexed} indexados, ${out.unchanged} inalterados, ${out.failed} falhas`);

// Roda uma limpeza do Gmail manualmente (uso: npm run job:email-cleanup -w apps/server)
import { runEmailCleanup } from '../jobs/email-cleanup.js';

const out = await runEmailCleanup();
console.log(`limpeza: ${out.scanned} analisados, ${out.trashed} para a lixeira, ${out.important} para o briefing`);

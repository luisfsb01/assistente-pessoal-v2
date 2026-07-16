// Roda o bibliotecário manualmente (uso: npm run job:librarian -w apps/server)
import { runLibrarian } from '../jobs/librarian.js';

const out = await runLibrarian();
console.log(`bibliotecário: ${out.processed} fontes processadas, ${out.pages} páginas do wiki`);

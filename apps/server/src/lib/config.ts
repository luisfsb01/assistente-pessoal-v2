import { dirname, join } from 'node:path';
import { z } from 'zod';

const schema = z.object({
  TELEGRAM_TOKEN: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  MODEL_DEFAULT_ID: z.string().default('gpt-5-mini'),
  MODEL_STRONG_ID: z.string().default('gpt-5.5'),
  EMBEDDING_MODEL_ID: z.string().default('text-embedding-3-small'),
  LLM_BUDGET_BRL: z.coerce.number().positive().default(50),
  USD_BRL_RATE: z.coerce.number().positive().default(5.5),
  TIMEZONE: z.string().default('America/Sao_Paulo'),
  PORT: z.coerce.number().default(8080),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().optional(),
  BANCO_MCP_TOKEN: z.string().default(''),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  return schema.parse(env);
}

let cached: Config | undefined;
export function getConfig(): Config {
  if (!cached) {
    // Em dev/scripts (tsx) ninguém injeta o .env; no Docker o compose injeta
    // via env_file e o arquivo não existe — variáveis já definidas têm precedência.
    // O cwd varia (raiz da repo, ou apps/server via npm -w): sobe até achar o .env.
    let dir = process.cwd();
    for (let i = 0; i < 3; i++) {
      try {
        process.loadEnvFile(join(dir, '.env'));
        break;
      } catch {
        dir = dirname(dir); // sem .env aqui: tenta o diretório pai
      }
    }
    cached = loadConfig(process.env);
  }
  return cached;
}

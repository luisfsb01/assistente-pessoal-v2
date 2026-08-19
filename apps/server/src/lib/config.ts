import { dirname, join } from 'node:path';
import { z } from 'zod';

const optionalNonEmpty = z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).optional());
const optionalUrl = z.preprocess((value) => value === '' ? undefined : value, z.string().url().optional());
const optionalSecret = z.preprocess((value) => value === '' ? undefined : value, z.string().min(32).optional());
const booleanFromEnv = z.preprocess((value) => {
  if (value === undefined || value === '') return true;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return value;
}, z.boolean());

const schema = z.object({
  TELEGRAM_TOKEN: z.string().min(1),
  /** Desliga o long polling do bot antigo sem interromper API, jobs e dashboard. */
  TELEGRAM_LISTENER_ENABLED: booleanFromEnv,
  /** Token do bot do Hermes usado somente para enviar rotinas; o Hermes continua sendo o único listener. */
  HERMES_TELEGRAM_BOT_TOKEN: optionalNonEmpty,
  OPENAI_API_KEY: z.string().min(1),
  LLM_API_KEY: optionalNonEmpty,
  LLM_BASE_URL: optionalUrl,
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
  HERMES_MCP_TOKEN: optionalSecret,
  VAULT_PATH: z.string().default('./data/vault'),
}).superRefine((cfg, ctx) => {
  if (!cfg.TELEGRAM_LISTENER_ENABLED && !cfg.HERMES_TELEGRAM_BOT_TOKEN) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['HERMES_TELEGRAM_BOT_TOKEN'],
      message: 'obrigatório quando TELEGRAM_LISTENER_ENABLED=false',
    });
  }
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

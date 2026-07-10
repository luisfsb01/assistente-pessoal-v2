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
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  return schema.parse(env);
}

let cached: Config | undefined;
export function getConfig(): Config {
  cached ??= loadConfig(process.env);
  return cached;
}

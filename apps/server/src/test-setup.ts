// Vitest setup: garante variáveis de ambiente mínimas para módulos que chamam
// getConfig()/criam o client Supabase no top-level do módulo (ex.: db/client.ts),
// mesmo quando o teste usa deps mockadas e nunca toca a rede de fato.
process.env.TELEGRAM_TOKEN ??= 't';
process.env.OPENAI_API_KEY ??= 'k';
process.env.SUPABASE_URL ??= 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 's';

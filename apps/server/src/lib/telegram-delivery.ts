import type { Config } from './config.js';

export type TelegramInteractionMode = 'buttons' | 'hermes';

/** Separa o token que entrega rotinas do token que recebe mensagens no V2. */
export function telegramDeliveryConfig(cfg: Config): {
  token: string;
  interactionMode: TelegramInteractionMode;
} {
  return cfg.HERMES_TELEGRAM_BOT_TOKEN
    ? { token: cfg.HERMES_TELEGRAM_BOT_TOKEN, interactionMode: 'hermes' }
    : { token: cfg.TELEGRAM_TOKEN, interactionMode: 'buttons' };
}

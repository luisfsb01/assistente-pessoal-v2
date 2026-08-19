import { describe, expect, it } from 'vitest';
import type { Config } from './config.js';
import { telegramDeliveryConfig } from './telegram-delivery.js';

const config = (over: Partial<Config> = {}) => ({
  TELEGRAM_TOKEN: 'bot-antigo',
  HERMES_TELEGRAM_BOT_TOKEN: undefined,
  ...over,
}) as Config;

describe('telegramDeliveryConfig', () => {
  it('mantém o comportamento antigo por padrão', () => {
    expect(telegramDeliveryConfig(config())).toEqual({ token: 'bot-antigo', interactionMode: 'buttons' });
  });

  it('usa o bot Hermes sem botões quando seu token está configurado', () => {
    expect(telegramDeliveryConfig(config({ HERMES_TELEGRAM_BOT_TOKEN: 'bot-hermes' }))).toEqual({
      token: 'bot-hermes',
      interactionMode: 'hermes',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { createBudgetAlert } from './alerts.js';

function makeAlert() {
  const sent: string[] = [];
  const state = new Map<string, unknown>();
  const alert = createBudgetAlert({
    send: async (text) => {
      sent.push(text);
    },
    getState: async (key) => (state.get(key) as never) ?? null,
    setState: async (key, value) => {
      state.set(key, value);
    },
  });
  return { alert, sent };
}

describe('createBudgetAlert', () => {
  it('avisa uma vez no warn e não repete no mesmo mês', async () => {
    const { alert, sent } = makeAlert();
    await alert('warn', 41);
    await alert('warn', 43);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('80%');
  });

  it('exceeded gera aviso próprio mesmo depois do warn', async () => {
    const { alert, sent } = makeAlert();
    await alert('warn', 41);
    await alert('exceeded', 51);
    expect(sent).toHaveLength(2);
    expect(sent[1].toLowerCase()).toContain('modelo');
  });

  it('se o envio falhar, o estado não é marcado (permite tentar de novo depois)', async () => {
    const state = new Map<string, unknown>();
    const alert = createBudgetAlert({
      send: async () => {
        throw new Error('rede fora do ar');
      },
      getState: async (key) => (state.get(key) as never) ?? null,
      setState: async (key, value) => {
        state.set(key, value);
      },
    });

    await expect(alert('warn', 41)).rejects.toThrow('rede fora do ar');
    expect(state.get('budget_alert_warn_' + new Date().toISOString().slice(0, 7))).toBeUndefined();
  });
});

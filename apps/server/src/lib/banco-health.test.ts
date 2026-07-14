import { describe, expect, it } from 'vitest';
import { formatBankHealthAlert, summarizeBankHealth } from './banco-health.js';

describe('summarizeBankHealth', () => {
  it('sem payloads → sem problemas', () => {
    expect(summarizeBankHealth(null, null)).toEqual({ problems: [], providerDegraded: false });
  });
  it('incidente do provedor atribuído ao banco conectado', () => {
    const s = summarizeBankHealth(
      { degraded: true, your_connected_banks: ['Itaú'], your_banks_affected: [{ name: 'Itaú Cartões - Conector Indisponível', impact: 'critical' }] },
      null,
    );
    expect(s.providerDegraded).toBe(true);
    expect(s.problems[0]).toMatchObject({ kind: 'provider_incident', bank: 'Itaú', severity: 'critical' });
  });
  it('conexão em LOGIN_ERROR vira problema; UPDATED/UPDATING não', () => {
    const s = summarizeBankHealth(null, {
      items: [
        { status: 'LOGIN_ERROR', executionStatus: '', connector: { name: 'Nubank' } },
        { status: 'UPDATED', executionStatus: 'SUCCESS', connector: { name: 'Itaú' } },
      ],
    });
    expect(s.problems).toHaveLength(1);
    expect(s.problems[0]).toMatchObject({ kind: 'connection_error', bank: 'Nubank', severity: 'LOGIN_ERROR' });
  });
});

describe('formatBankHealthAlert', () => {
  it('lista os problemas com prefixo do banco', () => {
    const text = formatBankHealthAlert({ problems: [{ kind: 'connection_error', bank: 'Nubank', detail: 'LOGIN_ERROR' }], providerDegraded: false });
    expect(text).toContain('Nubank: LOGIN_ERROR');
    expect(text).toContain('não é o seu sistema');
  });
});

import '../test-setup.js';
import { describe, expect, it, vi } from 'vitest';
import type { Transaction } from '../db/finance.js';
import type { GmailSearchEmail } from '../lib/gmail.js';
import {
  appendEmailProduct,
  buildPurchaseEmailQuery,
  detectMarketplace,
  enrichMarketplaceTransactionDescriptions,
  estimatedPurchaseDates,
  parseInstallment,
  type PurchaseEmailEnrichmentDeps,
} from './purchase-email-enrichment.js';

const transaction = (over: Partial<Transaction> = {}): Transaction => ({
  id: 'tx-1',
  occurred_on: '2026-08-12',
  description: 'MERCADOLIVRE*MERCA01/06',
  amount: 49.9,
  kind: 'expense',
  source: 'bank',
  category_id: null,
  status: 'pending_review',
  review_code: null,
  ...over,
});

const email = (over: Partial<GmailSearchEmail> = {}): GmailSearchEmail => ({
  id: 'email-1',
  from: 'Mercado Livre <compras@mercadolivre.com>',
  subject: 'Compra aprovada: Fone Bluetooth QCY',
  snippet: 'Seu produto Fone Bluetooth QCY foi comprado.',
  bodyText: 'Detalhes da compra Produto: Fone Bluetooth QCY Valor R$ 299,40',
  categories: ['CATEGORY_UPDATES'],
  starred: false,
  internalDate: Date.parse('2026-08-12T15:00:00Z'),
  ...over,
});

function deps(over: Partial<PurchaseEmailEnrichmentDeps> = {}): PurchaseEmailEnrichmentDeps {
  return {
    listCandidates: async () => [transaction()],
    searchEmails: async () => [email()],
    updateDescription: async () => true,
    generate: async () => ({
      matched: true,
      emailId: 'email-1',
      product: 'Fone Bluetooth QCY',
      confidence: 'high',
      reason: 'produto explícito no comprovante',
    }),
    ...over,
  };
}

describe('regras de marketplace e parcelas', () => {
  it('detecta Mercado Livre e Shopee sem confundir outro comércio', () => {
    expect(detectMarketplace('MERCADOLIVRE*MERCA01/06')).toBe('mercado_livre');
    expect(detectMarketplace('Shopee * pedido 02/10')).toBe('shopee');
    expect(detectMarketplace('SUPERMERCADO LIVRE')).toBeNull();
  });

  it('valida o número da parcela', () => {
    expect(parseInstallment('MERCA02/06')).toEqual({ current: 2, total: 6 });
    expect(parseInstallment('MERCA07/06')).toBeNull();
  });

  it('procura também a provável data original nas parcelas posteriores', () => {
    expect(estimatedPurchaseDates(transaction({
      occurred_on: '2026-08-31',
      description: 'SHOPEE03/06',
    }))).toEqual(['2026-08-31', '2026-06-30']);
  });

  it('usa épocas em segundos e termo da loja na busca do Gmail', () => {
    const query = buildPurchaseEmailQuery('mercado_livre', '2026-08-12');
    expect(query).toContain('after:');
    expect(query).toContain('before:');
    expect(query).toContain('"Mercado Livre"');
  });

  it('não duplica o marcador de produto', () => {
    const original = 'MERCADOLIVRE01/06 [email - produto "Fone"]';
    expect(appendEmailProduct(original, 'Outro')).toBe(original);
  });
});

describe('enrichMarketplaceTransactionDescriptions', () => {
  it('grava o produto quando a correspondência é forte e verificável no e-mail', async () => {
    const update = vi.fn(async () => true);
    const count = await enrichMarketplaceTransactionDescriptions(deps({ updateDescription: update }));
    expect(count).toBe(1);
    expect(update).toHaveBeenCalledWith(
      'tx-1',
      'MERCADOLIVRE*MERCA01/06',
      'MERCADOLIVRE*MERCA01/06 [email - produto "Fone Bluetooth QCY"]',
      true,
    );
  });

  it('preserva a categoria de uma transação já confirmada pelo usuário', async () => {
    const update = vi.fn(async () => true);
    await enrichMarketplaceTransactionDescriptions(deps({
      listCandidates: async () => [transaction({ status: 'confirmed', category_id: 'cat-1' })],
      updateDescription: update,
    }));
    expect(update.mock.calls[0]?.[3]).toBe(false);
  });

  it('não altera quando a IA informa confiança média', async () => {
    const update = vi.fn(async () => true);
    const count = await enrichMarketplaceTransactionDescriptions(deps({
      updateDescription: update,
      generate: async () => ({
        matched: true,
        emailId: 'email-1',
        product: 'Fone Bluetooth QCY',
        confidence: 'medium',
        reason: 'mais de uma compra possível',
      }),
    }));
    expect(count).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it('rejeita produto inventado que não aparece no e-mail selecionado', async () => {
    const update = vi.fn(async () => true);
    const count = await enrichMarketplaceTransactionDescriptions(deps({
      updateDescription: update,
      generate: async () => ({
        matched: true,
        emailId: 'email-1',
        product: 'Notebook Gamer',
        confidence: 'high',
        reason: 'suposto produto',
      }),
    }));
    expect(count).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it('não interrompe as demais compras quando uma busca falha', async () => {
    const update = vi.fn(async () => true);
    const second = transaction({ id: 'tx-2', description: 'SHOPEE01/03' });
    let calls = 0;
    const count = await enrichMarketplaceTransactionDescriptions(deps({
      listCandidates: async () => [transaction(), second],
      searchEmails: async () => {
        calls++;
        if (calls === 1) throw new Error('Gmail fora');
        return [email({
          id: 'email-2',
          from: 'Shopee <no-reply@shopee.com.br>',
          subject: 'Pedido confirmado: Cafeteira Elétrica',
          snippet: 'Cafeteira Elétrica',
          bodyText: 'Produto Cafeteira Elétrica',
        })];
      },
      generate: async () => ({
        matched: true,
        emailId: 'email-2',
        product: 'Cafeteira Elétrica',
        confidence: 'high',
        reason: 'pedido confirmado',
      }),
      updateDescription: update,
    }));
    expect(count).toBe(1);
    expect(update).toHaveBeenCalledOnce();
  });
});

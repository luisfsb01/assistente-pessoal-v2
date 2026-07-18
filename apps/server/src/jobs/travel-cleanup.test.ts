import { describe, expect, it, vi } from 'vitest';
import { runTravelCleanup, type TravelCleanupDeps } from './travel-cleanup.js';

function deps(): TravelCleanupDeps {
  return {
    getGroupChatId: async () => 99,
    listPastUnpromptedTravelLists: async () => [
      { id: '11111111-1111-4111-8111-111111111111', name: 'Recife', travelDate: '2026-07-10' },
    ],
    markTravelCleanupPrompted: vi.fn(async () => undefined),
    todayIso: () => '2026-07-18',
  };
}

describe('runTravelCleanup', () => {
  it('pergunta no grupo com confirmação e marca a viagem para não repetir', async () => {
    const d = deps();
    const send = vi.fn(async () => undefined);
    await expect(runTravelCleanup(send, d)).resolves.toBe(1);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toBe(99);
    expect(send.mock.calls[0][1]).toContain('Posso apagar');
    expect(send.mock.calls[0][2].inline_keyboard[0]).toHaveLength(2);
    expect(d.markTravelCleanupPrompted).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
  });

  it('não marca como perguntada quando o envio falha, permitindo nova tentativa', async () => {
    const d = deps();
    const send = vi.fn(async () => { throw new Error('offline') });
    await expect(runTravelCleanup(send, d)).rejects.toThrow('offline');
    expect(d.markTravelCleanupPrompted).not.toHaveBeenCalled();
  });
});

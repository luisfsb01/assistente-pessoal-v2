import '../test-setup.js';
import { describe, expect, it, vi } from 'vitest';
import type { Trip, TripWithReservations } from '../db/trips.js';
import type { GmailSearchEmail } from '../lib/gmail.js';
import {
  buildTravelEmailQueries,
  importTravelReservationsFromGmail,
  type TravelEmailImportDeps,
  type TravelEmailExtraction,
} from './travel-email-import.js';

const trip: Trip = {
  id: 'trip-1', name: 'Casamento do Caio', destination: 'Recife', purpose: 'Casamento', travelers: ['Luis'], notes: null,
  startDate: '2026-10-10', endDate: '2026-10-13', status: 'planning', createdBy: 'user-1',
  createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:00Z',
};

const email: GmailSearchEmail = {
  id: 'email-1', from: 'companhia@example.com', subject: 'Confirmação de voo', snippet: 'Reserva confirmada',
  categories: [], starred: false, internalDate: Date.parse('2026-08-20T12:00:00Z'),
  bodyText: 'Localizador ABC123. Saída Recife 10/10 às 09:00.',
};

function extraction(over: Partial<TravelEmailExtraction> = {}): TravelEmailExtraction {
  return {
    matched: true, confidence: 'high', reason: 'Confirmação explícita',
    reservations: [{
      sourceItemKey: 'flight-ABC123', kind: 'flight', provider: 'Azul', confirmationCode: 'ABC123',
      status: 'booked', startAt: '2026-10-10T09:00:00-03:00', endAt: '2026-10-10T11:30:00-03:00',
      timezone: 'America/Sao_Paulo', origin: 'REC', destination: 'GRU', address: null,
      summary: 'Voo REC–GRU confirmado', details: { flightNumber: 'AD1234' },
    }],
    ...over,
  };
}

function deps(over: Partial<TravelEmailImportDeps> = {}): TravelEmailImportDeps {
  const full: TripWithReservations = { ...trip, reservations: [] };
  return {
    findTripByName: vi.fn(async () => trip),
    getTripWithReservations: vi.fn(async () => full),
    searchEmails: vi.fn(async () => [email]),
    saveReservation: vi.fn(async () => ({})),
    generate: vi.fn(async () => extraction()),
    ...over,
  };
}

describe('buildTravelEmailQueries', () => {
  it('limita por período e inclui contexto da viagem', () => {
    const queries = buildTravelEmailQueries(trip);
    expect(queries[0]).toContain('after:');
    expect(queries[0]).toContain('before:');
    expect(queries[0]).toContain('Recife');
    expect(queries[0]).toContain('Casamento');
  });

  it('usa o roteiro multi-cidade completo, inclusive notes e códigos de aeroportos', () => {
    const queries = buildTravelEmailQueries({
      ...trip,
      name: 'Casamento Caio e Miriam',
      destination: 'São José do Rio Preto para Fortaleza, volta por Natal',
      notes: 'Hospedagens em Fortaleza, Grossos e Natal',
    });
    const all = queries.join('\n');
    expect(all).toContain('Grossos');
    expect(all).toContain('Fortaleza');
    expect(all).toContain('Natal');
    expect(all).toContain('SJP');
    expect(all).toContain('FOR');
    expect(all).toContain('NAT');
    expect(all).toContain('LATAM');
    expect(all).toContain('Booking');
  });

  it('inclui reservas compradas com antecedência maior que 45 dias', () => {
    const queries = buildTravelEmailQueries({ ...trip, startDate: '2027-10-10', endDate: '2027-10-13' });
    const after = Number(queries[0].match(/after:(\d+)/)?.[1]);
    expect(after).toBeLessThanOrEqual(Date.parse('2026-10-10T00:00:00Z') / 1000);
  });
});

describe('importTravelReservationsFromGmail', () => {
  it('deduplica e-mails, salva apenas os campos extraídos e relê a viagem', async () => {
    const fake = deps();
    const out = await importTravelReservationsFromGmail('Casamento do Caio', fake);
    expect(out).toMatchObject({ ok: true, emailsFound: 1, emailsMatched: 1, reservationsSaved: 1 });
    expect(fake.searchEmails).toHaveBeenCalledWith(expect.any(String), 80, expect.objectContaining({
      includeAttachments: true,
      excludeIds: expect.anything(),
    }));
    expect(fake.generate).toHaveBeenCalledTimes(1);
    expect(fake.saveReservation).toHaveBeenCalledWith(expect.objectContaining({
      tripId: 'trip-1', source: 'gmail', sourceEmailId: 'email-1', sourceItemKey: 'flight-ABC123',
      confirmationCode: 'ABC123', startAt: '2026-10-10T09:00:00-03:00',
    }));
    const saved = vi.mocked(fake.saveReservation).mock.calls[0][0];
    expect(JSON.stringify(saved)).not.toContain(email.bodyText);
    expect(fake.getTripWithReservations).toHaveBeenCalledWith('trip-1');
  });

  it('ignora correspondência sem alta confiança', async () => {
    const fake = deps({ generate: vi.fn(async () => extraction({ confidence: 'medium' })) });
    const out = await importTravelReservationsFromGmail('Casamento do Caio', fake);
    expect(out.reservationsSaved).toBe(0);
    expect(fake.saveReservation).not.toHaveBeenCalled();
  });

  it('não persiste data sem fuso explícito', async () => {
    const lowDate = extraction();
    lowDate.reservations[0].startAt = '2026-10-10T09:00:00';
    const fake = deps({ generate: vi.fn(async () => lowDate) });
    await importTravelReservationsFromGmail('Casamento do Caio', fake);
    expect(fake.saveReservation).toHaveBeenCalledWith(expect.objectContaining({ startAt: null }));
  });

  it('prioriza o comprovante relevante mesmo quando buscas amplas excedem o teto de extração', async () => {
    const candidates = Array.from({ length: 100 }, (_, index): GmailSearchEmail => ({
      ...email,
      id: `email-${index}`,
      internalDate: email.internalDate + index,
      subject: index === 99 ? 'Reserva confirmada Fortaleza' : `Promoção genérica ${index}`,
      snippet: index === 99 ? 'Localizador FOR123' : 'oferta',
      bodyText: index === 99 ? 'Voo confirmado para Fortaleza. Localizador FOR123.' : 'Oferta de viagem.',
    }));
    const generate = vi.fn(async ({ prompt }: { prompt: string }) => (
      prompt.includes('FOR123') ? extraction() : extraction({ matched: false, reservations: [] })
    ));
    const fake = deps({ searchEmails: vi.fn(async () => candidates), generate });

    const out = await importTravelReservationsFromGmail('Casamento do Caio', fake);

    expect(generate.mock.calls.some(([call]) => call.prompt.includes('FOR123'))).toBe(true);
    expect(generate.mock.calls.length).toBeLessThanOrEqual(30);
    expect(out.reservationsSaved).toBe(1);
  });

  it('evita refetch de mensagens repetidas entre queries', async () => {
    const seenExclusions: string[][] = [];
    const searchEmails = vi.fn(async (
      _query: string,
      _limit?: number,
      options?: { excludeIds?: Iterable<string> },
    ) => {
      const excluded = [...(options?.excludeIds ?? [])];
      seenExclusions.push(excluded);
      return excluded.includes(email.id) ? [] : [email];
    });
    const fake = deps({ searchEmails });

    await importTravelReservationsFromGmail(trip.name, fake);

    expect(seenExclusions[0]).toEqual([]);
    expect(seenExclusions.slice(1).every((ids) => ids.includes(email.id))).toBe(true);
    expect(fake.generate).toHaveBeenCalledOnce();
  });

  it('não executa fallback genérico quando as buscas dirigidas já trouxeram candidatos fortes', async () => {
    const strong = Array.from({ length: 12 }, (_, index): GmailSearchEmail => ({
      ...email,
      id: `strong-${index}`,
      subject: `Reserva confirmada Recife ${index}`,
      bodyText: `Voo Recife confirmado, localizador ABC${index}`,
    }));
    const searchEmails = vi.fn(async () => strong);
    const fake = deps({ searchEmails, generate: vi.fn(async () => extraction({ matched: false, reservations: [] })) });

    await importTravelReservationsFromGmail(trip.name, fake);

    expect(searchEmails).toHaveBeenCalledTimes(2);
  });

  it('fornece notes ao extrator para validar hotéis das cidades do roteiro', async () => {
    const withNotes = { ...trip, notes: 'Hospedagens esperadas em Fortaleza, Grossos e Natal' };
    const generate = vi.fn(async () => extraction({ matched: false, reservations: [] }));
    const fake = deps({ findTripByName: vi.fn(async () => withNotes), generate });

    await importTravelReservationsFromGmail(withNotes.name, fake);

    expect(generate.mock.calls[0]?.[0].prompt).toContain('Grossos');
  });
});

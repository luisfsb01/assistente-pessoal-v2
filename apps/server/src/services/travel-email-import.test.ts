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
});

describe('importTravelReservationsFromGmail', () => {
  it('deduplica e-mails, salva apenas os campos extraídos e relê a viagem', async () => {
    const fake = deps();
    const out = await importTravelReservationsFromGmail('Casamento do Caio', fake);
    expect(out).toMatchObject({ ok: true, emailsFound: 1, emailsMatched: 1, reservationsSaved: 1 });
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
});

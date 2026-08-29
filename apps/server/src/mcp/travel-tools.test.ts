import '../test-setup.js';
import { describe, expect, it, vi } from 'vitest';
import type { Trip, TripReservation, TripWithReservations } from '../db/trips.js';
import {
  addTripReservationFromHermes,
  createTripFromHermes,
  importTripGmailFromHermes,
  type TravelMcpDeps,
} from './travel-tools.js';

const trip: Trip = { id: 't1', name: 'Casamento do Caio', destination: 'Recife', purpose: 'Casamento', travelers: ['Luis'], notes: null, startDate: null, endDate: null, status: 'planning', createdBy: 'u1', createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:00Z' };
const reservation: TripReservation = { id: 'r1', tripId: 't1', kind: 'hotel', provider: 'Hotel Boa Viagem', confirmationCode: 'H123', status: 'booked', startAt: null, endAt: null, timezone: null, origin: null, destination: null, address: 'Recife', summary: 'Hotel confirmado', details: {}, source: 'manual', sourceEmailId: null, sourceEmailSubject: null, sourceEmailDate: null, sourceItemKey: null, createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:00Z' };

function deps(over: Partial<TravelMcpDeps> = {}): TravelMcpDeps {
  let full: TripWithReservations = { ...trip, reservations: [] };
  return {
    getUserBySubject: vi.fn(async () => ({ id: 'u1', name: 'Luis', calendarId: null })),
    createTrip: vi.fn(async () => trip),
    findTripByName: vi.fn(async () => null),
    getTripWithReservations: vi.fn(async () => full),
    listTrips: vi.fn(async () => [trip]),
    updateTrip: vi.fn(async () => trip),
    saveTripReservation: vi.fn(async () => { full = { ...full, reservations: [reservation] }; return reservation; }),
    importFromGmail: vi.fn(async () => ({ ok: true, trip: full, emailsFound: 2, emailsAnalyzed: 2, emailsMatched: 1, reservationsSaved: 1 })),
    ...over,
  };
}

describe('travel MCP writes', () => {
  it('cria e relê antes de confirmar', async () => {
    const fake = deps();
    const out = await createTripFromHermes({ subject: 'luis', name: trip.name }, fake);
    expect(out.structuredContent).toMatchObject({ ok: true, verified: true, trip_name: trip.name });
    expect(fake.getTripWithReservations).toHaveBeenCalledWith('t1');
  });

  it('salva reserva e confirma pela releitura', async () => {
    const fake = deps({ findTripByName: vi.fn(async () => trip) });
    const out = await addTripReservationFromHermes({ trip_name: trip.name, kind: 'hotel', summary: 'Hotel confirmado' }, fake);
    expect(out.structuredContent).toMatchObject({ ok: true, verified: true, reservation_id: 'r1' });
  });

  it('bloqueia consulta ao Gmail da esposa', async () => {
    const fake = deps();
    const out = await importTripGmailFromHermes({ subject: 'esposa', trip_name: trip.name }, fake);
    expect(fake.importFromGmail).not.toHaveBeenCalled();
    expect(out.structuredContent).toMatchObject({ ok: false, error_code: 'gmail_access_not_allowed' });
  });

  it('distingue candidatos encontrados dos efetivamente analisados', async () => {
    const fake = deps();
    const out = await importTripGmailFromHermes({ subject: 'luis', trip_name: trip.name }, fake);
    expect(out.structuredContent).toMatchObject({ emails_found: 2, emails_analyzed: 2 });
  });

  it('expõe pistas dos candidatos quando nenhuma reserva é salva', async () => {
    const fake = deps({ importFromGmail: vi.fn(async () => ({
      ok: true, trip: { ...trip, reservations: [] }, emailsFound: 3, emailsAnalyzed: 3, emailsMatched: 0, reservationsSaved: 0,
      candidateHints: [{
        date: '2026-08-20T12:00:00Z', from: 'hotel@example.com', subject: 'Reserva Fortaleza', score: 9,
        matched: false, confidence: 'medium' as const, reason: 'Falta a data da hospedagem.', reservationCount: 0,
      }],
    })) });
    const out = await importTripGmailFromHermes({ subject: 'luis', trip_name: trip.name }, fake);
    expect(out.structuredContent).toMatchObject({ candidate_hints: [expect.objectContaining({
      subject: 'Reserva Fortaleza', confidence: 'medium', reason: 'Falta a data da hospedagem.',
    })] });
  });

  it('encaminha foco exclusivo de hotel para evitar repetir a análise de voos', async () => {
    const importFromGmail = vi.fn(async () => ({
      ok: true, trip: { ...trip, reservations: [] }, emailsFound: 0, emailsAnalyzed: 0,
      emailsMatched: 0, reservationsSaved: 0,
    }));
    const fake = deps({ importFromGmail });

    await importTripGmailFromHermes({
      subject: 'luis', trip_name: trip.name, reservation_types: ['hotel'],
    }, fake);

    expect(importFromGmail).toHaveBeenCalledWith(trip.name, undefined, { focus: 'hotel' });
  });
});

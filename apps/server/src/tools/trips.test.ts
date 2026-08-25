import '../test-setup.js';
import { describe, expect, it, vi } from 'vitest';
import type { ChatIdentity } from '../db/chats.js';
import type { Trip, TripWithReservations } from '../db/trips.js';
import { buildTripTools, type TripToolDeps } from './trips.js';

const luis: ChatIdentity = { chatId: 1, kind: 'private', userName: 'Luis', subject: 'luis' };
const esposa: ChatIdentity = { chatId: 2, kind: 'private', userName: 'Esposa', subject: 'esposa' };
const trip: Trip = { id: 'trip-1', name: 'Casamento do Caio', destination: null, purpose: 'Casamento', travelers: ['Luis'], notes: null, startDate: null, endDate: null, status: 'planning', createdBy: 'u1', createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:00Z' };
const full: TripWithReservations = { ...trip, reservations: [] };

function deps(over: Partial<TripToolDeps> = {}): TripToolDeps {
  return {
    getUserBySubject: vi.fn(async () => ({ id: 'u1', name: 'Luis', calendarId: null })),
    createTrip: vi.fn(async (input) => ({ ...trip, name: input.name })),
    findTripByName: vi.fn(async () => null),
    getTripWithReservations: vi.fn(async () => full),
    listTrips: vi.fn(async () => [trip]),
    updateTrip: vi.fn(async () => trip),
    saveTripReservation: vi.fn(async (input) => ({ id: 'r1', tripId: input.tripId })) as never,
    importFromGmail: vi.fn(async () => ({ ok: true, trip: full, emailsFound: 1, emailsMatched: 1, reservationsSaved: 1 })),
    ...over,
  };
}

async function run(toolset: Record<string, { execute?: unknown }>, name: string, input: unknown): Promise<string> {
  return (toolset[name] as { execute: (input: unknown, options: unknown) => Promise<string> }).execute(input, {});
}

describe('buildTripTools', () => {
  it('cria viagem somente com nome e verifica a persistência', async () => {
    const fake = deps();
    const out = await run(buildTripTools(luis, fake) as never, 'trip_create', { name: 'Casamento do Caio' });
    expect(fake.createTrip).toHaveBeenCalledWith(expect.objectContaining({ name: 'Casamento do Caio', startDate: undefined, endDate: undefined }));
    expect(fake.getTripWithReservations).toHaveBeenCalledWith('trip-1');
    expect(out).toContain('criada e salva');
  });

  it('expõe importação do Gmail somente no privado do Luis', () => {
    expect(buildTripTools(luis, deps())).toHaveProperty('trip_import_gmail');
    expect(buildTripTools(esposa, deps())).not.toHaveProperty('trip_import_gmail');
  });

  it('resume reservas e aponta voo, hotel e carro ausentes', async () => {
    const fake = deps({ findTripByName: vi.fn(async () => trip) });
    const out = JSON.parse(await run(buildTripTools(luis, fake) as never, 'trip_summary', { trip_name: trip.name }));
    expect(out.viagem).toBe(trip.name);
    expect(out.ainda_sem_reserva).toEqual(['flight', 'hotel', 'car']);
  });
});

import { fromJsonSchema, type CallToolResult, type McpServer } from '@modelcontextprotocol/server';
import { getUserBySubject } from '../db/chats.js';
import {
  createTrip,
  findTripByName,
  getTripWithReservations,
  listTrips,
  saveTripReservation,
  updateTrip,
  type ReservationKind,
  type ReservationStatus,
  type TripStatus,
  type TripWithReservations,
} from '../db/trips.js';
import { importTravelReservationsFromGmail } from '../services/travel-email-import.js';

type Subject = 'luis' | 'esposa';

export type TravelMcpDeps = {
  getUserBySubject: typeof getUserBySubject;
  createTrip: typeof createTrip;
  findTripByName: typeof findTripByName;
  getTripWithReservations: typeof getTripWithReservations;
  listTrips: typeof listTrips;
  updateTrip: typeof updateTrip;
  saveTripReservation: typeof saveTripReservation;
  importFromGmail: typeof importTravelReservationsFromGmail;
};

const defaultDeps: TravelMcpDeps = {
  getUserBySubject,
  createTrip,
  findTripByName,
  getTripWithReservations,
  listTrips,
  updateTrip,
  saveTripReservation,
  importFromGmail: importTravelReservationsFromGmail,
};

function result(value: Record<string, unknown>, message?: string): CallToolResult {
  return { content: [{ type: 'text', text: message ?? JSON.stringify(value) }], structuredContent: value };
}

function payload(trip: TripWithReservations): Record<string, unknown> {
  const reservations = trip.reservations.map((reservation) => ({
    kind: reservation.kind,
    status: reservation.status,
    summary: reservation.summary,
    provider: reservation.provider,
    confirmation_code: reservation.confirmationCode,
    start_at: reservation.startAt,
    end_at: reservation.endAt,
    timezone: reservation.timezone,
    origin: reservation.origin,
    destination: reservation.destination,
    address: reservation.address,
    details: reservation.details,
    source: reservation.source,
  }));
  const bookedKinds = new Set(reservations.filter((item) => item.status === 'booked').map((item) => item.kind));
  return {
    trip: {
      name: trip.name,
      destination: trip.destination,
      purpose: trip.purpose,
      travelers: trip.travelers,
      notes: trip.notes,
      start_date: trip.startDate,
      end_date: trip.endDate,
      status: trip.status,
    },
    reservations,
    missing_common_reservations: (['flight', 'hotel', 'car'] as const).filter((kind) => !bookedKinds.has(kind)),
  };
}

export async function createTripFromHermes(
  input: { subject: Subject; name: string; destination?: string; purpose?: string; travelers?: string[]; notes?: string; start_date?: string; end_date?: string },
  deps: TravelMcpDeps = defaultDeps,
): Promise<CallToolResult> {
  const existing = await deps.findTripByName(input.name);
  if (existing) return result({ ok: true, verified: true, already_existed: true, trip_id: existing.id, trip_name: existing.name });
  const user = await deps.getUserBySubject(input.subject);
  if (!user) return result({ ok: false, verified: false, error_code: 'user_not_found' });
  const created = await deps.createTrip({ name: input.name, destination: input.destination, purpose: input.purpose, travelers: input.travelers, notes: input.notes, startDate: input.start_date, endDate: input.end_date, createdBy: user.id });
  const saved = await deps.getTripWithReservations(created.id);
  const verified = saved?.name === created.name;
  return result(
    { ok: verified, verified, trip_id: created.id, trip_name: created.name, ...(!verified ? { error_code: 'verification_failed' } : {}) },
    verified ? `Viagem "${created.name}" criada e conferida.` : 'A criação da viagem não foi confirmada no banco.',
  );
}

export async function addTripReservationFromHermes(
  input: {
    trip_name: string;
    kind: ReservationKind;
    summary: string;
    provider?: string;
    confirmation_code?: string;
    status?: ReservationStatus;
    start_at?: string;
    end_at?: string;
    timezone?: string;
    origin?: string;
    destination?: string;
    address?: string;
    details?: Record<string, unknown>;
  },
  deps: TravelMcpDeps = defaultDeps,
): Promise<CallToolResult> {
  const trip = await deps.findTripByName(input.trip_name);
  if (!trip) return result({ ok: false, verified: false, error_code: 'trip_not_found' });
  const saved = await deps.saveTripReservation({
    tripId: trip.id,
    kind: input.kind,
    summary: input.summary,
    provider: input.provider,
    confirmationCode: input.confirmation_code,
    status: input.status,
    startAt: input.start_at,
    endAt: input.end_at,
    timezone: input.timezone,
    origin: input.origin,
    destination: input.destination,
    address: input.address,
    details: input.details,
  });
  const full = await deps.getTripWithReservations(trip.id);
  const verified = full?.reservations.some((reservation) => reservation.id === saved.id) ?? false;
  return result(
    { ok: verified, verified, trip_name: trip.name, reservation_id: saved.id, ...(!verified ? { error_code: 'verification_failed' } : {}) },
    verified ? `Reserva anotada na viagem "${trip.name}" e conferida.` : 'A reserva não foi confirmada no banco.',
  );
}

export async function importTripGmailFromHermes(
  input: { subject: Subject; trip_name: string; reservation_types?: Array<'flight' | 'hotel'> },
  deps: TravelMcpDeps = defaultDeps,
): Promise<CallToolResult> {
  if (input.subject !== 'luis') return result({ ok: false, verified: false, error_code: 'gmail_access_not_allowed' });
  const requestedTypes = [...new Set(input.reservation_types ?? [])];
  const focus = requestedTypes.length === 1 ? requestedTypes[0] : 'all';
  const imported = await deps.importFromGmail(input.trip_name, undefined, { focus });
  if (!imported.ok || !imported.trip) return result({ ok: false, verified: false, error_code: imported.errorCode ?? 'verification_failed' });
  return result({
    ok: true,
    verified: true,
    emails_found: imported.emailsFound,
    emails_analyzed: imported.emailsAnalyzed,
    emails_matched: imported.emailsMatched,
    reservations_saved: imported.reservationsSaved,
    ...(imported.candidateHints ? { candidate_hints: imported.candidateHints } : {}),
    ...(imported.trip ? payload(imported.trip) : {}),
  }, imported.reservationsSaved > 0
    ? `${imported.reservationsSaved} reserva(s) encontrada(s) no Gmail, salva(s) e conferida(s).`
    : 'A pesquisa terminou, mas não encontrou confirmação segura para essa viagem.');
}

const subject = { type: 'string' as const, enum: ['luis', 'esposa'] };
const date = { type: 'string' as const, pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const instant = { type: 'string' as const, format: 'date-time' };

export function registerTravelMcpTools(server: McpServer, deps: TravelMcpDeps = defaultDeps): void {
  server.registerTool('travel_create_trip', {
    title: 'Criar viagem',
    description: 'Cria e relê uma viagem. Apenas o nome é obrigatório; não peça dados opcionais ausentes.',
    inputSchema: fromJsonSchema<{ subject: Subject; name: string; destination?: string; purpose?: string; travelers?: string[]; notes?: string; start_date?: string; end_date?: string }>({
      type: 'object', properties: {
        subject,
        name: { type: 'string', minLength: 2, maxLength: 200 },
        destination: { type: 'string', minLength: 2, maxLength: 200 },
        purpose: { type: 'string', minLength: 2, maxLength: 300 },
        travelers: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 160 }, maxItems: 30 },
        notes: { type: 'string', minLength: 2, maxLength: 2000 },
        start_date: date,
        end_date: date,
      }, required: ['subject', 'name'], additionalProperties: false,
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => createTripFromHermes(input, deps));

  server.registerTool('travel_list_trips', {
    title: 'Listar viagens', description: 'Lista viagens ativas e seus dados básicos.',
    inputSchema: fromJsonSchema<Record<string, never>>({ type: 'object', properties: {}, additionalProperties: false }),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, async () => result({ ok: true, trips: await deps.listTrips('active') }));

  server.registerTool('travel_get_summary', {
    title: 'Resumo da viagem', description: 'Retorna tudo que foi reservado, pendente, cancelado e os itens comuns ainda sem reserva.',
    inputSchema: fromJsonSchema<{ trip_name: string }>({ type: 'object', properties: { trip_name: { type: 'string', minLength: 2, maxLength: 200 } }, required: ['trip_name'], additionalProperties: false }),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ trip_name }) => {
    const trip = await deps.findTripByName(trip_name);
    if (!trip) return result({ ok: false, error_code: 'trip_not_found' });
    const full = await deps.getTripWithReservations(trip.id);
    return full ? result({ ok: true, ...payload(full) }) : result({ ok: false, error_code: 'trip_not_found' });
  });

  server.registerTool('travel_update_trip', {
    title: 'Atualizar viagem', description: 'Atualiza dados gerais de uma viagem e relê o banco.',
    inputSchema: fromJsonSchema<{ trip_name: string; name?: string; destination?: string; purpose?: string; travelers?: string[]; notes?: string; start_date?: string; end_date?: string; status?: TripStatus }>({
      type: 'object', properties: {
        trip_name: { type: 'string', minLength: 2, maxLength: 200 }, name: { type: 'string', minLength: 2, maxLength: 200 },
        destination: { type: 'string', minLength: 2, maxLength: 200 }, purpose: { type: 'string', minLength: 2, maxLength: 300 },
        travelers: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 160 }, maxItems: 30 },
        notes: { type: 'string', minLength: 2, maxLength: 2000 },
        start_date: date, end_date: date,
        status: { type: 'string', enum: ['planning', 'confirmed', 'completed', 'cancelled'] },
      }, required: ['trip_name'], additionalProperties: false,
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ trip_name, name, destination, purpose, travelers, notes, start_date, end_date, status }) => {
    const trip = await deps.findTripByName(trip_name);
    if (!trip) return result({ ok: false, verified: false, error_code: 'trip_not_found' });
    const saved = await deps.updateTrip(trip.id, { name, destination, purpose, travelers, notes, startDate: start_date, endDate: end_date, status });
    return result({ ok: !!saved, verified: !!saved, trip: saved });
  });

  server.registerTool('travel_add_reservation', {
    title: 'Anotar reserva', description: 'Salva e relê uma reserva informada pelo usuário.',
    inputSchema: fromJsonSchema<Parameters<typeof addTripReservationFromHermes>[0]>({
      type: 'object', properties: {
        trip_name: { type: 'string', minLength: 2, maxLength: 200 },
        kind: { type: 'string', enum: ['flight', 'hotel', 'car', 'transfer', 'event', 'other'] },
        summary: { type: 'string', minLength: 3, maxLength: 500 }, provider: { type: 'string', maxLength: 200 },
        confirmation_code: { type: 'string', maxLength: 120 }, status: { type: 'string', enum: ['booked', 'pending', 'cancelled'] },
        start_at: instant, end_at: instant, timezone: { type: 'string', maxLength: 100 }, origin: { type: 'string', maxLength: 200 },
        destination: { type: 'string', maxLength: 200 }, address: { type: 'string', maxLength: 500 }, details: { type: 'object' },
      }, required: ['trip_name', 'kind', 'summary'], additionalProperties: false,
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (input) => addTripReservationFromHermes(input, deps));

  server.registerTool('travel_import_gmail', {
    title: 'Importar reservas do Gmail', description: 'Pesquisa confirmações no Gmail do Luis, extrai e salva somente correspondências de alta confiança. Quando o pedido for específico, informe reservation_types para pesquisar apenas voos ou apenas hotéis e evitar timeout.',
    inputSchema: fromJsonSchema<{ subject: Subject; trip_name: string; reservation_types?: Array<'flight' | 'hotel'> }>({
      type: 'object', properties: {
        subject,
        trip_name: { type: 'string', minLength: 2, maxLength: 200 },
        reservation_types: { type: 'array', items: { type: 'string', enum: ['flight', 'hotel'] }, minItems: 1, maxItems: 2, uniqueItems: true },
      }, required: ['subject', 'trip_name'], additionalProperties: false,
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (input) => importTripGmailFromHermes(input, deps));
}

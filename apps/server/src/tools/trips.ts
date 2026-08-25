import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { ChatIdentity } from '../db/chats.js';
import { getUserBySubject } from '../db/chats.js';
import {
  createTrip,
  findTripByName,
  getTripWithReservations,
  listTrips,
  saveTripReservation,
  updateTrip,
  type TripWithReservations,
} from '../db/trips.js';
import { importTravelReservationsFromGmail } from '../services/travel-email-import.js';

export type TripToolDeps = {
  getUserBySubject: typeof getUserBySubject;
  createTrip: typeof createTrip;
  findTripByName: typeof findTripByName;
  getTripWithReservations: typeof getTripWithReservations;
  listTrips: typeof listTrips;
  updateTrip: typeof updateTrip;
  saveTripReservation: typeof saveTripReservation;
  importFromGmail: typeof importTravelReservationsFromGmail;
};

const defaultDeps: TripToolDeps = {
  getUserBySubject,
  createTrip,
  findTripByName,
  getTripWithReservations,
  listTrips,
  updateTrip,
  saveTripReservation,
  importFromGmail: importTravelReservationsFromGmail,
};

const FAIL = 'Não consegui acessar as viagens agora. Tenta de novo em instantes.';
const NOT_FOUND = (name: string) => `Não achei uma viagem ativa chamada "${name}".`;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const instant = z.string().datetime({ offset: true });

function summaryPayload(trip: TripWithReservations): Record<string, unknown> {
  const reservations = trip.reservations.map((item) => ({
    tipo: item.kind,
    situacao: item.status,
    resumo: item.summary,
    fornecedor: item.provider,
    confirmacao: item.confirmationCode,
    inicio: item.startAt,
    fim: item.endAt,
    origem: item.origin,
    destino: item.destination,
    endereco: item.address,
    detalhes: item.details,
    fonte: item.source,
  }));
  const booked = reservations.filter((item) => item.situacao === 'booked');
  const pending = reservations.filter((item) => item.situacao === 'pending');
  const covered = new Set(booked.map((item) => item.tipo));
  return {
    viagem: trip.name,
    destino: trip.destination,
    motivo: trip.purpose,
    viajantes: trip.travelers,
    observacoes: trip.notes,
    inicio: trip.startDate,
    fim: trip.endDate,
    situacao: trip.status,
    reservado: booked,
    pendente: pending,
    cancelado: reservations.filter((item) => item.situacao === 'cancelled'),
    ainda_sem_reserva: (['flight', 'hotel', 'car'] as const).filter((kind) => !covered.has(kind)),
  };
}

export function buildTripTools(identity: ChatIdentity, deps: TripToolDeps = defaultDeps): ToolSet {
  const tools: ToolSet = {
    trip_create: tool({
      description: 'Cria uma viagem para guardar roteiro e reservas. Só o nome é obrigatório; datas e destino podem ser preenchidos depois.',
      inputSchema: z.object({
        name: z.string().min(2),
        destination: z.string().min(2).optional(),
        purpose: z.string().min(2).optional(),
        travelers: z.array(z.string().min(1)).optional(),
        notes: z.string().min(2).optional(),
        start_date: date.optional(),
        end_date: date.optional(),
      }),
      execute: async ({ name, destination, purpose, travelers, notes, start_date, end_date }) => {
        try {
          const existing = await deps.findTripByName(name);
          if (existing) return `A viagem "${existing.name}" já está criada.`;
          const user = identity.subject ? await deps.getUserBySubject(identity.subject) : null;
          const saved = await deps.createTrip({ name, destination, purpose, travelers, notes, startDate: start_date, endDate: end_date, createdBy: user?.id ?? null });
          const verified = await deps.getTripWithReservations(saved.id);
          return verified ? `Viagem "${verified.name}" criada e salva.` : FAIL;
        } catch {
          return FAIL;
        }
      },
    }),
    trip_list: tool({
      description: 'Lista as viagens ativas com destino, datas e situação.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const rows = await deps.listTrips('active');
          return rows.length === 0 ? 'Não há viagens ativas.' : JSON.stringify(rows.map((trip) => ({ name: trip.name, destination: trip.destination, travelers: trip.travelers, startDate: trip.startDate, endDate: trip.endDate, status: trip.status })));
        } catch {
          return FAIL;
        }
      },
    }),
    trip_summary: tool({
      description: 'Busca o resumo completo de uma viagem, separando reservas confirmadas, pendentes, canceladas e itens ainda sem reserva.',
      inputSchema: z.object({ trip_name: z.string().min(2) }),
      execute: async ({ trip_name }) => {
        try {
          const trip = await deps.findTripByName(trip_name);
          if (!trip) return NOT_FOUND(trip_name);
          const full = await deps.getTripWithReservations(trip.id);
          return full ? JSON.stringify(summaryPayload(full)) : NOT_FOUND(trip_name);
        } catch {
          return FAIL;
        }
      },
    }),
    trip_update: tool({
      description: 'Atualiza destino, motivo, datas ou situação de uma viagem existente.',
      inputSchema: z.object({
        trip_name: z.string().min(2),
        name: z.string().min(2).optional(),
        destination: z.string().min(2).nullable().optional(),
        purpose: z.string().min(2).nullable().optional(),
        travelers: z.array(z.string().min(1)).optional(),
        notes: z.string().min(2).nullable().optional(),
        start_date: date.nullable().optional(),
        end_date: date.nullable().optional(),
        status: z.enum(['planning', 'confirmed', 'completed', 'cancelled']).optional(),
      }),
      execute: async ({ trip_name, name, destination, purpose, travelers, notes, start_date, end_date, status }) => {
        try {
          const trip = await deps.findTripByName(trip_name);
          if (!trip) return NOT_FOUND(trip_name);
          const saved = await deps.updateTrip(trip.id, { name, destination, purpose, travelers, notes, startDate: start_date, endDate: end_date, status });
          return saved ? `Viagem "${saved.name}" atualizada.` : FAIL;
        } catch {
          return FAIL;
        }
      },
    }),
    trip_add_reservation: tool({
      description: 'Anota manualmente uma reserva já informada pelo usuário (voo, hotel, carro, traslado, evento ou outro).',
      inputSchema: z.object({
        trip_name: z.string().min(2),
        kind: z.enum(['flight', 'hotel', 'car', 'transfer', 'event', 'other']),
        summary: z.string().min(3),
        provider: z.string().optional(),
        confirmation_code: z.string().optional(),
        status: z.enum(['booked', 'pending', 'cancelled']).default('booked'),
        start_at: instant.optional(),
        end_at: instant.optional(),
        timezone: z.string().optional(),
        origin: z.string().optional(),
        destination: z.string().optional(),
        address: z.string().optional(),
        details: z.record(z.unknown()).default({}),
      }),
      execute: async ({ trip_name, confirmation_code, start_at, end_at, ...reservation }) => {
        try {
          const trip = await deps.findTripByName(trip_name);
          if (!trip) return NOT_FOUND(trip_name);
          const saved = await deps.saveTripReservation({ tripId: trip.id, ...reservation, confirmationCode: confirmation_code, startAt: start_at, endAt: end_at });
          const verified = await deps.getTripWithReservations(trip.id);
          return verified?.reservations.some((item) => item.id === saved.id)
            ? `Reserva anotada na viagem "${trip.name}".`
            : FAIL;
        } catch {
          return FAIL;
        }
      },
    }),
  };

  if (identity.kind === 'private' && identity.subject === 'luis') {
    tools.trip_import_gmail = tool({
      description: 'Pesquisa no Gmail do Luis confirmações de voo, hotel, carro e outras reservas, extrai os dados e salva na viagem.',
      inputSchema: z.object({ trip_name: z.string().min(2) }),
      execute: async ({ trip_name }) => {
        try {
          const out = await deps.importFromGmail(trip_name);
          if (out.errorCode === 'trip_not_found') return NOT_FOUND(trip_name);
          if (out.errorCode === 'gmail_not_configured') return 'O Gmail ainda não está conectado.';
          if (out.reservationsSaved === 0) return `Pesquisei o Gmail, mas não encontrei confirmação segura para a viagem "${trip_name}".`;
          return JSON.stringify({ mensagem: `${out.reservationsSaved} reserva(s) encontrada(s) e salva(s).`, ...summaryPayload(out.trip!) });
        } catch {
          return 'Não consegui consultar o Gmail agora. Tenta de novo em instantes.';
        }
      },
    });
  }
  return tools;
}

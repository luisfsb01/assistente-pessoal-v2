import { supabase } from './client.js';

export type TripStatus = 'planning' | 'confirmed' | 'completed' | 'cancelled';
export type ReservationKind = 'flight' | 'hotel' | 'car' | 'transfer' | 'event' | 'other';
export type ReservationStatus = 'booked' | 'pending' | 'cancelled';

export type Trip = {
  id: string;
  name: string;
  destination: string | null;
  purpose: string | null;
  travelers: string[];
  notes: string | null;
  startDate: string | null;
  endDate: string | null;
  status: TripStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TripReservation = {
  id: string;
  tripId: string;
  kind: ReservationKind;
  provider: string | null;
  confirmationCode: string | null;
  status: ReservationStatus;
  startAt: string | null;
  endAt: string | null;
  timezone: string | null;
  origin: string | null;
  destination: string | null;
  address: string | null;
  summary: string;
  details: Record<string, unknown>;
  source: 'manual' | 'gmail';
  sourceEmailId: string | null;
  sourceEmailSubject: string | null;
  sourceEmailDate: string | null;
  sourceItemKey: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TripWithReservations = Trip & { reservations: TripReservation[] };

type TripRow = Record<string, unknown>;

function mapTrip(row: TripRow): Trip {
  return {
    id: row.id as string,
    name: row.name as string,
    destination: (row.destination as string | null) ?? null,
    purpose: (row.purpose as string | null) ?? null,
    travelers: (row.travelers as string[] | null) ?? [],
    notes: (row.notes as string | null) ?? null,
    startDate: (row.start_date as string | null) ?? null,
    endDate: (row.end_date as string | null) ?? null,
    status: row.status as TripStatus,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapReservation(row: TripRow): TripReservation {
  return {
    id: row.id as string,
    tripId: row.trip_id as string,
    kind: row.kind as ReservationKind,
    provider: (row.provider as string | null) ?? null,
    confirmationCode: (row.confirmation_code as string | null) ?? null,
    status: row.status as ReservationStatus,
    startAt: (row.start_at as string | null) ?? null,
    endAt: (row.end_at as string | null) ?? null,
    timezone: (row.timezone as string | null) ?? null,
    origin: (row.origin as string | null) ?? null,
    destination: (row.destination as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    summary: row.summary as string,
    details: (row.details as Record<string, unknown> | null) ?? {},
    source: row.source as 'manual' | 'gmail',
    sourceEmailId: (row.source_email_id as string | null) ?? null,
    sourceEmailSubject: (row.source_email_subject as string | null) ?? null,
    sourceEmailDate: (row.source_email_date as string | null) ?? null,
    sourceItemKey: (row.source_item_key as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function clean(value?: string | null): string | null {
  return value?.trim() || null;
}

function confirmation(value?: string | null): string | null {
  return clean(value)?.toLocaleUpperCase('en-US') ?? null;
}

export async function createTrip(input: {
  name: string;
  destination?: string | null;
  purpose?: string | null;
  travelers?: string[];
  notes?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  createdBy?: string | null;
}): Promise<Trip> {
  const { data, error } = await supabase.from('trips').insert({
    name: input.name.trim(),
    destination: clean(input.destination),
    purpose: clean(input.purpose),
    travelers: (input.travelers ?? []).map((traveler) => traveler.trim()).filter(Boolean),
    notes: clean(input.notes),
    start_date: input.startDate ?? null,
    end_date: input.endDate ?? null,
    created_by: input.createdBy ?? null,
  }).select('*').single();
  if (error) throw error;
  return mapTrip(data);
}

export async function listTrips(status?: TripStatus | 'active'): Promise<Trip[]> {
  let query = supabase.from('trips').select('*').order('start_date', { ascending: true, nullsFirst: false });
  if (status === 'active') query = query.in('status', ['planning', 'confirmed']);
  else if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => mapTrip(row));
}

export async function getTrip(id: string): Promise<Trip | null> {
  const { data, error } = await supabase.from('trips').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? mapTrip(data) : null;
}

function normalized(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
}

export async function findTripByName(name: string): Promise<Trip | null> {
  const rows = await listTrips('active');
  const needle = normalized(name);
  const exact = rows.find((trip) => normalized(trip.name) === needle);
  if (exact) return exact;
  const partial = rows.filter((trip) => normalized(trip.name).includes(needle) || needle.includes(normalized(trip.name)));
  return partial.length === 1 ? partial[0] : null;
}

export async function updateTrip(id: string, patch: Partial<{
  name: string;
  destination: string | null;
  purpose: string | null;
  travelers: string[];
  notes: string | null;
  startDate: string | null;
  endDate: string | null;
  status: TripStatus;
}>): Promise<Trip | null> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.destination !== undefined) row.destination = clean(patch.destination);
  if (patch.purpose !== undefined) row.purpose = clean(patch.purpose);
  if (patch.travelers !== undefined) row.travelers = patch.travelers.map((traveler) => traveler.trim()).filter(Boolean);
  if (patch.notes !== undefined) row.notes = clean(patch.notes);
  if (patch.startDate !== undefined) row.start_date = patch.startDate;
  if (patch.endDate !== undefined) row.end_date = patch.endDate;
  if (patch.status !== undefined) row.status = patch.status;
  const { data, error } = await supabase.from('trips').update(row).eq('id', id).select('*').maybeSingle();
  if (error) throw error;
  return data ? mapTrip(data) : null;
}

export async function listTripReservations(tripId: string): Promise<TripReservation[]> {
  const { data, error } = await supabase.from('trip_reservations').select('*').eq('trip_id', tripId)
    .order('start_at', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => mapReservation(row));
}

export async function getTripWithReservations(id: string): Promise<TripWithReservations | null> {
  const trip = await getTrip(id);
  if (!trip) return null;
  return { ...trip, reservations: await listTripReservations(id) };
}

export type SaveReservationInput = {
  tripId: string;
  kind: ReservationKind;
  provider?: string | null;
  confirmationCode?: string | null;
  status?: ReservationStatus;
  startAt?: string | null;
  endAt?: string | null;
  timezone?: string | null;
  origin?: string | null;
  destination?: string | null;
  address?: string | null;
  summary: string;
  details?: Record<string, unknown>;
  source?: 'manual' | 'gmail';
  sourceEmailId?: string | null;
  sourceEmailSubject?: string | null;
  sourceEmailDate?: string | null;
  sourceItemKey?: string | null;
};

export async function saveTripReservation(input: SaveReservationInput): Promise<TripReservation> {
  const confirmationCode = confirmation(input.confirmationCode);
  const row = {
    trip_id: input.tripId,
    kind: input.kind,
    provider: clean(input.provider),
    confirmation_code: confirmationCode,
    status: input.status ?? 'booked',
    start_at: input.startAt ?? null,
    end_at: input.endAt ?? null,
    timezone: clean(input.timezone),
    origin: clean(input.origin),
    destination: clean(input.destination),
    address: clean(input.address),
    summary: input.summary.trim(),
    details: input.details ?? {},
    source: input.source ?? 'manual',
    source_email_id: input.sourceEmailId ?? null,
    source_email_subject: input.sourceEmailSubject ?? null,
    source_email_date: input.sourceEmailDate ?? null,
    source_item_key: input.sourceItemKey ?? null,
    updated_at: new Date().toISOString(),
  };
  const source = input.source ?? 'manual';
  if (source === 'gmail' && confirmationCode) {
    const { data: existing, error: findError } = await supabase.from('trip_reservations')
      .select('id').eq('trip_id', input.tripId).eq('kind', input.kind)
      .eq('confirmation_code', confirmationCode).maybeSingle();
    if (findError) throw findError;
    if (existing) {
      const { data, error } = await supabase.from('trip_reservations').update(row)
        .eq('id', existing.id).select('*').single();
      if (error) throw error;
      return mapReservation(data);
    }
  }
  const query = source === 'gmail'
    ? supabase.from('trip_reservations').upsert(row, { onConflict: 'trip_id,source_email_id,source_item_key' })
    : supabase.from('trip_reservations').insert(row);
  const { data, error } = await query.select('*').single();
  if (error) throw error;
  return mapReservation(data);
}

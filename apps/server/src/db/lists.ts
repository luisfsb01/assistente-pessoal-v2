import { supabase } from './client.js';

export type TravelList = {
  id: string;
  name: string;
  travelDate: string;
  cleanupPromptedAt: string | null;
  items: Array<{ id: string; name: string }>;
};

export type PrayerRequest = {
  id: string;
  purpose: string | null;
  personName: string;
  request: string;
};

export async function listTravelLists(): Promise<TravelList[]> {
  const { data, error } = await supabase
    .from('travel_lists')
    .select('id, name, travel_date, cleanup_prompted_at, travel_items ( id, name, created_at )')
    .order('travel_date', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    travelDate: row.travel_date as string,
    cleanupPromptedAt: (row.cleanup_prompted_at as string | null) ?? null,
    items: ((row.travel_items ?? []) as Array<{ id: string; name: string; created_at: string }>)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map(({ id, name }) => ({ id, name })),
  }));
}

export async function addTravelItems(args: {
  travelName: string;
  travelDate: string;
  items: string[];
  addedByUserId: string | null;
}): Promise<string> {
  const name = args.travelName.trim();
  const { data: existing, error: findError } = await supabase
    .from('travel_lists')
    .select('id, travel_date')
    .ilike('name', name)
    .limit(2);
  if (findError) throw findError;

  const exact = (existing ?? []).find((row) => row.travel_date === args.travelDate);
  let listId = exact?.id as string | undefined;
  if (!listId) {
    const { data, error } = await supabase
      .from('travel_lists')
      .insert({ name, travel_date: args.travelDate, created_by: args.addedByUserId })
      .select('id')
      .single();
    if (error) throw error;
    listId = data.id as string;
  }

  const { error } = await supabase.from('travel_items').insert(
    args.items.map((item) => ({
      travel_list_id: listId,
      name: item.trim(),
      added_by: args.addedByUserId,
    })),
  );
  if (error) throw error;
  return listId;
}

export async function removeTravelItem(itemId: string): Promise<void> {
  const { error } = await supabase.from('travel_items').delete().eq('id', itemId);
  if (error) throw error;
}

export async function deleteTravelList(listId: string): Promise<boolean> {
  const { data, error } = await supabase.from('travel_lists').delete().eq('id', listId).select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function listPastUnpromptedTravelLists(today: string): Promise<Array<Pick<TravelList, 'id' | 'name' | 'travelDate'>>> {
  const { data, error } = await supabase
    .from('travel_lists')
    .select('id, name, travel_date')
    .lt('travel_date', today)
    .is('cleanup_prompted_at', null)
    .order('travel_date', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    travelDate: row.travel_date as string,
  }));
}

export async function markTravelCleanupPrompted(listId: string): Promise<void> {
  const { error } = await supabase
    .from('travel_lists')
    .update({ cleanup_prompted_at: new Date().toISOString() })
    .eq('id', listId);
  if (error) throw error;
}

export async function listPrayerRequests(ownerId: string): Promise<PrayerRequest[]> {
  const { data, error } = await supabase
    .from('prayer_requests')
    .select('id, purpose, person_name, request')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    purpose: (row.purpose as string | null) ?? null,
    personName: row.person_name as string,
    request: row.request as string,
  }));
}

export async function addPrayerRequest(args: {
  ownerId: string;
  purpose?: string | null;
  personName: string;
  request: string;
}): Promise<void> {
  const { error } = await supabase.from('prayer_requests').insert({
    owner_id: args.ownerId,
    purpose: args.purpose?.trim() || null,
    person_name: args.personName.trim(),
    request: args.request.trim(),
  });
  if (error) throw error;
}

export async function removePrayerRequest(id: string, ownerId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('prayer_requests')
    .delete()
    .eq('id', id)
    .eq('owner_id', ownerId)
    .select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

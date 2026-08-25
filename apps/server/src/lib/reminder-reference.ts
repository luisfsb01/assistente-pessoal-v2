export type ReminderReferenceKind = 'task' | 'project-task';

const PREFIX: Record<ReminderReferenceKind, string> = {
  task: 'T',
  'project-task': 'P',
};

function compact(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/** Referência curta e estável para caber nos botões de lembrete do Telegram. */
export function reminderReference(kind: ReminderReferenceKind, id: string): string {
  return `${PREFIX[kind]}-${compact(id).slice(0, 8)}`;
}

export function matchesReminderReference(kind: ReminderReferenceKind, id: string, reference: string): boolean {
  const normalized = reference.trim().toUpperCase();
  return normalized === id.toUpperCase() || normalized === reminderReference(kind, id);
}

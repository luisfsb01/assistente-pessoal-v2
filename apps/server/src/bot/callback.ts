export type FinCallbackAction = 'ok';

export type BotAction =
  | { kind: 'fin'; action: FinCallbackAction; txId: string }
  | { kind: 'hab'; done: boolean; habitId: string }
  | { kind: 'ptask'; action: 'done' | 'keep'; taskId: string };

export function encodeFinAction(action: FinCallbackAction, txId: string): string {
  return `fin:${action}:${txId}`;
}

export function encodeHabitAction(done: boolean, habitId: string): string {
  return `hab:${done ? 'sim' : 'nao'}:${habitId}`;
}

export function encodePtaskAction(action: 'done' | 'keep', taskId: string): string {
  return `ptask:${action}:${taskId}`;
}

export function decodeAction(data: string): BotAction | null {
  const [kind, action, id] = data.split(':');
  if (!id) return null;
  if (kind === 'fin' && action === 'ok') return { kind: 'fin', action, txId: id };
  if (kind === 'hab' && (action === 'sim' || action === 'nao')) return { kind: 'hab', done: action === 'sim', habitId: id };
  if (kind === 'ptask' && (action === 'done' || action === 'keep')) return { kind: 'ptask', action, taskId: id };
  return null;
}

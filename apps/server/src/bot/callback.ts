export type FinCallbackAction = 'ok';

export interface FinAction {
  kind: 'fin';
  action: FinCallbackAction;
  txId: string;
}

export function encodeFinAction(action: FinCallbackAction, txId: string): string {
  return `fin:${action}:${txId}`;
}

export function decodeAction(data: string): FinAction | null {
  const [kind, action, txId] = data.split(':');
  if (kind !== 'fin' || action !== 'ok' || !txId) return null;
  return { kind: 'fin', action, txId };
}

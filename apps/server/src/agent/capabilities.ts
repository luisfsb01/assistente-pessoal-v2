import type { ChatIdentity } from '../db/chats.js';

export type AgentCapability =
  | 'memory'
  | 'tasks'
  | 'shopping'
  | 'calendar'
  | 'finance'
  | 'knowledge'
  | 'habits'
  | 'projects'
  | 'email_cleanup';

/**
 * Matriz de autorização do bot. A restrição acontece antes de montar o ToolSet,
 * portanto o modelo nunca recebe ferramentas que aquele chat não pode executar.
 */
export function capabilitiesForChat(identity: ChatIdentity): ReadonlySet<AgentCapability> {
  if (identity.kind === 'group') {
    return new Set(['memory', 'tasks', 'shopping', 'calendar']);
  }
  if (identity.subject === 'luis') {
    return new Set([
      'memory',
      'tasks',
      'shopping',
      'calendar',
      'finance',
      'knowledge',
      'habits',
      'projects',
      'email_cleanup',
    ]);
  }
  return new Set(['memory', 'tasks', 'shopping', 'calendar', 'habits', 'projects']);
}

export function canAccess(identity: ChatIdentity, capability: AgentCapability): boolean {
  return capabilitiesForChat(identity).has(capability);
}

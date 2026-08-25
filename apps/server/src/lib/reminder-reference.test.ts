import { describe, expect, it } from 'vitest';
import { matchesReminderReference, reminderReference } from './reminder-reference.js';

describe('reminderReference', () => {
  it('gera referências curtas diferentes por tipo', () => {
    expect(reminderReference('task', '12345678-abcd')).toBe('T-12345678');
    expect(reminderReference('project-task', '12345678-abcd')).toBe('P-12345678');
  });

  it('aceita tanto a referência curta quanto o id completo', () => {
    expect(matchesReminderReference('task', '12345678-abcd', 't-12345678')).toBe(true);
    expect(matchesReminderReference('task', '12345678-abcd', '12345678-abcd')).toBe(true);
    expect(matchesReminderReference('project-task', '12345678-abcd', 'T-12345678')).toBe(false);
  });
});

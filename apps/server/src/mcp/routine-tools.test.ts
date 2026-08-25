import '../test-setup.js';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectTask } from '../db/projects.js';
import {
  recordHabitCheckin,
  recordTaskReminderAnswer,
  updateProjectTaskFromHermes,
  deleteTravelListFromHermes,
  type RoutineMcpDeps,
} from './routine-tools.js';

const task: ProjectTask = {
  id: 'task-1',
  projectId: 'project-1',
  title: 'Enviar proposta',
  status: 'todo',
  dueDate: '2026-08-18',
};

function deps(over: Partial<RoutineMcpDeps> = {}): RoutineMcpDeps {
  let checkin: { done: boolean } | null = null;
  let currentTask = task;
  let personalTask = { id: 'personal-task-1', title: 'Pagar boleto', status: 'open' as const, dueDate: '2026-08-19', recurrence: null };
  return {
    getUserBySubject: vi.fn(async () => ({ id: 'user-1', name: 'Luis', calendarId: null })),
    listActiveHabits: vi.fn(async () => [{ id: 'habit-1', name: 'Academia', targetPerWeek: 3 }]),
    pendingHabitsFor: vi.fn(async () => []),
    getCheckin: vi.fn(async () => checkin),
    upsertCheckin: vi.fn(async (_habitId, _date, done) => { checkin = { done }; }),
    listOverdueProjectTasks: vi.fn(async () => [{ ...currentTask, projectName: 'Comercial' }]),
    listOpenProjectTasksForUser: vi.fn(async () => [currentTask]),
    getProjectTaskForUser: vi.fn(async () => currentTask),
    moveProjectTask: vi.fn(async (_id, status) => { currentTask = { ...currentTask, status }; }),
    listTasks: vi.fn(async () => [personalTask]),
    getTaskForUser: vi.fn(async (id) => id === personalTask.id ? personalTask : null),
    completeTask: vi.fn(async () => { personalTask = { ...personalTask, status: 'done' as const }; }),
    listTravelLists: vi.fn(async () => []),
    deleteTravelList: vi.fn(async () => true),
    today: () => '2026-08-19',
    ...over,
  };
}

describe('recordHabitCheckin', () => {
  it('grava e só confirma depois de reler o check-in', async () => {
    const fake = deps();
    const response = await recordHabitCheckin({
      subject: 'luis',
      habit_name: 'academia',
      done: true,
    }, fake);
    expect(fake.upsertCheckin).toHaveBeenCalledWith('habit-1', '2026-08-19', true);
    expect(response.structuredContent).toMatchObject({
      ok: true,
      verified: true,
      habit_name: 'Academia',
      done: true,
    });
  });

  it('não grava quando o nome é ambíguo', async () => {
    const fake = deps({
      listActiveHabits: vi.fn(async () => [
        { id: 'h1', name: 'Leitura técnica', targetPerWeek: 3 },
        { id: 'h2', name: 'Leitura livre', targetPerWeek: 3 },
      ]),
    });
    const response = await recordHabitCheckin({ subject: 'luis', habit_name: 'leitura', done: true }, fake);
    expect(fake.upsertCheckin).not.toHaveBeenCalled();
    expect(response.structuredContent).toMatchObject({ ok: false, error_code: 'habit_not_found_or_ambiguous' });
  });
});

describe('recordTaskReminderAnswer', () => {
  it('conclui pelo código curto e só confirma após reler', async () => {
    const fake = deps();
    const response = await recordTaskReminderAnswer({
      subject: 'luis',
      task_ref: 'T-PERSONAL',
      done: true,
    }, fake);
    expect(fake.completeTask).toHaveBeenCalledWith('personal-task-1');
    expect(response.structuredContent).toMatchObject({ ok: true, verified: true, done: true, status: 'done' });
  });

  it('não conclui quando o usuário informa que ainda não fez', async () => {
    const fake = deps();
    const response = await recordTaskReminderAnswer({
      subject: 'luis',
      task_ref: 'T-PERSONAL',
      done: false,
    }, fake);
    expect(fake.completeTask).not.toHaveBeenCalled();
    expect(response.structuredContent).toMatchObject({ ok: true, verified: true, done: false, status: 'open' });
  });
});

describe('deleteTravelListFromHermes', () => {
  it('só confirma depois de reler e constatar que a lista saiu', async () => {
    let exists = true;
    const fake = deps({
      listTravelLists: vi.fn(async () => exists ? [{
        id: 'trip-1', name: 'Recife', travelDate: '2026-08-01', cleanupPromptedAt: null, items: [],
      }] : []),
      deleteTravelList: vi.fn(async () => { exists = false; return true; }),
    });
    const response = await deleteTravelListFromHermes('trip-1', fake);
    expect(fake.deleteTravelList).toHaveBeenCalledWith('trip-1');
    expect(response.structuredContent).toMatchObject({ ok: true, verified: true, list_name: 'Recife' });
  });
});

describe('updateProjectTaskFromHermes', () => {
  it('confere o dono, atualiza e relê o estado da tarefa', async () => {
    const fake = deps();
    const response = await updateProjectTaskFromHermes({
      subject: 'luis',
      task_id: 'task-1',
      status: 'done',
    }, fake);
    expect(fake.getProjectTaskForUser).toHaveBeenCalledWith('task-1', 'user-1');
    expect(fake.moveProjectTask).toHaveBeenCalledWith('task-1', 'done');
    expect(response.structuredContent).toMatchObject({ ok: true, verified: true, status: 'done' });
  });

  it('não altera tarefa que não pertence ao usuário', async () => {
    const fake = deps({
      getProjectTaskForUser: vi.fn(async () => null),
      listOpenProjectTasksForUser: vi.fn(async () => []),
    });
    const response = await updateProjectTaskFromHermes({
      subject: 'luis',
      task_id: 'de-outra-pessoa',
      status: 'done',
    }, fake);
    expect(fake.moveProjectTask).not.toHaveBeenCalled();
    expect(response.structuredContent).toMatchObject({ ok: false, error_code: 'task_not_found' });
  });
});

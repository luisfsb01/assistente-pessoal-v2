import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { getUserBySubject, type ChatIdentity } from '../db/chats.js';
import {
  addProjectNote,
  addProjectTask,
  archiveProject,
  createProject,
  findProjectByName,
  listActiveProjects,
  listProjectTasks,
  listRecentNotes,
  moveProjectTask,
  setProjectStatus,
  type Project,
  type ProjectTask,
} from '../db/projects.js';

export type ProjectToolDeps = {
  getUserBySubject: typeof getUserBySubject;
  createProject: typeof createProject;
  findProjectByName: typeof findProjectByName;
  listActiveProjects: typeof listActiveProjects;
  setProjectStatus: typeof setProjectStatus;
  addProjectNote: typeof addProjectNote;
  listRecentNotes: typeof listRecentNotes;
  addProjectTask: typeof addProjectTask;
  moveProjectTask: typeof moveProjectTask;
  listProjectTasks: typeof listProjectTasks;
  archiveProject: typeof archiveProject;
};

const defaultDeps: ProjectToolDeps = {
  getUserBySubject,
  createProject,
  findProjectByName,
  listActiveProjects,
  setProjectStatus,
  addProjectNote,
  listRecentNotes,
  addProjectTask,
  moveProjectTask,
  listProjectTasks,
  archiveProject,
};

const FAIL = 'Não consegui acessar os projetos agora. Tenta de novo em instantes.';
const SEM_DONO = 'Projetos têm dono — de quem é? (Luis ou esposa)';

function ddmm(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}`;
}

function taskLine(t: ProjectTask): { id: string; titulo: string; prazo: string | null } {
  return { id: t.id, titulo: t.title, prazo: t.dueDate ? ddmm(t.dueDate) : null };
}

async function resolveProject(
  identity: ChatIdentity,
  name: string,
  deps: ProjectToolDeps,
): Promise<Project | 'sem-dono' | null> {
  if (!identity.subject) return 'sem-dono';
  const user = await deps.getUserBySubject(identity.subject);
  if (!user) return 'sem-dono';
  return deps.findProjectByName(user.id, name);
}

const NAO_ACHEI = (name: string) => `Não achei o projeto "${name}". Crie com project_create se for novo.`;

export function buildProjectTools(identity: ChatIdentity, deps: ProjectToolDeps = defaultDeps): ToolSet {
  return {
    project_create: tool({
      description: 'Cria um projeto para acompanhar por conversa (status, decisões, tarefas).',
      inputSchema: z.object({ name: z.string().min(2) }),
      execute: async ({ name }) => {
        try {
          if (!identity.subject) return SEM_DONO;
          const user = await deps.getUserBySubject(identity.subject);
          if (!user) return SEM_DONO;
          const p = await deps.createProject(user.id, name);
          return `Projeto "${p.name}" criado.`;
        } catch {
          return FAIL;
        }
      },
    }),
    project_note: tool({
      description:
        'Registra uma decisão ou anotação na linha do tempo de um projeto ("no projeto X decidi Y" → kind decision).',
      inputSchema: z.object({
        project_name: z.string(),
        kind: z.enum(['decision', 'note']),
        content: z.string().min(2),
      }),
      execute: async ({ project_name, kind, content }) => {
        try {
          const p = await resolveProject(identity, project_name, deps);
          if (p === 'sem-dono') return SEM_DONO;
          if (!p) return NAO_ACHEI(project_name);
          await deps.addProjectNote(p.id, kind, content);
          return `Registrado no projeto ${p.name}.`;
        } catch {
          return FAIL;
        }
      },
    }),
    project_set_status: tool({
      description: 'Atualiza o status curto do projeto ("status do X: aguardando cliente").',
      inputSchema: z.object({ project_name: z.string(), status: z.string().min(2) }),
      execute: async ({ project_name, status }) => {
        try {
          const p = await resolveProject(identity, project_name, deps);
          if (p === 'sem-dono') return SEM_DONO;
          if (!p) return NAO_ACHEI(project_name);
          await deps.setProjectStatus(p.id, status);
          await deps.addProjectNote(p.id, 'status', status);
          return `Status do ${p.name}: ${status}.`;
        } catch {
          return FAIL;
        }
      },
    }),
    project_overview: tool({
      description: 'Como está um projeto: status atual, últimas notas/decisões e o quadro de tarefas.',
      inputSchema: z.object({ project_name: z.string() }),
      execute: async ({ project_name }) => {
        try {
          const p = await resolveProject(identity, project_name, deps);
          if (p === 'sem-dono') return SEM_DONO;
          if (!p) return NAO_ACHEI(project_name);
          const [notes, tasks] = await Promise.all([deps.listRecentNotes(p.id), deps.listProjectTasks(p.id)]);
          return JSON.stringify({
            projeto: p.name,
            status: p.status,
            notas: notes.map((n) => ({ kind: n.kind, content: n.content, quando: ddmm(n.createdAt) })),
            tarefas: {
              todo: tasks.filter((t) => t.status === 'todo').map(taskLine),
              doing: tasks.filter((t) => t.status === 'doing').map(taskLine),
              done: tasks.filter((t) => t.status === 'done').slice(-5).map(taskLine),
            },
          });
        } catch {
          return FAIL;
        }
      },
    }),
    project_task_add: tool({
      description: 'Adiciona uma tarefa ao quadro do projeto (coluna to do), com prazo opcional.',
      inputSchema: z.object({
        project_name: z.string(),
        title: z.string().min(2),
        due_date: z.string().optional().describe('YYYY-MM-DD'),
      }),
      execute: async ({ project_name, title, due_date }) => {
        try {
          const p = await resolveProject(identity, project_name, deps);
          if (p === 'sem-dono') return SEM_DONO;
          if (!p) return NAO_ACHEI(project_name);
          const t = await deps.addProjectTask(p.id, title, due_date);
          return `Tarefa "${t.title}" no ${p.name}${t.dueDate ? ` (prazo ${ddmm(t.dueDate)})` : ''}.`;
        } catch {
          return FAIL;
        }
      },
    }),
    project_task_move: tool({
      description: 'Move uma tarefa do quadro (todo/doing/done) — use o id de project_overview/project_task_list.',
      inputSchema: z.object({ task_id: z.string(), status: z.enum(['todo', 'doing', 'done']) }),
      execute: async ({ task_id, status }) => {
        try {
          await deps.moveProjectTask(task_id, status);
          return `Tarefa movida para ${status}.`;
        } catch {
          return FAIL;
        }
      },
    }),
    project_task_list: tool({
      description: 'Lista as tarefas do quadro de um projeto.',
      inputSchema: z.object({ project_name: z.string() }),
      execute: async ({ project_name }) => {
        try {
          const p = await resolveProject(identity, project_name, deps);
          if (p === 'sem-dono') return SEM_DONO;
          if (!p) return NAO_ACHEI(project_name);
          const tasks = await deps.listProjectTasks(p.id);
          if (tasks.length === 0) return `Quadro do ${p.name} vazio.`;
          return JSON.stringify(tasks.map((t) => ({ ...taskLine(t), coluna: t.status })));
        } catch {
          return FAIL;
        }
      },
    }),
    project_archive: tool({
      description: 'Arquiva um projeto encerrado (some das listas e da cobrança).',
      inputSchema: z.object({ project_name: z.string() }),
      execute: async ({ project_name }) => {
        try {
          const p = await resolveProject(identity, project_name, deps);
          if (p === 'sem-dono') return SEM_DONO;
          if (!p) return NAO_ACHEI(project_name);
          await deps.archiveProject(p.id);
          return `Projeto ${p.name} arquivado.`;
        } catch {
          return FAIL;
        }
      },
    }),
  };
}

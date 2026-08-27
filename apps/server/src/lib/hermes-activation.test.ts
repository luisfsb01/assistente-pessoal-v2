import { execFile } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const workspaceRoot = resolve(import.meta.dirname, '../../../..');
const activationScript = resolve(workspaceRoot, 'scripts/activate-hermes-telegram.sh');
const patcherScript = resolve(workspaceRoot, 'scripts/patch-hermes-finance-callback.mjs');
const tempRoots: string[] = [];

function bashPath(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  if (process.platform !== 'win32') return normalized;
  const match = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  return match ? `/${match[1].toLowerCase()}/${match[2]}` : normalized;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function bashExecutable(): string {
  return process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
}

async function runActivation(restartExit: number) {
  const root = await mkdtemp(join(tmpdir(), 'apv2-hermes-activation-'));
  tempRoots.push(root);
  const repo = join(root, 'repo');
  const hermesHome = join(root, 'hermes-home');
  const fakeBin = join(root, 'bin');
  const pythonRoot = join(root, 'python');
  const adapterPath = join(pythonRoot, 'gateway', 'platforms', 'telegram.py');
  const pythonResult = await execFileAsync('python', ['-c', 'import sys; print(sys.executable)'], {
    encoding: 'utf8',
  });
  const pythonExecutable = pythonResult.stdout.trim();

  await Promise.all([
    mkdir(join(repo, 'scripts'), { recursive: true }),
    mkdir(join(repo, 'docs', 'hermes', 'skills', 'assistente-pessoal-v2'), { recursive: true }),
    mkdir(hermesHome, { recursive: true }),
    mkdir(fakeBin, { recursive: true }),
    mkdir(dirname(adapterPath), { recursive: true }),
  ]);
  await Promise.all([
    cp(patcherScript, join(repo, 'scripts', 'patch-hermes-finance-callback.mjs')),
    writeFile(join(repo, '.env'), 'TELEGRAM_TOKEN=bot-antigo\n', 'utf8'),
    writeFile(join(hermesHome, '.env'), 'TELEGRAM_BOT_TOKEN=123456:bot-hermes\n', 'utf8'),
    writeFile(
      join(hermesHome, 'config.yaml'),
      'mcp_servers:\n  assistente_v2:\n    tools:\n      include:\n        - operations_list_receipts\n',
      'utf8',
    ),
    writeFile(
      join(repo, 'docs', 'hermes', 'skills', 'assistente-pessoal-v2', 'SKILL.md'),
      '# Assistente Pessoal V2\n',
      'utf8',
    ),
    writeFile(join(repo, 'scripts', 'deploy-pull.sh'), '#!/usr/bin/env bash\nexit 0\n', 'utf8'),
    writeFile(join(pythonRoot, 'gateway', '__init__.py'), '', 'utf8'),
    writeFile(join(pythonRoot, 'gateway', 'platforms', '__init__.py'), '', 'utf8'),
    writeFile(
      adapterPath,
      `import re

class TelegramAdapter:
    async def _handle_callback_query(self, update, context):
        query = update.callback_query
        if not query or not query.data:
            return
        data = query.data
        query_message = getattr(query, "message", None)
        query_chat_id = getattr(query_message, "chat_id", None)
        query_chat = getattr(query_message, "chat", None)
        query_chat_type = getattr(query_chat, "type", None)
        query_thread_id = getattr(query_message, "message_thread_id", None)
        query_user_name = getattr(query.from_user, "first_name", None)

        # --- Model picker callbacks ---
        return
`,
      'utf8',
    ),
    writeFile(
      join(fakeBin, 'hermes'),
      '#!/usr/bin/env bash\n' +
        'if [ "$1" = "gateway" ] && [ "$2" = "restart" ]; then\n' +
        '  exit "${HERMES_RESTART_EXIT:-0}"\n' +
        'fi\n' +
        'exit 0\n',
      'utf8',
    ),
    writeFile(
      join(fakeBin, 'install'),
      '#!/usr/bin/env bash\n' +
        'if [ "$1" = "-d" ]; then\n' +
        '  mkdir -p -- "$5"\n' +
        'else\n' +
        '  cp -- "$4" "$5"\n' +
        'fi\n',
      'utf8',
    ),
    writeFile(join(fakeBin, 'chmod'), '#!/usr/bin/env bash\nexit 0\n', 'utf8'),
  ]);
  await Promise.all([
    chmod(join(repo, 'scripts', 'deploy-pull.sh'), 0o755),
    chmod(join(fakeBin, 'hermes'), 0o755),
    chmod(join(fakeBin, 'install'), 0o755),
    chmod(join(fakeBin, 'chmod'), 0o755),
  ]);

  const command = [
    `export PATH=${shellQuote(bashPath(fakeBin))}:"$PATH"`,
    `export PYTHONPATH=${shellQuote(bashPath(pythonRoot))}`,
    `export APV2_REPO=${shellQuote(bashPath(repo))}`,
    `export HERMES_HOME=${shellQuote(bashPath(hermesHome))}`,
    `export HERMES_PYTHON=${shellQuote(bashPath(pythonExecutable))}`,
    `export HERMES_RESTART_EXIT=${restartExit}`,
    shellQuote(bashPath(activationScript)),
  ].join('; ');

  try {
    const result = await execFileAsync(bashExecutable(), ['-lc', command], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr, adapterPath };
  } catch (error) {
    const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof failure.code === 'number' ? failure.code : 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
      adapterPath,
    };
  }
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('activate-hermes-telegram.sh', () => {
  it('conclui somente quando o gateway Hermes reinicia', async () => {
    const result = await runActivation(0);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Migração concluída:');
    expect(await readFile(result.adapterPath, 'utf8')).toContain('APV2_FINANCE_CALLBACK_BEGIN');
  }, 90_000);

  it('falha fechado após deploy, preserva o patch e rejeita /reload-mcp como falso restart', async () => {
    const result = await runActivation(1);

    expect(result.code).not.toBe(0);
    expect(result.stdout).not.toContain('Migração concluída:');
    expect(result.stderr).toContain('Não use /reload-mcp');
    expect(result.stderr).toContain('adapter Hermes patchado foi mantido em disco');
    expect(result.stderr).toContain('hermes gateway restart');
    expect(await readFile(result.adapterPath, 'utf8')).toContain('APV2_FINANCE_CALLBACK_BEGIN');
  }, 90_000);
});

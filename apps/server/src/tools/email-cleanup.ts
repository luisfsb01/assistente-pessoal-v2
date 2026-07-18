import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { getUserBySubject, type ChatIdentity } from '../db/chats.js';
import {
  addEmailCleanupProtection,
  type EmailProtectionMatch,
} from '../db/email-cleanup.js';

export type EmailCleanupToolDeps = {
  getUserBySubject: typeof getUserBySubject;
  addProtection: typeof addEmailCleanupProtection;
};

const defaultDeps: EmailCleanupToolDeps = {
  getUserBySubject,
  addProtection: addEmailCleanupProtection,
};

export function buildEmailCleanupTools(
  identity: ChatIdentity,
  deps: EmailCleanupToolDeps = defaultDeps,
): ToolSet {
  return {
    email_cleanup_protect: tool({
      description:
        'Cria uma proteção permanente quando Luis disser que um tipo de e-mail não deve ser enviado à lixeira. Escolha sender para remetente/endereço, domain para domínio, subject para palavra ou frase no assunto e any quando o termo puder aparecer em qualquer parte.',
      inputSchema: z.object({
        match_on: z.enum(['sender', 'domain', 'subject', 'any']),
        match_value: z.string().min(2).max(200).describe('Trecho objetivo que identifica o tipo de e-mail'),
        description: z.string().max(300).optional().describe('Explicação curta da regra'),
      }),
      execute: async ({ match_on, match_value, description }) => {
        if (identity.kind !== 'private' || identity.subject !== 'luis') {
          return 'Essa proteção só pode ser configurada no chat privado do Luis.';
        }
        try {
          const user = await deps.getUserBySubject('luis');
          if (!user) return 'Não encontrei o usuário do Luis para salvar a proteção.';
          await deps.addProtection({
            userId: user.id,
            matchOn: match_on as EmailProtectionMatch,
            matchValue: match_value,
            description,
          });
          return `Proteção salva: e-mails que correspondam a "${match_value.trim()}" não serão enviados à lixeira.`;
        } catch {
          return 'Não consegui salvar essa proteção agora. Tente novamente em instantes.';
        }
      },
    }),
  };
}

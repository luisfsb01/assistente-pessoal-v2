import type { gmail_v1 } from 'googleapis';

export type InboxEmail = {
  id: string;
  from: string;
  subject: string;
  snippet: string; // trecho (~200 chars) para a classificação
  categories: string[]; // labels CATEGORY_* do Gmail (sinal para a IA)
  starred: boolean;
  internalDate: number; // epoch ms
};

export type GmailApi = {
  /** E-mails do INBOX estritamente mais novos que o instante (epoch ms). */
  listNewInboxEmails(afterEpochMs: number): Promise<InboxEmail[]>;
  /** Move a mensagem para a lixeira do Gmail (recuperável por 30 dias). */
  trashMessage(id: string): Promise<void>;
};

function header(msg: gmail_v1.Schema$Message, name: string): string {
  const h = (msg.payload?.headers ?? []).find((x) => (x.name ?? '').toLowerCase() === name.toLowerCase());
  return h?.value ?? '';
}

/** PURA: mensagem crua do Gmail → e-mail da caixa. */
export function mapMessage(msg: gmail_v1.Schema$Message): InboxEmail {
  const labels = msg.labelIds ?? [];
  return {
    id: msg.id ?? '',
    from: header(msg, 'From'),
    subject: header(msg, 'Subject'),
    snippet: (msg.snippet ?? '').slice(0, 200),
    categories: labels.filter((l) => l.startsWith('CATEGORY_')),
    starred: labels.includes('STARRED'),
    internalDate: Number(msg.internalDate ?? 0),
  };
}

// ---- googleapis translation ------------------------------------------------

export function gmailApiFromGoogle(client: gmail_v1.Gmail): GmailApi {
  return {
    async listNewInboxEmails(afterEpochMs) {
      // after: do Gmail tem granularidade de segundos e é inclusivo — o filtro fino é pelo internalDate
      const q = `in:inbox after:${Math.floor(afterEpochMs / 1000)}`;
      const res = await client.users.messages.list({ userId: 'me', q, maxResults: 50 });
      const out: InboxEmail[] = [];
      for (const m of res.data.messages ?? []) {
        if (!m.id) continue;
        const full = await client.users.messages.get({
          userId: 'me',
          id: m.id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject'],
        });
        const email = mapMessage(full.data);
        if (email.internalDate > afterEpochMs) out.push(email);
      }
      return out;
    },
    async trashMessage(id) {
      await client.users.messages.trash({ userId: 'me', id });
    },
  };
}

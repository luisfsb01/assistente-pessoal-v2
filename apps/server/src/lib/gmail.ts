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

export type GmailSearchEmail = InboxEmail & {
  /** Corpo legível e limitado; usado apenas durante a associação, sem persistir o e-mail. */
  bodyText: string;
};

export type GmailApi = {
  /** E-mails do INBOX estritamente mais novos que o instante (epoch ms). */
  listNewInboxEmails(afterEpochMs: number): Promise<InboxEmail[]>;
  /** Pesquisa mensagens em todo o Gmail usando a sintaxe nativa da caixa de busca. */
  searchEmails(query: string, maxResults?: number): Promise<GmailSearchEmail[]>;
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

function decodeBody(data?: string | null): string {
  if (!data) return '';
  try {
    return Buffer.from(data, 'base64url').toString('utf8');
  } catch {
    return '';
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function readableHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/tr>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  );
}

function collectBodies(part: gmail_v1.Schema$MessagePart | undefined, plain: string[], html: string[]): void {
  if (!part) return;
  const decoded = decodeBody(part.body?.data);
  if (decoded) {
    if ((part.mimeType ?? '').toLowerCase() === 'text/html') html.push(readableHtml(decoded));
    else if ((part.mimeType ?? '').toLowerCase() === 'text/plain') plain.push(decoded);
  }
  for (const child of part.parts ?? []) collectBodies(child, plain, html);
}

/** Mensagem completa do Gmail -> conteúdo legível para busca de comprovantes. */
export function mapSearchMessage(msg: gmail_v1.Schema$Message): GmailSearchEmail {
  const plain: string[] = [];
  const html: string[] = [];
  collectBodies(msg.payload ?? undefined, plain, html);
  const base = mapMessage(msg);
  const body = (plain.length > 0 ? plain : html).join('\n');
  return {
    ...base,
    snippet: (msg.snippet ?? '').slice(0, 500),
    bodyText: body.replace(/\s+/g, ' ').trim().slice(0, 12_000),
  };
}

// ---- googleapis translation ------------------------------------------------

export function gmailApiFromGoogle(client: gmail_v1.Gmail): GmailApi {
  return {
    async listNewInboxEmails(afterEpochMs) {
      // after: do Gmail tem granularidade de segundos e é inclusivo — o filtro fino é pelo internalDate
      const q = `in:inbox after:${Math.floor(afterEpochMs / 1000)}`;
      const out: InboxEmail[] = [];
      // pagina até esgotar o nextPageToken — uma rajada de e-mails pode passar de 50 (1 página)
      let pageToken: string | undefined;
      do {
        const res = await client.users.messages.list({ userId: 'me', q, maxResults: 50, pageToken });
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
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
      // ordem determinística: mais antigo primeiro (quem chama decide o que processar primeiro numa rajada)
      out.sort((a, b) => a.internalDate - b.internalDate);
      return out;
    },
    async searchEmails(query, maxResults = 20) {
      const limit = Math.max(1, Math.min(maxResults, 50));
      const ids: string[] = [];
      let pageToken: string | undefined;
      do {
        const res = await client.users.messages.list({
          userId: 'me',
          q: query,
          maxResults: Math.min(50, limit - ids.length),
          pageToken,
        });
        for (const message of res.data.messages ?? []) {
          if (message.id && !ids.includes(message.id)) ids.push(message.id);
          if (ids.length >= limit) break;
        }
        pageToken = ids.length < limit ? (res.data.nextPageToken ?? undefined) : undefined;
      } while (pageToken);

      const out: GmailSearchEmail[] = [];
      for (const id of ids) {
        const full = await client.users.messages.get({ userId: 'me', id, format: 'full' });
        out.push(mapSearchMessage(full.data));
      }
      out.sort((a, b) => a.internalDate - b.internalDate);
      return out;
    },
    async trashMessage(id) {
      await client.users.messages.trash({ userId: 'me', id });
    },
  };
}

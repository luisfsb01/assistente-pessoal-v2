import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { NoteOrigin } from './vault.js';

export type Extracted = { kind: NoteOrigin; title: string; markdown: string };

export type Fetcher = (url: string) => Promise<{ ok: boolean; text: () => Promise<string> }>;

const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;

function isBlockedIpv4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

export function isBlockedIp(ip: string): boolean {
  const normalized = ip.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(normalized) === 4) return isBlockedIpv4(normalized);
  if (isIP(normalized) !== 6) return true;
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  return mapped ? isBlockedIpv4(mapped[1]) : false;
}

type Resolver = (hostname: string) => Promise<Array<{ address: string }>>;

export async function assertPublicHttpUrl(
  raw: string,
  resolver: Resolver = async (hostname) => lookup(hostname, { all: true, verbatim: true }),
): Promise<URL> {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Apenas URLs HTTP/HTTPS são aceitas.');
  if (url.username || url.password) throw new Error('URL com credenciais não é aceita.');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('Porta não permitida.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Host local não permitido.');
  }
  const addresses = isIP(hostname) ? [{ address: hostname }] : await resolver(hostname);
  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedIp(address))) {
    throw new Error('Endereço privado ou reservado não permitido.');
  }
  return url;
}

async function boundedText(res: Response): Promise<string> {
  const announced = Number(res.headers.get('content-length') ?? 0);
  if (announced > MAX_DOWNLOAD_BYTES) throw new Error('Conteúdo remoto excede 2 MB.');
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_DOWNLOAD_BYTES) {
      await reader.cancel();
      throw new Error('Conteúdo remoto excede 2 MB.');
    }
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}

async function safeFetch(raw: string, redirects = 0): Promise<{ ok: boolean; text: () => Promise<string> }> {
  const url = await assertPublicHttpUrl(raw);
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (assistente-pessoal-v2)' },
    signal: AbortSignal.timeout(15_000),
    redirect: 'manual',
  });
  if (res.status >= 300 && res.status < 400) {
    if (redirects >= MAX_REDIRECTS) throw new Error('Redirecionamentos demais.');
    const location = res.headers.get('location');
    if (!location) throw new Error('Redirecionamento sem destino.');
    return safeFetch(new URL(location, url).toString(), redirects + 1);
  }
  return { ok: res.ok, text: () => boundedText(res) };
}

const defaultFetcher: Fetcher = (url) => safeFetch(url);

/** PURA: youtube.com/youtu.be viram 'youtube'; o resto tenta artigo. */
export function detectKind(url: string): 'youtube' | 'article' {
  const host = new URL(url).hostname.replace(/^(www\.|m\.)/, '');
  return host === 'youtube.com' || host === 'youtu.be' ? 'youtube' : 'article';
}

/** PURA: HTML → título + markdown do conteúdo principal (modo leitura). Null = extração pobre. */
export function articleFromHtml(html: string, url: string): { title: string; markdown: string } | null {
  const dom = new JSDOM(html, { url });
  const parsed = new Readability(dom.window.document).parse();
  if (!parsed?.content) return null;
  const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  const markdown = turndown.turndown(parsed.content).trim();
  if (markdown.length < 200) return null; // pobre demais: melhor guardar só o link
  return { title: (parsed.title || url).trim(), markdown };
}

/** Legendas do YouTube (XML) → texto corrido. */
function captionsXmlToText(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function extractYoutube(url: string, fetcher: Fetcher): Promise<{ title: string; markdown: string } | null> {
  const res = await fetcher(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
  if (!res.ok) return null;
  const meta = JSON.parse(await res.text()) as { title?: string; author_name?: string };
  const title = meta.title ?? url;

  // Transcrição é melhor esforço: legendas públicas da página do vídeo, se existirem
  let transcript = '';
  try {
    const page = await fetcher(url);
    if (page.ok) {
      const m = (await page.text()).match(/"captionTracks":\s*(\[.*?\])/);
      if (m) {
        const tracks = JSON.parse(m[1]) as Array<{ baseUrl: string; languageCode?: string }>;
        const track =
          tracks.find((t) => t.languageCode?.startsWith('pt')) ??
          tracks.find((t) => t.languageCode?.startsWith('en')) ??
          tracks[0];
        if (track?.baseUrl) {
          const cap = await fetcher(track.baseUrl.replace(/\\u0026/g, '&'));
          if (cap.ok) transcript = captionsXmlToText(await cap.text());
        }
      }
    }
  } catch (err) {
    console.error('[extract] transcrição do YouTube falhou (seguindo sem):', err);
  }

  const markdown = [
    `Vídeo de ${meta.author_name ?? 'autor desconhecido'}: ${url}`,
    ...(transcript ? ['', '## Transcrição', '', transcript] : []),
  ].join('\n');
  return { title, markdown };
}

/** Extrai a URL para virar nota. NUNCA lança: falha degrada para link+nota. */
export async function extractFromUrl(
  url: string,
  note: string | undefined,
  fetcher: Fetcher = defaultFetcher,
): Promise<Extracted> {
  try {
    if (detectKind(url) === 'youtube') {
      const yt = await extractYoutube(url, fetcher);
      if (yt) return { kind: 'youtube', ...yt };
    } else {
      const res = await fetcher(url);
      if (res.ok) {
        const art = articleFromHtml(await res.text(), url);
        if (art) return { kind: 'article', ...art };
      }
    }
  } catch (err) {
    console.error('[extract] extração falhou (salvando como link):', err);
  }
  // Fallback: guarda o link e a nota do Luis — captura nunca falha por extração
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {
    // url malformada: usa a string crua como título mesmo
  }
  const title = note?.trim() ? note.trim().slice(0, 60) : host;
  const markdown = [url, ...(note ? ['', note] : [])].join('\n');
  return { kind: 'link', title, markdown };
}

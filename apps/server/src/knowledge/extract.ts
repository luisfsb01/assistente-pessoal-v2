import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import type { NoteOrigin } from './vault.js';

export type Extracted = { kind: NoteOrigin; title: string; markdown: string };

export type Fetcher = (url: string) => Promise<{ ok: boolean; text: () => Promise<string> }>;

const defaultFetcher: Fetcher = (url) =>
  fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (assistente-pessoal-v2)' },
    signal: AbortSignal.timeout(15_000),
  });

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

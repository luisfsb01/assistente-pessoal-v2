import { describe, expect, it } from 'vitest';
import { articleFromHtml, detectKind, extractFromUrl, type Fetcher } from './extract.js';

const ARTICLE_HTML = `<!doctype html><html><head><title>Guia de Testes</title></head><body>
<article><h1>Guia de Testes</h1>${'<p>Parágrafo com conteúdo relevante sobre testes de software e boas práticas de engenharia.</p>'.repeat(10)}</article>
</body></html>`;

describe('detectKind', () => {
  it('youtube pelos domínios; resto é article', () => {
    expect(detectKind('https://www.youtube.com/watch?v=abc123')).toBe('youtube');
    expect(detectKind('https://youtu.be/abc123')).toBe('youtube');
    expect(detectKind('https://example.com/post')).toBe('article');
  });
});

describe('articleFromHtml', () => {
  it('extrai título e markdown do conteúdo principal', () => {
    const out = articleFromHtml(ARTICLE_HTML, 'https://example.com/post');
    expect(out).not.toBeNull();
    expect(out!.title).toContain('Guia de Testes');
    expect(out!.markdown).toContain('conteúdo relevante');
    expect(out!.markdown).not.toContain('<p>');
  });
  it('html pobre demais retorna null (vai para fallback)', () => {
    expect(articleFromHtml('<html><body><p>oi</p></body></html>', 'https://x.com')).toBeNull();
  });
});

describe('extractFromUrl', () => {
  it('artigo: usa o fetcher e devolve kind article', async () => {
    const fetcher: Fetcher = async () => ({ ok: true, text: async () => ARTICLE_HTML });
    const out = await extractFromUrl('https://example.com/post', undefined, fetcher);
    expect(out.kind).toBe('article');
    expect(out.title).toContain('Guia de Testes');
  });

  it('youtube: título via oEmbed; sem legenda, corpo tem o link e o autor', async () => {
    const fetcher: Fetcher = async (url) => {
      if (url.includes('oembed'))
        return { ok: true, text: async () => JSON.stringify({ title: 'Vídeo Top', author_name: 'Canal X' }) };
      return { ok: true, text: async () => '<html>sem captionTracks aqui</html>' };
    };
    const out = await extractFromUrl('https://youtu.be/abc123', undefined, fetcher);
    expect(out.kind).toBe('youtube');
    expect(out.title).toBe('Vídeo Top');
    expect(out.markdown).toContain('Canal X');
    expect(out.markdown).toContain('https://youtu.be/abc123');
  });

  it('youtube com legenda: transcrição entra no corpo', async () => {
    const watchHtml = '{"captionTracks":[{"baseUrl":"https://yt.example/cap?lang=pt","languageCode":"pt"}]}';
    const fetcher: Fetcher = async (url) => {
      if (url.includes('oembed')) return { ok: true, text: async () => JSON.stringify({ title: 'V', author_name: 'C' }) };
      if (url.includes('yt.example/cap'))
        return { ok: true, text: async () => '<transcript><text start="0">Olá &amp; bem-vindos</text><text start="2">ao canal</text></transcript>' };
      return { ok: true, text: async () => watchHtml };
    };
    const out = await extractFromUrl('https://www.youtube.com/watch?v=abc', undefined, fetcher);
    expect(out.markdown).toContain('Transcrição');
    expect(out.markdown).toContain('Olá & bem-vindos ao canal');
  });

  it('falha de rede ou página pobre degrada para link+nota (nunca lança)', async () => {
    const fetcher: Fetcher = async () => {
      throw new Error('rede fora');
    };
    const out = await extractFromUrl('https://podcast.example/ep42', 'episódio sobre hábitos', fetcher);
    expect(out.kind).toBe('link');
    expect(out.markdown).toContain('https://podcast.example/ep42');
    expect(out.markdown).toContain('episódio sobre hábitos');
    expect(out.title).toBe('episódio sobre hábitos');
  });

  it('fallback sem nota usa o hostname como título', async () => {
    const fetcher: Fetcher = async () => ({ ok: false, text: async () => '' });
    const out = await extractFromUrl('https://blog.example.com/x', undefined, fetcher);
    expect(out.kind).toBe('link');
    expect(out.title).toBe('blog.example.com');
  });

  it('URL malformada sem nota não lança — vira link com a própria string', async () => {
    const fetcher: Fetcher = async () => ({ ok: true, text: async () => '' });
    const out = await extractFromUrl('example.com/post', undefined, fetcher);
    expect(out.kind).toBe('link');
    expect(out.title).toBe('example.com/post');
  });
});

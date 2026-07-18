import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { useSession } from './lib/useSession'

vi.mock('./lib/useSession', () => ({ useSession: vi.fn() }))
vi.mock('./lib/supabase', () => ({
  supabase: { auth: { signInWithPassword: vi.fn(), resetPasswordForEmail: vi.fn() } },
}))

const sessionHook = vi.mocked(useSession)

describe('App smoke', () => {
  beforeEach(() => vi.clearAllMocks())

  it('mostra estado de carregamento sem renderizar conteúdo protegido', () => {
    sessionHook.mockReturnValue({ session: null, loading: true })
    const html = renderToStaticMarkup(<MemoryRouter><App /></MemoryRouter>)
    expect(html).toContain('Carregando')
    expect(html).not.toContain('Dashboard')
  })

  it('renderiza login para visitante sem sessão', () => {
    sessionHook.mockReturnValue({ session: null, loading: false })
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/login']}><App /></MemoryRouter>,
    )
    expect(html).toContain('Assistente da Família')
    expect(html).toContain('type="password"')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Criar conta<\/button>/)
  })
})

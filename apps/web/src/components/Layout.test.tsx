import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import Layout, { navSections } from './Layout'
import { useSession } from '../lib/useSession'

vi.mock('../lib/useSession', () => ({ useSession: vi.fn() }))
vi.mock('../lib/supabase', () => ({
  supabase: { auth: { signOut: vi.fn() } },
}))

describe('Layout sidebar', () => {
  it('organiza a navegação nas seções e na ordem esperadas', () => {
    expect(navSections.map((section) => section.title)).toEqual(['Finanças', 'Produtividade'])
    expect(navSections[0].links.map((link) => link.label)).toEqual([
      'Painel', 'Transações', 'Categorias', 'Objetivos', 'Compromissos',
    ])
    expect(navSections[1].links.map((link) => link.label)).toEqual([
      'Hábitos', 'Projetos', 'Compras', 'Tarefas',
    ])
  })

  it('renderiza os títulos das seções e mantém os itens gerais', () => {
    vi.mocked(useSession).mockReturnValue({
      session: { user: { email: 'casal@example.com' } } as never,
      loading: false,
    })

    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<div>Conteúdo</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(html).toContain('Finanças')
    expect(html).toContain('Produtividade')
    expect(html).toContain('Memórias')
    expect(html).toContain('Configurações')
    expect(html.indexOf('Finanças')).toBeLessThan(html.indexOf('Produtividade'))
  })
})

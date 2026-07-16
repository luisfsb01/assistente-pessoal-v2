import { useState, useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useSession } from '../lib/useSession'

const navLinks = [
  { to: '/',              label: 'Painel',        icon: '📊', end: true  },
  { to: '/tarefas',       label: 'Tarefas',        icon: '✅', end: false },
  { to: '/compras',       label: 'Compras',        icon: '🛒', end: false },
  { to: '/habitos',       label: 'Hábitos',        icon: '🔁', end: false },
  { to: '/projetos',      label: 'Projetos',       icon: '📁', end: false },
  { to: '/transacoes',    label: 'Transações',     icon: '💸', end: false },
  { to: '/categorias',    label: 'Categorias',     icon: '🏷', end: false },
  { to: '/objetivos',     label: 'Objetivos',      icon: '🎯', end: false },
  { to: '/compromissos',  label: 'Compromissos',   icon: '💳', end: false },
  { to: '/configuracoes', label: 'Configurações',  icon: '⚙️', end: false },
]

function navClass({ isActive }: { isActive: boolean }) {
  return [
    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-base transition-colors',
    isActive
      ? 'bg-accent-soft text-accent-soft-ink font-semibold'
      : 'text-muted hover:bg-surface-2',
  ].join(' ')
}

function isMobile() {
  return typeof window !== 'undefined' && window.innerWidth < 768
}

export default function Layout() {
  const { session } = useSession()
  const navigate = useNavigate()

  const [open, setOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('sidebar')
      if (saved !== null) return saved === 'true'
    } catch {}
    return !isMobile()
  })

  useEffect(() => {
    try {
      localStorage.setItem('sidebar', String(open))
    } catch {}
  }, [open])

  // Close sidebar on mobile when window resizes to desktop
  useEffect(() => {
    function handleResize() {
      if (window.innerWidth >= 768 && !open) {
        // Don't force open — respect saved preference
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [open])

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  function handleNavClick() {
    // On mobile, close sidebar after nav
    if (isMobile()) setOpen(false)
  }

  const mobile = isMobile()

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-canvas)]">

      {/* ── Topbar — always visible ── */}
      <header
        className="sticky top-0 z-20 h-14 flex items-center gap-3 px-4 border-b border-hairline"
        style={{ backgroundColor: 'color-mix(in oklab, var(--color-surface) 80%, transparent)', backdropFilter: 'blur(12px)' }}
      >
        {/* Hamburger */}
        <button
          className="btn-ghost p-2"
          aria-label="Menu"
          onClick={() => setOpen((v) => !v)}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <rect y="3"  width="18" height="2" rx="1" fill="currentColor"/>
            <rect y="8"  width="18" height="2" rx="1" fill="currentColor"/>
            <rect y="13" width="18" height="2" rx="1" fill="currentColor"/>
          </svg>
        </button>

        {/* Brand */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-brand-600 grid place-items-center text-white text-sm shrink-0">
            ⚡
          </div>
          <span className="font-bold text-ink text-sm leading-tight">Assistente</span>
        </div>
      </header>

      {/* ── Body row: sidebar + main ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Mobile backdrop ── */}
        {open && (
          <div
            className="md:hidden fixed inset-0 bg-black/40 z-20"
            onClick={() => setOpen(false)}
          />
        )}

        {/* ── Sidebar ──
              Desktop (md+): flex child that pushes main, animated width.
              Mobile       : fixed off-canvas drawer that overlays content.
        */}
        <aside
          className={[
            // shared
            'bg-surface border-r border-hairline flex flex-col gap-6 overflow-hidden transition-[width] duration-300',
            // mobile: fixed drawer
            'fixed inset-y-0 left-0 z-30 md:static md:inset-auto md:z-auto',
            // widths
            open ? 'w-64' : 'w-0',
          ].join(' ')}
          // On mobile the sidebar sits in its own stacking context (fixed),
          // so the topbar z-20 still shows above it; we use pt-14 to push
          // sidebar content below the topbar on mobile.
          style={{ paddingTop: mobile && open ? '3.5rem' : undefined }}
        >
          {/* Inner scroll container — prevents content being clipped during transition */}
          <div className="flex flex-col gap-6 flex-1 p-4 min-w-[16rem]">
            {/* Logo — only shown inside sidebar on desktop (mobile has topbar) */}
            <div className="hidden md:flex items-center gap-3 px-1">
              <div className="w-9 h-9 rounded-xl bg-brand-600 grid place-items-center text-white text-lg shrink-0">
                ⚡
              </div>
              <span className="font-bold text-ink text-lg leading-tight">Assistente</span>
            </div>

            {/* Nav */}
            <nav className="flex flex-col gap-1.5 flex-1">
              {navLinks.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.end}
                  className={navClass}
                  onClick={handleNavClick}
                >
                  <span className="text-lg leading-none">{link.icon}</span>
                  {link.label}
                </NavLink>
              ))}
            </nav>

            {/* Footer */}
            <div className="flex flex-col gap-2">
              {session?.user?.email && (
                <p className="text-xs text-muted px-3 truncate" title={session.user.email}>
                  {session.user.email}
                </p>
              )}
              <button onClick={handleSignOut} className="btn-ghost w-full justify-start">
                Sair
              </button>
            </div>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="flex-1 overflow-auto">
          <div className="max-w-[1600px] mx-auto w-full px-6 lg:px-10 py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}

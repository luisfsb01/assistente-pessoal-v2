import { useTheme } from '../lib/useTheme'

export default function Configuracoes() {
  const { theme, toggle } = useTheme()

  const connectUrl = import.meta.env.VITE_BANCO_MCP_CONNECT_URL as string | undefined

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink">Configurações</h1>
        <p className="text-sm text-muted mt-1">Aparência e integrações</p>
      </div>

      {/* Aparência */}
      <div className="card">
        <h2 className="font-semibold text-ink mb-3">Aparência</h2>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-ink">Tema escuro</p>
            <p className="text-xs text-muted mt-0.5">Alterna entre claro e escuro</p>
          </div>
          <button
            onClick={toggle}
            role="switch"
            aria-checked={theme === 'dark'}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              theme === 'dark'
                ? 'bg-brand-600'
                : 'bg-surface-2 border border-hairline'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                theme === 'dark' ? 'translate-x-5' : ''
              }`}
            />
          </button>
        </div>
      </div>

      {/* Bancos (Open Finance) */}
      <div className="card">
        <h2 className="font-semibold text-ink mb-2">Bancos</h2>
        <p className="text-sm text-muted mb-4">
          Conecte ou gerencie seus bancos no painel do Banco MCP. As transações conectadas
          aparecem automaticamente no painel e nos resumos.
        </p>
        {connectUrl ? (
          <button
            className="btn-primary"
            onClick={() => window.open(connectUrl, '_blank', 'noopener,noreferrer')}
          >
            Conectar / gerenciar bancos
          </button>
        ) : (
          <div className="space-y-2">
            <button className="btn-primary opacity-50 cursor-not-allowed" disabled>
              Conectar / gerenciar bancos
            </button>
            <p className="text-xs text-muted">
              Defina <code className="font-mono">VITE_BANCO_MCP_CONNECT_URL</code> no arquivo{' '}
              <code className="font-mono">apps/web/.env</code> (o link de conexão do seu painel Banco MCP).
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

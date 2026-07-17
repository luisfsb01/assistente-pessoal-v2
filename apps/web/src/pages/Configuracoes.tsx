import { FormEvent, useEffect, useState } from 'react'
import { useTheme } from '../lib/useTheme'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/api'
import { formatBrl } from '../lib/format'

interface ProactivityConfig {
  quietStart: string
  quietEnd: string
  maxNotificationsPerDay: number
}

type RoutineKey = 'briefing' | 'coupleBriefing' | 'financeReview' | 'checkin'
type RoutinesConfig = Record<RoutineKey, { time: string; enabled: boolean }>

interface LlmCost {
  spentBrl: number
  budgetBrl: number
  byPurpose: Array<{ purpose: string; costBrl: number }>
}

// Defaults espelham o servidor (proactive/rules.ts e jobs/routines.ts)
const DEFAULT_PROACTIVITY: ProactivityConfig = {
  quietStart: '22:00', quietEnd: '07:00', maxNotificationsPerDay: 5,
}
const DEFAULT_ROUTINES: RoutinesConfig = {
  briefing: { time: '07:00', enabled: true },
  coupleBriefing: { time: '08:00', enabled: true },
  financeReview: { time: '08:00', enabled: true },
  checkin: { time: '21:00', enabled: true },
}
const ROUTINE_LABEL: Record<RoutineKey, string> = {
  briefing: 'Briefing matinal',
  coupleBriefing: 'Briefing do casal (sábados)',
  financeReview: 'Revisão financeira',
  checkin: 'Check-in de hábitos (noite)',
}
const ROUTINE_KEYS: RoutineKey[] = ['briefing', 'coupleBriefing', 'financeReview', 'checkin']

export default function Configuracoes() {
  const { theme, toggle } = useTheme()
  const connectUrl = import.meta.env.VITE_BANCO_MCP_CONNECT_URL as string | undefined

  const [proactivity, setProactivity] = useState<ProactivityConfig>(DEFAULT_PROACTIVITY)
  const [routines, setRoutines] = useState<RoutinesConfig>(DEFAULT_ROUTINES)
  const [configLoaded, setConfigLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [cost, setCost] = useState<LlmCost | null>(null)
  const [costError, setCostError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('app_state')
      .select('key, value')
      .in('key', ['proactivity_config', 'routines_config'])
      .then(({ data, error }) => {
        if (error) { setError(error.message); return }
        for (const row of data ?? []) {
          if (row.key === 'proactivity_config') {
            setProactivity({ ...DEFAULT_PROACTIVITY, ...(row.value as Partial<ProactivityConfig>) })
          }
          if (row.key === 'routines_config') {
            const stored = row.value as Partial<RoutinesConfig>
            setRoutines((prev) => {
              const next = { ...prev }
              for (const k of ROUTINE_KEYS) next[k] = { ...DEFAULT_ROUTINES[k], ...(stored[k] ?? {}) }
              return next
            })
          }
        }
        setConfigLoaded(true)
      })

    apiFetch('/api/llm-cost').then(async (res) => {
      if (!res.ok) { setCostError(`Erro ${res.status} ao carregar o custo`); return }
      setCost(await res.json() as LlmCost)
    }).catch(() => setCostError('Erro de rede ao carregar o custo'))
  }, [])

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    const teto = proactivity.maxNotificationsPerDay
    if (!Number.isInteger(teto) || teto < 1 || teto > 20) {
      setError('O teto de notificações deve ser um inteiro entre 1 e 20.')
      return
    }
    setSaving(true)
    setError(null)
    setSaveMsg(null)
    const { error } = await supabase.from('app_state').upsert([
      { key: 'proactivity_config', value: proactivity },
      { key: 'routines_config', value: routines },
    ])
    setSaving(false)
    if (error) { setError(error.message); return }
    setSaveMsg('Salvo — vale a partir do próximo minuto.')
  }

  const pct = cost ? Math.min(100, Math.round((cost.spentBrl / cost.budgetBrl) * 100)) : 0
  const barColor = pct >= 100 ? 'bg-red-600' : pct >= 80 ? 'bg-amber-500' : 'bg-brand-600'

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink">Configurações</h1>
        <p className="text-sm text-muted mt-1">Aparência, integrações e o comportamento do assistente</p>
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

      {/* Custo LLM */}
      <div className="card">
        <h2 className="font-semibold text-ink mb-3">Custo de IA no mês</h2>
        {costError && <p className="text-sm text-red-600">{costError}</p>}
        {!cost && !costError && <p className="text-sm text-muted">Carregando…</p>}
        {cost && (
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <span className="text-lg font-bold text-ink">{formatBrl(cost.spentBrl)}</span>
              <span className="text-sm text-muted">teto {formatBrl(cost.budgetBrl)}</span>
            </div>
            <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
              <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
            </div>
            {cost.byPurpose.length > 0 && (
              <table className="text-sm">
                <tbody>
                  {cost.byPurpose.map((p) => (
                    <tr key={p.purpose}>
                      <td className="text-muted py-0.5">{p.purpose}</td>
                      <td className="text-ink text-right">{formatBrl(p.costBrl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Assistente: silêncio, teto e rotinas */}
      <form onSubmit={handleSave} className="card flex flex-col gap-4">
        <h2 className="font-semibold text-ink">Assistente</h2>
        {!configLoaded && <p className="text-sm text-muted">Carregando…</p>}

        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted">Silêncio: início</label>
            <input
              type="time"
              value={proactivity.quietStart}
              onChange={(e) => setProactivity({ ...proactivity, quietStart: e.target.value })}
              className="input"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted">Silêncio: fim</label>
            <input
              type="time"
              value={proactivity.quietEnd}
              onChange={(e) => setProactivity({ ...proactivity, quietEnd: e.target.value })}
              className="input"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted">Máx. notificações/dia</label>
            <input
              type="number"
              min="1"
              max="20"
              value={proactivity.maxNotificationsPerDay}
              onChange={(e) => setProactivity({ ...proactivity, maxNotificationsPerDay: parseInt(e.target.value || '0', 10) })}
              className="input w-24"
            />
          </div>
        </div>
        <p className="text-xs text-muted">
          No silêncio, avisos proativos seguram até a manhã. O teto vale por pessoa/dia.
        </p>

        <h3 className="text-sm font-semibold text-ink mt-2">Rotinas</h3>
        <div className="flex flex-col gap-2">
          {ROUTINE_KEYS.map((key) => (
            <div key={key} className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                role="switch"
                aria-checked={routines[key].enabled}
                onClick={() => setRoutines({ ...routines, [key]: { ...routines[key], enabled: !routines[key].enabled } })}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                  routines[key].enabled ? 'bg-brand-600' : 'bg-surface-2 border border-hairline'
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  routines[key].enabled ? 'translate-x-5' : ''
                }`} />
              </button>
              <span className="text-sm text-ink flex-1 min-w-[180px]">{ROUTINE_LABEL[key]}</span>
              <input
                type="time"
                value={routines[key].time}
                onChange={(e) => setRoutines({ ...routines, [key]: { ...routines[key], time: e.target.value } })}
                disabled={!routines[key].enabled}
                className="input w-28"
              />
            </div>
          ))}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {saveMsg && <p className="text-sm text-ink">{saveMsg}</p>}
        <button type="submit" disabled={saving || !configLoaded} className="btn-primary self-start">
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
      </form>
    </div>
  )
}

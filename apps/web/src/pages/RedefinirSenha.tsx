import { FormEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function RedefinirSenha() {
  const navigate = useNavigate()
  const [checking, setChecking] = useState(true)
  const [ready, setReady] = useState(false)
  const [senha, setSenha] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    let active = true

    // O link do e-mail estabelece uma sessão de recuperação ao carregar a página
    // (detectSessionInUrl, padrão do supabase-js). Pode chegar via evento
    // PASSWORD_RECOVERY ou já estar na sessão quando montamos.
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      if (data.session) setReady(true)
      setChecking(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) setReady(true)
      setChecking(false)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    if (senha.length < 6) {
      setErro('A senha precisa ter ao menos 6 caracteres.')
      return
    }
    if (senha !== confirmar) {
      setErro('As senhas não coincidem.')
      return
    }
    setSalvando(true)
    const { error } = await supabase.auth.updateUser({ password: senha })
    if (error) {
      setErro(error.message)
      setSalvando(false)
      return
    }
    navigate('/')
  }

  return (
    <div className="min-h-screen bg-[var(--color-canvas)] flex items-center justify-center px-4">
      <div className="card max-w-sm w-full">
        <div className="flex flex-col items-center mb-6">
          <div className="w-10 h-10 rounded-xl bg-brand-600 grid place-items-center text-xl mb-3">
            ⚡
          </div>
          <h1 className="text-xl font-bold text-ink text-center">Definir nova senha</h1>
        </div>

        {checking ? (
          <p className="text-sm text-muted text-center">Verificando o link…</p>
        ) : ready ? (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="nova" className="text-sm font-medium text-ink">
                Nova senha
              </label>
              <input
                id="nova"
                type="password"
                autoComplete="new-password"
                required
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                className="input"
                placeholder="••••••••"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="confirmar" className="text-sm font-medium text-ink">
                Confirmar senha
              </label>
              <input
                id="confirmar"
                type="password"
                autoComplete="new-password"
                required
                value={confirmar}
                onChange={(e) => setConfirmar(e.target.value)}
                className="input"
                placeholder="••••••••"
              />
            </div>

            {erro && <p className="text-sm text-red-600 text-center">{erro}</p>}

            <button type="submit" disabled={salvando} className="btn-primary w-full mt-1">
              {salvando ? 'Salvando…' : 'Salvar nova senha'}
            </button>
          </form>
        ) : (
          <div className="flex flex-col gap-4 text-center">
            <p className="text-sm text-muted">
              Link inválido ou expirado. Solicite um novo link de redefinição.
            </p>
            <button onClick={() => navigate('/login')} className="btn-primary w-full">
              Voltar ao login
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

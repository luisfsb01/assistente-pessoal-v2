import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type View = 'entrar' | 'esqueci'

export default function Login() {
  const navigate = useNavigate()
  const [view, setView] = useState<View>('entrar')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    setEnviando(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })

    if (error) {
      setErro('E-mail ou senha incorretos.')
      setEnviando(false)
      return
    }

    navigate('/')
  }

  async function handleReset(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    setInfo(null)
    setEnviando(true)

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    })

    setEnviando(false)
    if (error) {
      setErro('Não foi possível enviar agora. Tente novamente.')
      return
    }
    setInfo('Se o e-mail estiver cadastrado, enviamos um link para redefinir a senha.')
  }

  function goEsqueci() {
    setErro(null)
    setInfo(null)
    setView('esqueci')
  }

  function goEntrar() {
    setErro(null)
    setInfo(null)
    setView('entrar')
  }

  return (
    <div className="min-h-screen bg-[var(--color-canvas)] flex items-center justify-center px-4">
      <div className="card max-w-sm w-full">
        <div className="flex flex-col items-center mb-6">
          <div className="w-10 h-10 rounded-xl bg-brand-600 grid place-items-center text-xl mb-3">
            ⚡
          </div>
          <h1 className="text-xl font-bold text-ink text-center">
            Assistente da Família
          </h1>
          <p className="text-sm text-muted mt-1">
            {view === 'entrar' ? 'Entre para continuar' : 'Recuperar acesso'}
          </p>
        </div>

        {view === 'entrar' ? (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="email" className="text-sm font-medium text-ink">
                E-mail
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="seu@email.com"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="senha" className="text-sm font-medium text-ink">
                Senha
              </label>
              <input
                id="senha"
                type="password"
                autoComplete="current-password"
                required
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                className="input"
                placeholder="••••••••"
              />
            </div>

            {erro && <p className="text-sm text-red-600 text-center">{erro}</p>}

            <button type="submit" disabled={enviando} className="btn-primary w-full mt-1">
              {enviando ? 'Entrando…' : 'Entrar'}
            </button>

            <button
              type="button"
              onClick={goEsqueci}
              className="text-sm text-accent-soft-ink hover:underline text-center"
            >
              Esqueci minha senha
            </button>

            <div className="border-t border-hairline pt-3 flex flex-col items-center gap-1">
              <button
                type="button"
                disabled
                className="btn-ghost w-full opacity-50 cursor-not-allowed"
                title="Em breve"
              >
                Criar conta
              </button>
              <span className="text-xs text-muted">Em breve</span>
            </div>
          </form>
        ) : (
          <form onSubmit={handleReset} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="email-reset" className="text-sm font-medium text-ink">
                E-mail
              </label>
              <input
                id="email-reset"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="seu@email.com"
              />
            </div>

            {erro && <p className="text-sm text-red-600 text-center">{erro}</p>}
            {info && <p className="text-sm text-accent-soft-ink text-center">{info}</p>}

            <button type="submit" disabled={enviando} className="btn-primary w-full mt-1">
              {enviando ? 'Enviando…' : 'Enviar link de redefinição'}
            </button>

            <button
              type="button"
              onClick={goEntrar}
              className="text-sm text-muted hover:text-ink text-center"
            >
              Voltar ao login
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

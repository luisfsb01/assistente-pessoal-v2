import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Login from './pages/Login'
import RedefinirSenha from './pages/RedefinirSenha'
import Dashboard from './pages/Dashboard'
import Tarefas from './pages/Tarefas'
import Compras from './pages/Compras'
import Habitos from './pages/Habitos'
import Categorias from './pages/Categorias'
import Configuracoes from './pages/Configuracoes'
import Compromissos from './pages/Compromissos'
import Transacoes from './pages/Transacoes'
import Objetivos from './pages/Objetivos'
import { useSession } from './lib/useSession'

export default function App() {
  const { session, loading } = useSession()

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-canvas)] flex items-center justify-center">
        <span className="text-sm text-[var(--color-muted)]">Carregando…</span>
      </div>
    )
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={session ? <Navigate to="/" replace /> : <Login />}
      />

      {/* Rota pública: o link de recuperação de senha abre aqui mesmo com
          sessão ativa (não redireciona, senão a sessão de recuperação levaria
          o usuário ao painel antes de trocar a senha). */}
      <Route path="/redefinir-senha" element={<RedefinirSenha />} />

      <Route
        element={session ? <Layout /> : <Navigate to="/login" replace />}
      >
        <Route index element={<Dashboard />} />
        <Route path="/tarefas" element={<Tarefas />} />
        <Route path="/compras" element={<Compras />} />
        <Route path="/habitos" element={<Habitos />} />
        <Route path="/transacoes" element={<Transacoes />} />
        <Route path="/categorias" element={<Categorias />} />
        <Route path="/objetivos" element={<Objetivos />} />
        <Route path="/compromissos" element={<Compromissos />} />
        <Route path="/configuracoes" element={<Configuracoes />} />
      </Route>
    </Routes>
  )
}

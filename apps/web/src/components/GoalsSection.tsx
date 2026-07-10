import { Link } from 'react-router-dom'
import { useGoals } from '../lib/useGoals'
import GoalCard from './GoalCard'

export default function GoalsSection() {
  const { goals, loading, error } = useGoals()

  return (
    <section className="mt-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-lg text-ink">Meus objetivos</h2>
        <Link to="/objetivos" className="text-sm text-brand-600 hover:underline">
          Gerenciar →
        </Link>
      </div>

      {/* Body */}
      {loading ? (
        <p className="text-muted">Carregando…</p>
      ) : error ? (
        <p className="text-red-600">{error}</p>
      ) : goals.length === 0 ? (
        <div className="card text-muted">Nenhum objetivo ainda. Crie o primeiro!</div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {goals.map((goal) => (
            <GoalCard key={goal.id} goal={goal} readOnly />
          ))}
        </div>
      )}
    </section>
  )
}

export const PAGE_SIZE = 1000

type PageResult<T> = { data: T[] | null; error: { message: string } | null }

/**
 * Busca todas as páginas de uma query PostgREST — que corta em 1000 linhas por
 * padrão. Chama fetchPage(from, to) com janelas de PAGE_SIZE até vir página
 * curta. Retorna todas as linhas, ou o primeiro erro (com rows vazio).
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await fetchPage(offset, offset + PAGE_SIZE - 1)
    if (error) return { rows: [], error: error.message }
    const pageRows = data ?? []
    rows.push(...pageRows)
    if (pageRows.length < PAGE_SIZE) return { rows, error: null }
  }
}

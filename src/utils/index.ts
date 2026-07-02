export function formatDate(iso: string): string {
  if (!iso) return '--'
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  })
}

export function statusLabel(s: string): string {
  const map: Record<string, string> = {
    pending: '待执行', in_progress: '执行中', completed: '已完成'
  }
  return map[s] || s
}

const API_BASE = '/api'

export async function api<T = any>(path: string, options?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (e) {
    console.warn('API error:', e)
    return null
  }
}

import { onMounted, onUnmounted } from 'vue'

export function useWebSocket() {
  let ws: WebSocket | null = null

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/ws`)
    ws.onmessage = (e) => {
      try { JSON.parse(e.data) } catch { /* ignore */ }
    }
    ws.onclose = () => setTimeout(connect, 3000)
    ws.onerror = () => ws?.close()
  }

  onMounted(connect)
  onUnmounted(() => ws?.close())
}

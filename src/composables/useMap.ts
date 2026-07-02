import { ref, type Ref } from 'vue'

export interface MapMarker {
  id: string; lng: number; lat: number
  type: 'checkpoint' | 'risk' | 'station' | 'patrol'
  label: string; riskLevel?: string
}

export function useMap(containerRef: Ref<HTMLElement | null>) {
  const mapLoaded = ref(false)
  let map: any = null

  function initMap(center: [number, number], zoom = 14) {
    const AMap = (window as any).AMap
    if (!AMap || !containerRef.value) return
    map = new AMap.Map(containerRef.value, {
      zoom, center, viewMode: '2D', mapStyle: 'amap://styles/darkblue'
    })
    mapLoaded.value = true
  }

  function setMarkers(markers: MapMarker[]) {
    if (!map) return
    const AMap = (window as any).AMap
    const colors: Record<string, string> = {
      checkpoint: '#00d4ff', risk: '#ff4757', station: '#00ff88', patrol: '#ffa502'
    }
    markers.forEach(m => {
      new AMap.Marker({
        position: [m.lng, m.lat],
        content: `<div style="text-align:center"><div style="width:10px;height:10px;border-radius:50%;background:${colors[m.type]};margin:0 auto;box-shadow:0 0 8px ${colors[m.type]}"></div><span style="font-size:10px;background:rgba(0,0,0,0.7);padding:2px 6px;border-radius:4px;color:#fff;white-space:nowrap">${m.label}</span></div>`,
        offset: new AMap.Pixel(-20, -20)
      }).setMap(map)
    })
  }

  function drawRoute(opts: { path: [number, number][]; color?: string }) {
    if (!map) return
    const AMap = (window as any).AMap
    new AMap.Polyline({
      path: opts.path, strokeColor: opts.color || '#00d4ff',
      strokeWeight: 4, strokeOpacity: 0.7, strokeStyle: 'dashed', showDir: true
    }).setMap(map)
  }

  async function locateUser(): Promise<void> {
    const AMap = (window as any).AMap
    if (!AMap || !map) return
    return new Promise((resolve, reject) => {
      AMap.plugin('AMap.Geolocation', () => {
        const geo = new AMap.Geolocation({ enableHighAccuracy: true, timeout: 10000 })
        geo.getCurrentPosition((status: string, result: any) => {
          if (status === 'complete' && result.position) {
            map.setCenter([result.position.lng, result.position.lat])
            resolve()
          } else { reject(new Error('location failed')) }
        })
      })
    })
  }

  return { mapLoaded, initMap, setMarkers, drawRoute, locateUser }
}

<template>
  <div class="map-full-page">
    <van-nav-bar title="全屏地图" left-arrow fixed placeholder @click-left="$router.back()" />
    <div class="map-full-wrapper" ref="mapRef"></div>

    <div class="map-full-legend">
      <div class="legend-item"><span class="legend-dot" style="background:#00d4ff"></span>检查点</div>
      <div class="legend-item"><span class="legend-dot" style="background:#ff4757"></span>风险点</div>
      <div class="legend-item"><span class="legend-dot" style="background:#00ff88"></span>监测站</div>
      <div class="legend-item"><span class="legend-dot" style="background:#ffa502"></span>巡查员</div>
    </div>

    <button class="map-full-locate" @click="handleLocate">
      <van-icon name="aim" size="20" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const mapRef = ref<HTMLElement | null>(null)
let mapInstance: any = null

function handleLocate() {
  if (!mapInstance) return
  const AMap = (window as any).AMap
  if (!AMap) return
  AMap.plugin('AMap.Geolocation', () => {
    const geolocation = new AMap.Geolocation({ enableHighAccuracy: true, timeout: 10000 })
    geolocation.getCurrentPosition((status: string, result: any) => {
      if (status === 'complete') {
        mapInstance.setCenter([result.position.lng, result.position.lat])
      }
    })
  })
}

onMounted(() => {
  const centerLng = parseFloat(route.query.lng as string) || 114.315
  const centerLat = parseFloat(route.query.lat as string) || 30.607

  if (!(window as any).AMap) {
    const script = document.createElement('script')
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${import.meta.env.VITE_AMAP_KEY || 'YOUR_KEY'}`
    script.onload = () => initMap(centerLng, centerLat)
    document.head.appendChild(script)
  } else {
    initMap(centerLng, centerLat)
  }
})

function initMap(lng: number, lat: number) {
  const AMap = (window as any).AMap
  if (!AMap || !mapRef.value) return
  mapInstance = new AMap.Map(mapRef.value, {
    zoom: 15,
    center: [lng, lat],
    viewMode: '2D',
    mapStyle: 'amap://styles/darkblue'
  })

  const markers = [
    { pos: [114.312, 30.605], label: '坝顶检查点A', color: '#00d4ff' },
    { pos: [114.315, 30.607], label: '渗流异常区', color: '#ff4757' },
    { pos: [114.318, 30.608], label: '背水坡监测站', color: '#00ff88' },
    { pos: [114.320, 30.610], label: '排水口检查点', color: '#00d4ff' },
    { pos: [114.324, 30.612], label: '位移监测站', color: '#00ff88' },
    { pos: [114.310, 30.603], label: '巡堤员A', color: '#ffa502' }
  ]

  markers.forEach(m => {
    new AMap.Marker({
      position: m.pos,
      content: `<div style="text-align:center;font-size:20px">
        <div style="width:10px;height:10px;border-radius:50%;background:${m.color};margin:0 auto;box-shadow:0 0 8px ${m.color}"></div>
        <span style="font-size:10px;background:rgba(0,0,0,0.7);padding:2px 6px;border-radius:4px;color:#fff;white-space:nowrap">${m.label}</span>
      </div>`,
      offset: new AMap.Pixel(-20, -20)
    }).setMap(mapInstance)
  })

  new AMap.Polyline({
    path: [[114.312, 30.605], [114.315, 30.607], [114.318, 30.608], [114.324, 30.612]],
    strokeColor: '#00d4ff',
    strokeWeight: 4,
    strokeOpacity: 0.7,
    strokeStyle: 'dashed',
    showDir: true
  }).setMap(mapInstance)
}
</script>

<style scoped>
.map-full-page { position: relative; width: 100%; height: 100vh; overflow: hidden; background: #0a0e17; }
.map-full-wrapper { width: 100%; height: calc(100vh - 46px); }

.map-full-legend {
  position: fixed; top: 58px; right: 12px;
  display: flex; flex-direction: column; gap: 6px;
  padding: 10px; background: rgba(10, 14, 23, 0.9);
  border-radius: 8px; border: 1px solid var(--border); z-index: 10;
}
.legend-item { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-secondary); }
.legend-dot { width: 8px; height: 8px; border-radius: 50%; }

.map-full-locate {
  position: fixed; bottom: 24px; right: 16px;
  width: 44px; height: 44px; border-radius: 22px;
  background: var(--bg-card); border: 1px solid var(--border-active);
  color: var(--primary);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; z-index: 10; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}
.map-full-locate:active { background: rgba(0,212,255,0.1); }
</style>

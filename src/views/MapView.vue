<!--
 * @Author: 刘杰 2689450490@qq.com
 * @Date: 2026-06-30 14:12:02
 * @LastEditors: 刘杰 2689450490@qq.com
 * @LastEditTime: 2026-06-30 14:12:05
 * @FilePath: \demo\frontend\src\views\MapView.vue
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
-->
<template>
  <div class="map-page">
    <div class="map-wrapper" ref="mapRef"></div>
    <div class="map-legend">
      <div class="legend-item"><span class="legend-dot" style="background:#00d4ff"></span>检查点</div>
      <div class="legend-item"><span class="legend-dot" style="background:#ff4757"></span>风险点</div>
      <div class="legend-item"><span class="legend-dot" style="background:#00ff88"></span>监测站</div>
    </div>
    <button class="map-locate" @click="handleLocate"><van-icon name="aim" size="20" /></button>
    <van-tabbar v-model="activeTab" route>
      <van-tabbar-item icon="home-o" to="/">首页</van-tabbar-item>
      <van-tabbar-item to="/ar"><template #icon><span class="tab-ar-icon">AR</span></template>AR巡查</van-tabbar-item>
      <van-tabbar-item icon="map-o" to="/map">地图</van-tabbar-item>
      <van-tabbar-item icon="todo-list-o" to="/records">记录</van-tabbar-item>
      <van-tabbar-item icon="user-o" to="/profile">我的</van-tabbar-item>
    </van-tabbar>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useMap } from '@/composables/useMap'
import type { MapMarker } from '@/composables/useMap'

const route = useRoute()
const activeTab = ref(2)
const mapRef = ref<HTMLElement | null>(null)
const { mapLoaded, initMap, setMarkers, drawRoute, locateUser } = useMap(mapRef)

function handleLocate() { locateUser().catch(() => {}) }

onMounted(() => {
  const centerLng = parseFloat(route.query.lng as string) || 114.31
  const centerLat = parseFloat(route.query.lat as string) || 30.60
  if (!(window as any).AMap) {
    const script = document.createElement('script')
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${import.meta.env.VITE_AMAP_KEY || ''}`
    script.onload = () => setupMap(centerLng, centerLat)
    document.head.appendChild(script)
  } else { setupMap(centerLng, centerLat) }
})

function setupMap(lng: number, lat: number) {
  initMap([lng, lat], 14)
  const timer = setInterval(() => {
    if (mapLoaded.value) {
      clearInterval(timer)
      const markers: MapMarker[] = [
        { id: 'm1', lng: 114.312, lat: 30.605, type: 'checkpoint', label: '坝顶检查点A' },
        { id: 'm2', lng: 114.318, lat: 30.608, type: 'checkpoint', label: '背水坡监测站' },
        { id: 'm3', lng: 114.315, lat: 30.607, type: 'risk', label: '渗流异常', riskLevel: 'high' },
        { id: 'm4', lng: 114.348, lat: 30.582, type: 'risk', label: '裂缝标记', riskLevel: 'medium' },
        { id: 'm5', lng: 114.290, lat: 30.620, type: 'station', label: '水位监测站1' },
        { id: 'm6', lng: 114.355, lat: 30.575, type: 'station', label: '位移监测站2' },
        { id: 'm7', lng: 114.300, lat: 30.615, type: 'patrol', label: '巡堤员A' }
      ]
      setMarkers(markers)
      drawRoute({ path: [[114.312,30.605],[114.315,30.607],[114.318,30.608],[114.324,30.610]], color: '#00d4ff' })
    }
  }, 100)
}
</script>

<style scoped>
.map-page { position: relative; width: 100%; height: 100vh; overflow: hidden; background: #0a0e17; }
.map-wrapper { width: 100%; height: 100%; }
.map-legend { position: fixed; top: 12px; right: 12px; display: flex; flex-direction: column; gap: 6px; padding: 10px; background: rgba(10,14,23,0.9); border-radius: 8px; border: 1px solid var(--border); z-index: 10; }
.legend-item { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-secondary); }
.legend-dot { width: 8px; height: 8px; border-radius: 50%; }
.map-locate { position: fixed; bottom: 90px; right: 16px; width: 40px; height: 40px; border-radius: 20px; background: var(--bg-card); border: 1px solid var(--border-active); color: var(--primary); display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 10; }
.tab-ar-icon { display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; line-height: 1; color: var(--primary); border: 1.5px solid var(--primary); border-radius: 4px; padding: 1px 3px; }
</style>

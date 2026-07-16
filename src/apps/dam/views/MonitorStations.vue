<template>
  <div class="page">
    <van-nav-bar title="监测点位" left-arrow fixed placeholder @click-left="$router.back()" />
    <div class="section">
      <h3 class="section-title">实时监测点</h3>
      <div class="station-list">
        <div class="station-item card" v-for="s in stations" :key="s.id">
          <span class="si-dot" :class="s.status"></span>
          <div class="si-body"><span class="si-name">{{ s.name }}</span><span class="si-loc">{{ s.loc }}</span></div>
          <div class="si-val" :style="{ color: s.status === 'warn' ? '#ff4757' : '#00d4ff' }">{{ s.value }}<small>{{ s.unit }}</small></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
const stations = ref([
  { id: 1, name: 'PZ-12 渗压监测', loc: 'K12+400', value: 21.35, unit: 'm', status: 'warn' },
  { id: 2, name: 'PZ-14 渗压监测', loc: 'K12+420', value: 15, unit: 'L/min', status: 'warn' },
  { id: 3, name: 'D-03 位移监测', loc: 'K12+380', value: 2.8, unit: 'mm', status: 'normal' },
  { id: 4, name: 'F-01 裂缝监测', loc: 'K12+400', value: 0, unit: 'mm', status: 'normal' },
  { id: 5, name: 'WL-01 水位监测', loc: 'K12+500', value: 21.2, unit: 'm', status: 'normal' },
  { id: 6, name: 'WL-02 水位监测', loc: 'K12+600', value: 21.4, unit: 'm', status: 'normal' }
])
</script>

<style scoped>
.station-list { display: flex; flex-direction: column; gap: 8px; }
.station-item { display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
.si-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.si-dot.normal { background: #00ff88; }
.si-dot.warn { background: #ff4757; box-shadow: 0 0 6px rgba(255,71,87,0.4); }
.si-body { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.si-name { font-size: 14px; font-weight: 500; }
.si-loc { font-size: 11px; color: var(--text-muted); }
.si-val { font-size: 18px; font-weight: 700; font-family: 'SF Mono', monospace; }
.si-val small { font-size: 11px; font-weight: 400; color: var(--text-muted); margin-left: 2px; }
</style>

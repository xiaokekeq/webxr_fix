<template>
  <div class="page">
    <van-nav-bar title="风险监测" left-arrow fixed placeholder @click-left="$router.back()" />
    <div class="monitor-grid">
      <div class="monitor-card card card-glow" v-for="m in monitors" :key="m.id">
        <div class="mc-head"><span class="mc-label">{{ m.name }}</span><span class="mc-status" :class="m.status">{{ m.status === 'normal' ? '正常' : '预警' }}</span></div>
        <div class="mc-value" :style="{ color: m.status === 'warn' ? '#ff4757' : '#00d4ff' }">{{ m.value }}<small>{{ m.unit }}</small></div>
        <div class="mc-trend">{{ m.trend }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">import { ref } from 'vue'
const monitors = ref([
  { id: 1, name: '水位', value: 21.35, unit: 'm', status: 'normal', trend: '↗ +0.02' },
  { id: 2, name: '渗流量', value: 15, unit: 'L/min', status: 'warn', trend: '↗ +2.1' },
  { id: 3, name: '位移', value: 2.8, unit: 'mm', status: 'normal', trend: '→ 0' },
  { id: 4, name: '裂缝', value: 0, unit: 'mm', status: 'normal', trend: '→ 0' },
  { id: 5, name: '渗压', value: 0.45, unit: 'MPa', status: 'normal', trend: '↗ +0.01' },
  { id: 6, name: '雨量', value: 0, unit: 'mm/h', status: 'normal', trend: '→ 0' }
])
</script>

<style scoped>
.monitor-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.monitor-card { padding: 14px; }
.mc-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.mc-label { font-size: 12px; color: var(--text-secondary); }
.mc-status { font-size: 10px; padding: 1px 8px; border-radius: 8px; font-weight: 600; }
.mc-status.normal { background: rgba(0,255,136,0.12); color: #00ff88; }
.mc-status.warn { background: rgba(255,71,87,0.12); color: #ff4757; }
.mc-value { font-size: 28px; font-weight: 700; font-family: 'SF Mono', monospace; }
.mc-value small { font-size: 12px; font-weight: 400; color: var(--text-muted); margin-left: 2px; }
.mc-trend { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
</style>

<template>
  <div class="page">
    <van-nav-bar title="应急物资" left-arrow fixed placeholder @click-left="$router.back()" />
    <div class="supply-list">
      <div class="supply-item card" v-for="s in supplies" :key="s.id">
        <span class="supply-icon">{{ s.icon }}</span>
        <div class="supply-body"><span class="supply-name">{{ s.name }}</span><span class="supply-stock">库存 {{ s.stock }}</span></div>
        <span class="supply-status" :class="s.status">{{ s.status === 'normal' ? '充足' : '不足' }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">import { ref } from 'vue'
const supplies = ref([
  { id: 1, icon: '🦺', name: '救生衣', stock: 50, status: 'normal' },
  { id: 2, icon: '🪣', name: '编织袋', stock: 2000, status: 'normal' },
  { id: 3, icon: '🔦', name: '应急灯', stock: 8, status: 'low' },
  { id: 4, icon: '⛏️', name: '铁锹', stock: 30, status: 'normal' },
  { id: 5, icon: '🪨', name: '块石', stock: 500, unit: '方', status: 'normal' },
  { id: 6, icon: '📡', name: '对讲机', stock: 5, status: 'low' }
])
</script>

<style scoped>
.supply-list { display: flex; flex-direction: column; gap: 8px; }
.supply-item { display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
.supply-icon { font-size: 28px; }
.supply-body { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.supply-name { font-size: 14px; font-weight: 500; }
.supply-stock { font-size: 11px; color: var(--text-muted); }
.supply-status { font-size: 11px; font-weight: 600; padding: 2px 10px; border-radius: 10px; }
.supply-status.normal { background: rgba(0,255,136,0.12); color: #00ff88; }
.supply-status.low { background: rgba(255,71,87,0.12); color: #ff4757; }
</style>

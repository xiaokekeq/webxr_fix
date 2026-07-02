<template>
  <div class="page">
    <van-nav-bar title="全部提醒" left-arrow fixed placeholder @click-left="$router.back()" />
    <div class="reminder-list">
      <div class="reminder-item card" v-for="r in reminders" :key="r.id" @click="r.done=!r.done" :class="{ done: r.done }">
        <span class="ri-dot" :class="r.type"></span>
        <span class="ri-text">{{ r.content }}</span>
        <van-icon v-if="r.done" name="success" color="#00ff88" size="18" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">import { ref } from 'vue'
const reminders = ref([
  { id: 1, content: 'PZ-12 渗流异常需核查', type: 'risk', done: false },
  { id: 2, content: '巡检二班交接登记', type: 'shift', done: false },
  { id: 3, content: '应急物资盘点检查', type: 'supply', done: false },
  { id: 4, content: '今日巡查任务已超时', type: 'patrol', done: false }
])
</script>

<style scoped>
.reminder-list { display: flex; flex-direction: column; gap: 8px; }
.reminder-item { display: flex; align-items: center; gap: 10px; padding: 14px 16px; cursor: pointer; }
.reminder-item.done { opacity: 0.4; }
.reminder-item.done .ri-text { text-decoration: line-through; }
.ri-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.ri-dot.risk { background: var(--danger); }
.ri-dot.patrol { background: var(--primary); }
.ri-dot.shift { background: var(--warning); }
.ri-dot.supply { background: var(--accent); }
.ri-text { flex: 1; font-size: 13px; }
</style>

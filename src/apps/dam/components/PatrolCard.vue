<template>
  <div class="patrol-card" @click="$emit('click', task)">
    <div class="pc-header">
      <span class="pc-status" :class="task.status">{{ statusLabel(task.status) }}</span>
      <span class="pc-risk tag" :class="`tag-${task.riskLevel}`">
        {{ task.riskLevel === 'high' ? '高风险' : task.riskLevel === 'medium' ? '中风险' : '低风险' }}
      </span>
    </div>
    <div class="pc-body">
      <h4 class="pc-title">{{ task.title }}</h4>
      <p class="pc-section">📍 {{ task.section }}</p>
      <div class="pc-progress" v-if="task.checkpoints?.length">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: `${checkProgress}%` }"></div>
        </div>
        <span class="progress-text">{{ checkedCount }}/{{ task.checkpoints.length }}</span>
      </div>
    </div>
    <div class="pc-footer">
      <span class="pc-assignee">👤 {{ task.team || '--' }}</span>
      <span class="pc-time">{{ formatDate(task.startTime) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { PatrolTask } from '../stores/app.js'
import { formatDate, statusLabel } from '@/utils'

const props = defineProps<{ task: PatrolTask }>()
defineEmits<{ click: [task: PatrolTask] }>()

const checkedCount = computed(() => props.task.checkpoints?.filter(c => c.checked).length ?? 0)
const checkProgress = computed(() =>
  props.task.checkpoints?.length ? Math.round((checkedCount.value / props.task.checkpoints.length) * 100) : 0
)
</script>

<style scoped>
.patrol-card {
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 16px; cursor: pointer; transition: all 0.3s;
}
.patrol-card:active { transform: scale(0.98); }
.pc-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.pc-status { padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; }
.pc-status.pending { background: rgba(136,153,170,0.15); color: var(--text-secondary); }
.pc-status.in_progress { background: rgba(0,212,255,0.15); color: var(--primary); }
.pc-status.completed { background: rgba(0,255,136,0.15); color: var(--accent); }
.pc-title { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
.pc-section { font-size: 12px; color: var(--text-secondary); margin-bottom: 10px; }
.pc-progress { display: flex; align-items: center; gap: 10px; }
.progress-bar { flex: 1; height: 4px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, var(--primary-dark), var(--primary)); border-radius: 2px; }
.progress-text { font-size: 11px; color: var(--text-muted); min-width: 36px; text-align: right; }
.pc-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
.pc-assignee { font-size: 12px; color: var(--text-secondary); }
.pc-time { font-size: 11px; color: var(--text-muted); }
</style>

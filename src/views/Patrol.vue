<template>
  <div class="page">
    <van-nav-bar title="巡堤任务" left-arrow fixed placeholder @click-left="$router.back()" />
    <div class="patrol-filter">
      <van-tabs v-model:active="filterStatus" sticky>
        <van-tab title="全部" name="all" />
        <van-tab title="待执行" name="pending" />
        <van-tab title="执行中" name="in_progress" />
        <van-tab title="已完成" name="completed" />
      </van-tabs>
    </div>
    <div class="patrol-list">
      <PatrolCard v-for="task in filteredTasks" :key="task.id" :task="task" @click="goDetail(task.id)" />
      <van-empty v-if="filteredTasks.length === 0" description="暂无任务" :image-size="80" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { api } from '@/utils'
import PatrolCard from '@/components/PatrolCard.vue'

const store = useAppStore()
const router = useRouter()
const filterStatus = ref('all')

const filteredTasks = computed(() => {
  if (filterStatus.value === 'all') return store.patrolTasks
  return store.patrolTasks.filter(t => t.status === filterStatus.value)
})

function goDetail(id: string) { router.push(`/patrol/${id}`) }

onMounted(async () => {
  try {
    const tasks = await api<any[]>('/tasks')
    if (tasks?.length) store.setPatrolTasks(tasks)
  } catch { /* use mock */ }
})
</script>

<style scoped>
.patrol-filter { margin-bottom: 12px; }
.patrol-list { display: flex; flex-direction: column; gap: 10px; }
</style>

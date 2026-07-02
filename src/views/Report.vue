<template>
  <div class="page">
    <van-nav-bar title="统计分析" left-arrow fixed placeholder @click-left="$router.back()" />
    <div class="stats-grid">
      <div class="stat-item card-glow" v-for="s in summary" :key="s.label">
        <div class="stat-num font-mono" :style="{ color: s.color }">{{ s.value }}</div>
        <div class="stat-desc">{{ s.label }}</div>
      </div>
    </div>
    <div class="card card-glow chart-container">
      <div class="chart-title">周巡检完成趋势</div>
      <div ref="chartRef" class="chart-canvas"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import * as echarts from 'echarts'
const chartRef = ref<HTMLElement | null>(null)
const summary = [
  { label: '本月巡检任务', value: '47', color: '#00d4ff' },
  { label: '完成率', value: '93.6%', color: '#00ff88' },
  { label: '发现隐患', value: '12', color: '#ffa502' },
  { label: '已处理', value: '9', color: '#8899aa' },
  { label: '待处理', value: '3', color: '#ff4757' }
]
onMounted(() => {
  if (!chartRef.value) return
  const c = echarts.init(chartRef.value, 'dark')
  c.setOption({
    backgroundColor: 'transparent', textStyle: { color: '#8899aa' },
    grid: { top: 8, right: 8, bottom: 20, left: 36 },
    xAxis: { type: 'category', data: ['6/23','6/24','6/25','6/26','6/27','6/28','6/29'], axisLine: { lineStyle: { color: '#334466' } } },
    yAxis: { type: 'value', axisLine: { lineStyle: { color: '#334466' } } },
    series: [
      { type: 'bar', data: [3,4,3,5,4,3,4], itemStyle: { color: '#00d4ff', borderRadius: 4 }, barWidth: 12 },
      { type: 'bar', data: [3,4,2,5,4,3,3], itemStyle: { color: '#00ff88', borderRadius: 4 }, barWidth: 12 }
    ]
  })
})
</script>

<style scoped>
.stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 14px; }
.stat-item { padding: 12px; text-align: center; border-radius: 10px; }
.stat-num { font-size: 22px; font-weight: 700; }
.stat-desc { font-size: 10px; color: var(--text-muted); margin-top: 4px; }
.chart-container { padding: 14px; margin-bottom: 12px; }
.chart-title { font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; }
.chart-canvas { width: 100%; height: 200px; }
</style>

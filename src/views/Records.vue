<template>
  <div class="page">
    <van-nav-bar title="记录汇总" fixed placeholder />

    <div class="record-cards">
      <div class="record-card card-glow" @click="$router.push('/records/patrol')">
        <span class="rc-icon">📋</span>
        <span class="rc-label">巡查记录</span>
        <span class="rc-count">32条</span>
        <van-icon name="arrow" />
      </div>
      <div class="record-card card-glow" @click="$router.push('/records/history')">
        <span class="rc-icon">⚠️</span>
        <span class="rc-label">历史险情</span>
        <span class="rc-count">47条</span>
        <van-icon name="arrow" />
      </div>
      <div class="record-card card-glow" @click="$router.push('/shift')">
        <span class="rc-icon">🔄</span>
        <span class="rc-label">交接班记录</span>
        <span class="rc-count">8条</span>
        <van-icon name="arrow" />
      </div>
      <div class="record-card card-glow" @click="$router.push('/supplies')">
        <span class="rc-icon">📦</span>
        <span class="rc-label">物资检查记录</span>
        <span class="rc-count">12条</span>
        <van-icon name="arrow" />
      </div>
    </div>

    <van-tabbar v-model="activeTab" route>
      <van-tabbar-item icon="home-o" to="/">首页</van-tabbar-item>
      <van-tabbar-item to="/ar">
        <template #icon><span class="tab-ar-icon">AR</span></template>
        AR巡查
      </van-tabbar-item>
      <van-tabbar-item icon="map-o" to="/map">地图</van-tabbar-item>
      <van-tabbar-item icon="todo-list-o" to="/records">记录</van-tabbar-item>
      <van-tabbar-item icon="user-o" to="/profile">我的</van-tabbar-item>
    </van-tabbar>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
const activeTab = ref(3)
</script>

<style scoped>
.record-cards { display: flex; flex-direction: column; gap: 10px; }
.record-card { display: flex; align-items: center; gap: 12px; padding: 16px; cursor: pointer; }
.rc-icon { font-size: 28px; }
.rc-label { flex: 1; font-size: 15px; font-weight: 500; }
.rc-count { font-size: 13px; color: var(--text-muted); }

.tab-ar-icon { display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; line-height: 1; color: var(--primary); border: 1.5px solid var(--primary); border-radius: 4px; padding: 1px 3px; }
</style>

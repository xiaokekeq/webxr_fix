<template>
  <div class="home-page">
    <!-- ===== 顶部标题栏 ===== -->
    <div class="top-bar">
      <div class="top-bar-left">
        <span class="top-icon">🏗️</span>
        <span class="top-title">巡堤AR</span>
        <span class="top-dam-select" @click="showDamPicker = true">
          {{ store.currentDam.name }}
          <van-icon name="arrow-down" size="10" />
        </span>
      </div>
      <div class="top-bar-right">
        <div class="weather-info">
          <span class="weather-icon">{{ store.weather.icon }}</span>
          <span class="weather-desc">{{ store.weather.desc }}</span>
          <span class="weather-temp">{{ store.weather.temp }}°C</span>
        </div>
        <div class="water-info" :class="{ danger: store.isWaterOverWarning }">
          <van-icon name="orders-o" size="14" />
          <span class="water-val">{{ store.waterLevel }}m</span>
          <span
            class="water-tag"
            :class="store.isWaterOverWarning ? 'tag-high' : 'tag-low'"
          >
            {{ store.isWaterOverWarning ? "超警戒" : "安全" }}
          </span>
        </div>
      </div>
    </div>

    <!-- 堤坝下拉 -->
    <van-popup
      v-model:show="showDamPicker"
      position="top"
      :style="{ padding: '12px 0' }"
    >
      <div class="dam-picker">
        <div
          v-for="dam in store.damSections"
          :key="dam.id"
          class="dam-item"
          :class="{ active: dam.id === store.currentDam.id }"
          @click="selectDam(dam)"
        >
          {{ dam.name }}
        </div>
      </div>
    </van-popup>

    <div class="home-scroll">
      <!-- 模块1：今日巡查任务 -->
      <div class="section-card card-glow">
        <div class="section-head">
          <span class="section-dot primary"></span>
          <span class="section-title">今日巡查任务</span>
        </div>
        <div class="task-row" v-if="store.todayTask">
          <div class="task-info">
            <div class="task-field">
              <label>负责堤段</label><span>{{ store.todayTask.section }}</span>
            </div>
            <div class="task-field">
              <label>巡查范围</label>
              <span class="task-field-val">
                <span>{{ store.todayTask.patrolRange }}</span>
                <span
                  class="distance-tag"
                  v-if="store.todayTask.patrolDistance"
                  >{{ store.todayTask.patrolDistance }}</span
                >
              </span>
            </div>
            <div class="task-field">
              <label>任务优先级</label
              ><span
                >{{
                  store.todayTask.priority === "high"
                    ? "高"
                    : store.todayTask.priority === "medium"
                      ? "中"
                      : "低"
                }}风险</span
              >
            </div>
            <div class="task-field">
              <label>计划时间</label
              ><span>{{ store.todayTask.planTime || "--" }}</span>
            </div>
            <div class="task-field">
              <label>巡查班组</label>
              <span class="task-field-val">
                <span
                  >{{ store.todayTask.team || "--" }}（{{
                    store.todayTask.teamCount || 0
                  }}人）</span
                >
                <span
                  class="team-avatars"
                  v-if="store.todayTask.teamAvatars?.length"
                >
                  <span
                    class="team-avatar"
                    v-for="(a, i) in store.todayTask.teamAvatars"
                    :key="i"
                    :style="{ zIndex: store.todayTask.teamAvatars.length - i }"
                    >{{ a }}</span
                  >
                </span>
              </span>
            </div>
            <div
              class="task-detail-link"
              @click="$router.push('/records/patrol')"
            >
              任务详情 <van-icon name="arrow" size="10" />
            </div>
          </div>
          <div class="task-ar-area">
            <div class="ar-anim">
              <div class="ar-ring"></div>
              <div class="ar-ring delay"></div>
              <div class="ar-scan">📷</div>
            </div>
            <button class="ar-btn" @click="$router.push('/ar')">
              开始AR巡查
            </button>
          </div>
        </div>
        <van-empty v-else description="暂无今日任务" :image-size="60" />
      </div>

      <!-- 模块2：风险概览 -->
      <div class="section-card card-glow">
        <div class="section-head">
          <span class="section-dot danger"></span>
          <span class="section-title">风险概览</span>
          <span class="task-detail-link" @click="$router.push('/risks')"
            >全部风险 <van-icon name="arrow" size="10" /></span
          >
        </div>
        <div class="risk-cards">
          <div class="risk-card-entry" @click="$router.push('/risks')">
            <span class="rce-icon" style="color: #00d4ff">📍</span>
            <div class="rce-body">
              <span class="rce-title">固定风险点</span>
              <span class="rce-num" style="color: #00d4ff">{{
                store.riskStats.fixedPoints
              }}</span>
            </div>
          </div>
          <div class="risk-card-entry" @click="$router.push('/risks')">
            <span class="rce-icon" style="color: #ffa502">🔍</span>
            <div class="rce-body">
              <span class="rce-title">待复核</span>
              <span class="rce-num" style="color: #ffa502">{{
                store.riskStats.pendingReview
              }}</span>
            </div>
          </div>
          <div class="risk-card-entry" @click="$router.push('/risks')">
            <span class="rce-icon" style="color: #ff4757">⚠️</span>
            <div class="rce-body">
              <span class="rce-title">监测预警</span>
              <span class="rce-num" style="color: #ff4757">{{
                store.riskStats.monitorAlerts
              }}</span>
            </div>
          </div>
          <div
            class="risk-card-entry"
            @click="$router.push('/records/history')"
          >
            <span class="rce-icon" style="color: #8899aa">📋</span>
            <div class="rce-body">
              <span class="rce-title">历史险情</span>
              <span class="rce-num" style="color: #8899aa">{{
                store.riskStats.historyRisks
              }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 模块3：巡查路线预览 -->
      <div class="section-card card-glow" @click="$router.push('/map-full')">
        <div class="section-head">
          <span class="section-dot accent"></span>
          <span class="section-title">巡查路线预览</span>
        </div>
        <div class="route-map" ref="miniMapRef">
          <span class="section-more route-big">查看大图</span>
          <div class="route-legend">
            <div class="legend-item">
              <span class="legend-dot start"></span>起点
            </div>
            <div class="legend-item">
              <span class="legend-dot end"></span>终点
            </div>
            <div class="legend-item"><span class="legend-line"></span>路线</div>
          </div>
          <div class="route-info-bar">
            <span>📍 全程约 2.5km</span>
            <span>⏱ 预计 45min</span>
            <span>📌 3个检查点</span>
          </div>
        </div>
      </div>

      <!-- 模块4：2x3 快捷菜单 -->
      <div class="quick-menu">
        <div
          v-for="btn in quickMenus"
          :key="btn.label"
          class="quick-menu-item card"
          @click="$router.push(btn.path)"
        >
          <span class="qm-icon">{{ btn.icon }}</span>
          <div class="qm-body">
            <span class="qm-title">{{ btn.label }}</span>
            <span class="qm-desc">{{ btn.desc }}</span>
          </div>
        </div>
      </div>

      <!-- 模块5：底部 进度 + 待办 -->
      <div class="bottom-row">
        <div
          class="bottom-card card-glow progress-card"
        >
          <div class="section-head compact">
            <span class="section-dot primary"></span>
            <span class="section-title-sm">今日进度</span>
          </div>
          <div class="progress-body">
            <div class="progress-pie">
              <svg viewBox="0 0 80 80">
                <circle
                  cx="40"
                  cy="40"
                  r="32"
                  fill="none"
                  stroke="rgba(255,255,255,0.06)"
                  stroke-width="6"
                />
                <circle
                  cx="40"
                  cy="40"
                  r="32"
                  fill="none"
                  stroke="url(#pieGrad)"
                  stroke-width="6"
                  stroke-linecap="round"
                  :stroke-dasharray="`${store.patrolProgress * 2.01} 201`"
                  stroke-dashoffset="0"
                  transform="rotate(-90 40 40)"
                />
                <defs>
                  <linearGradient id="pieGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stop-color="#00d4ff" />
                    <stop offset="100%" stop-color="#00ff88" />
                  </linearGradient>
                </defs>
                <text
                  x="40"
                  y="38"
                  text-anchor="middle"
                  fill="#00d4ff"
                  font-size="14"
                  font-weight="700"
                >
                  {{ store.patrolProgress }}%
                </text>
                <text
                  x="40"
                  y="52"
                  text-anchor="middle"
                  fill="#8899aa"
                  font-size="8"
                >
                  完成率
                </text>
              </svg>
              <div class="progress-stats">
                <div class="ps-item">
                  <span class="ps-label">已巡查</span>
                  <span class="ps-val">{{ store.checkedCount }}km/{{ store.totalCheckpoints }}km</span>
                </div>
              </div>
            </div>
            <div class="progress-stats">
              <div class="ps-item">
                <span class="ps-label">预计完成</span>
                <span class="ps-val">{{ store.estimatedCompleteTime }}</span>
              </div>
            </div>
          </div>
          <div class="section-more progress-more" @click="$router.push('/progress')">
            进度详情 <van-icon name="arrow" size="10" />
          </div>
        </div>

        <div
          class="bottom-card card-glow todo-card"
          @click="$router.push('/reminders')"
        >
          <div class="section-head compact">
            <span class="section-dot warning"></span>
            <span class="section-title-sm">待办提醒</span>
            <span class="todo-badge" v-if="store.undoneCount">{{
              store.undoneCount
            }}</span>
          </div>
          <div class="todo-list">
            <div
              v-for="item in store.todoItems.slice(0, 3)"
              :key="item.id"
              class="todo-item"
              :class="{ done: item.done }"
              @click.stop="store.toggleTodo(item.id)"
            >
              <span class="todo-dot" :class="item.type"></span>
              <span class="todo-text">{{ item.content }}</span>
            </div>
            <van-empty
              v-if="store.todoItems.length === 0"
              description="暂无待办"
              :image-size="40"
            />
          </div>
          <div class="section-more todo-more">查看全部提醒 <van-icon name="arrow" size="10" /></div>
        </div>
      </div>

      <div style="height: 16px"></div>
    </div>

    <!-- ===== 底部Tab栏 ===== -->
    <van-tabbar v-model="activeTab" route>
      <van-tabbar-item icon="home-o" to="/">首页</van-tabbar-item>
      <van-tabbar-item to="/ar">
        <template #icon>
          <span class="tab-ar-icon">AR</span>
        </template>
        AR巡查
      </van-tabbar-item>
      <van-tabbar-item icon="map-o" to="/map">地图</van-tabbar-item>
      <van-tabbar-item icon="todo-list-o" to="/records">记录</van-tabbar-item>
      <van-tabbar-item icon="user-o" to="/profile">我的</van-tabbar-item>
    </van-tabbar>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useDamAppStore } from "../stores/app.js";
import { useWebSocket } from "@/composables/useWebSocket";
import { api } from "@/utils";
import type { DamSection } from "../stores/app.js";

const store = useDamAppStore();
const router = useRouter();
const activeTab = ref(0);
const showDamPicker = ref(false);
const miniMapRef = ref<HTMLElement | null>(null);

useWebSocket();

const quickMenus = [
  { icon: "🧭", label: "路线导航", desc: "前往起点", path: "/map" },
  {
    icon: "⚠️",
    label: "历史险情",
    desc: "查看历史记录",
    path: "/records/history",
  },
  {
    icon: "📡",
    label: "监测点位",
    desc: "实时监测数据",
    path: "/monitor/stations",
  },
  { icon: "🔄", label: "交接班", desc: "班次交接登记", path: "/shift" },
  { icon: "📦", label: "应急物资", desc: "物资清单检查", path: "/supplies" },
  {
    icon: "📋",
    label: "巡查记录",
    desc: "我的巡查记录",
    path: "/records/patrol",
  },
];

function selectDam(dam: DamSection) {
  store.switchDam(dam);
  showDamPicker.value = false;
}

onMounted(async () => {
  try {
    const data = await api<any>("/dashboard");
    if (data) {
      if (data.tasks) store.setPatrolTasks(data.tasks);
      if (data.alerts) data.alerts.forEach((a: any) => store.addRiskAlert(a));
    }
  } catch {
    useMockData();
  }
});

function useMockData() {
  store.setPatrolTasks([
    {
      id: "1",
      title: "江宁堤段日常巡检",
      section: "江宁堤段 K12+400",
      patrolRange: "K12+400 ~ K15+800",
      patrolDistance: "3.4 km",
      priority: "medium",
      planTime: "2026-06-29 08:00-12:00",
      team: "巡检一班",
      teamCount: 5,
      teamAvatars: ["👷", "👨‍🔧", "👩‍🔧", "👨‍💼", "👷‍♀️"],
      status: "in_progress",
      riskLevel: "medium",
      startTime: new Date().toISOString(),
      checkpoints: [
        {
          id: "c1",
          name: "坝顶检查点",
          lng: 114.312,
          lat: 30.605,
          checked: true,
        },
        {
          id: "c2",
          name: "背水坡渗流监测",
          lng: 114.318,
          lat: 30.608,
          checked: false,
        },
        {
          id: "c3",
          name: "排水设施检查",
          lng: 114.324,
          lat: 30.61,
          checked: false,
        },
      ],
    },
  ]);
  store.addRiskAlert({
    id: "a1",
    type: "seepage",
    level: "danger",
    location: "江宁堤段 K12+400 渗流监测区",
    lng: 114.315,
    lat: 30.607,
    desc: "渗流量突然增大至15L/min",
    time: new Date().toISOString(),
    value: 15,
    unit: "L/min",
  });
}
</script>

<style scoped>
.home-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--bg-dark);
}

/* ===== 顶部标题栏 ===== */
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  padding-top: max(10px, env(safe-area-inset-top));
  background: rgba(10, 14, 23, 0.95);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
  z-index: 50;
  flex-shrink: 0;
}
.top-bar-left {
  display: flex;
  align-items: center;
  gap: 6px;
}
.top-icon {
  font-size: 20px;
}
.top-title {
  font-size: 16px;
  font-weight: 700;
  color: #fff;
}
.top-dam-select {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  background: rgba(0, 212, 255, 0.1);
  border: 1px solid var(--border);
  border-radius: 14px;
  font-size: 11px;
  color: var(--primary);
  cursor: pointer;
  margin-left: 6px;
}

.top-bar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.weather-info {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-secondary);
}
.weather-icon {
  font-size: 16px;
}
.weather-desc {
  font-weight: 500;
}
.weather-temp {
  font-weight: 600;
  color: #fff;
}

.water-info {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  background: rgba(0, 255, 136, 0.08);
  border: 1px solid rgba(0, 255, 136, 0.2);
  border-radius: 14px;
  font-size: 11px;
}
.water-info.danger {
  background: rgba(255, 71, 87, 0.08);
  border-color: rgba(255, 71, 87, 0.3);
}
.water-val {
  color: #fff;
  font-weight: 600;
  font-family: "SF Mono", monospace;
}
.water-tag {
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 9px;
  font-weight: 600;
}
.water-tag.tag-low {
  background: rgba(0, 255, 136, 0.15);
  color: #00ff88;
}
.water-tag.tag-high {
  background: rgba(255, 71, 87, 0.15);
  color: #ff4757;
}

.dam-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 16px;
  background: var(--bg-card);
}
.dam-item {
  padding: 6px 16px;
  border: 1px solid var(--border);
  border-radius: 16px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}
.dam-item.active {
  border-color: var(--primary);
  color: var(--primary);
  background: rgba(0, 212, 255, 0.1);
}

.home-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 12px 14px;
  padding-bottom: calc(60px + env(safe-area-inset-bottom));
  -webkit-overflow-scrolling: touch;
}

/* ===== 通用 ===== */
.section-card {
  padding: 14px;
  margin-bottom: 12px;
  border: 1px solid transparent;
  border-radius: 14px;
  background:
    linear-gradient(#08121e, #08121e) padding-box,
    linear-gradient(
      135deg,
      rgb(46, 136, 172),
      rgba(40,120,151,0.4)
    ) border-box;
}
.section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.section-head.compact {
  margin-bottom: 8px;
}
.section-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.section-dot.primary {
  background: var(--primary);
  box-shadow: 0 0 6px var(--primary-glow);
}
.section-dot.danger {
  background: var(--danger);
  box-shadow: 0 0 6px rgba(255, 71, 87, 0.4);
}
.section-dot.accent {
  background: var(--accent);
  box-shadow: 0 0 6px rgba(0, 255, 136, 0.4);
}
.section-dot.warning {
  background: var(--warning);
  box-shadow: 0 0 6px rgba(255, 165, 2, 0.4);
}
.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  flex: 1;
  margin-bottom: 0;
}
.section-title-sm {
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  flex: 1;
}
.section-more {
  font-size: 11px;
  color: var(--primary-dark);
  cursor: pointer;
  flex-shrink: 0;
}
.section-more:active {
  color: var(--primary);
}

/* ===== 模块1：今日巡查任务 ===== */
.task-row {
  display: flex;
  gap: 12px;
}
.task-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.task-field {
  display: flex;
  align-items: flex-start;
}
.task-field label {
  font-size: 11px;
  color: var(--text-muted);
  width: 60px;
  flex-shrink: 0;
  line-height: 18px;
}
.task-field > span {
  font-size: 12px;
  text-align: left;
  color: var(--text-muted);
  line-height: 18px;
}
.task-field-val {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

/* 距离标签：科技蓝圆角 */
.distance-tag {
  display: inline-block;
  padding: 0px 8px;
  background: rgba(0, 212, 255, 0.12);
  border: 1px solid rgba(0, 212, 255, 0.3);
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
  color: var(--primary);
  font-family: "SF Mono", monospace;
  white-space: nowrap;
}

/* 班组头像 */
.team-avatars {
  display: flex;
  align-items: center;
}
.team-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  font-size: 10px;
  line-height: 1;
  margin-left: -6px;
}
.team-avatar:first-child {
  margin-left: 0;
}

/* 任务详情链接 */
.task-detail-link {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
  margin-top: 2px;
}
.task-detail-link:active {
  color: var(--primary);
}

.task-ar-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 90px;
  flex-shrink: 0;
}
.ar-anim {
  position: relative;
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
}
.ar-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid var(--primary);
  animation: arPulse 2s ease-out infinite;
}
.ar-ring.delay {
  animation-delay: 1s;
}
@keyframes arPulse {
  0% {
    transform: scale(0.6);
    opacity: 1;
  }
  100% {
    transform: scale(1.4);
    opacity: 0;
  }
}
.ar-scan {
  font-size: 26px;
  z-index: 1;
}

.ar-btn {
  padding: 6px 14px;
  background: linear-gradient(135deg, var(--primary-dark), var(--primary));
  color: #fff;
  border: none;
  border-radius: 16px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 212, 255, 0.3);
  white-space: nowrap;
}
.ar-btn:active {
  transform: scale(0.95);
}

/* ===== 模块2：风险概览 ===左侧icon+右侧文字=== */
.risk-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.risk-card-entry {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 8px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 6px;
}
.risk-card-entry:active {
  border-color: var(--border-active);
  background: rgba(0, 212, 255, 0.05);
}
.rce-icon {
  font-size: 18px;
  flex-shrink: 0;
  line-height: 1;
}
.rce-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.rce-title {
  font-size: 10px;
  color: var(--text-secondary);
  line-height: 1.3;
  white-space: nowrap;
}
.rce-num {
  font-size: 15px;
  font-weight: 700;
  font-family: "SF Mono", monospace;
  line-height: 1.3;
}

/* ===== 模块3：巡查路线预览 ===== */
.route-map {
  position: relative;
  height: 160px;
  background:
    linear-gradient(rgba(0, 212, 255, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 212, 255, 0.04) 1px, transparent 1px);
  background-size: 20px 20px;
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
}
.route-map::before {
  content: "";
  position: absolute;
  top: 30%;
  left: 10%;
  width: 80%;
  height: 3px;
  background: linear-gradient(90deg, #00ff88, #00d4ff, #ffa502);
  border-radius: 2px;
  transform: rotate(-5deg);
  box-shadow: 0 0 10px rgba(0, 212, 255, 0.3);
}
.route-map::after {
  content: "▶";
  position: absolute;
  top: 27%;
  left: 8%;
  color: #00ff88;
  font-size: 20px;
  text-shadow: 0 0 8px #00ff88;
}
.route-big{
position: absolute;
  bottom: 38px;
  right: 5px;
  display: flex;
  gap: 10px;
}
.route-legend {
  position: absolute;
  top: 0px;
  left: 0px;
  display: flex;
  gap: 10px;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  color: var(--text-muted);
}
.legend-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.legend-dot.start {
  background: #00ff88;
}
.legend-dot.end {
  background: #ffa502;
}
.legend-line {
  width: 12px;
  height: 2px;
  background: linear-gradient(90deg, #00d4ff, #ffa502);
}
.route-info-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-around;
  padding: 8px 12px;
  background: rgba(10, 14, 23, 0.85);
  border-top: 1px solid var(--border);
  font-size: 10px;
  color: var(--text-secondary);
}

/* ===== 模块4：快捷菜单 ===左icon右标题+提示=== */
.quick-menu {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 12px;
}
.quick-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 10px;
  cursor: pointer;
  transition: all 0.3s;
  border-radius: 12px;
}
.quick-menu-item:active {
  transform: scale(0.97);
  border-color: var(--border-active);
}
.qm-icon {
  font-size: 26px;
  flex-shrink: 0;
}
.qm-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.qm-title {
  font-size: 11px;
  color: var(--text-primary);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.qm-desc {
  font-size: 9px;
  color: var(--text-muted);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ===== 模块5：底部进度+待办 ===== */
.bottom-row {
  display: flex;
  gap: 10px;
}
.bottom-card {
  flex: 1;
  padding: 12px;
  border-radius: 14px;
  cursor: pointer;
  min-width: 0;
}
.progress-body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.progress-pie {
  flex-shrink: 0;
  width: 50%;
  display: flex;
  justify-content: space-between;
}
.progress-pie svg {
  width: 90px;
  height: 90px;
}
.progress-stats {
  padding-top: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.progress-more{
  padding-left: 20px;
}
.ps-item {
  display: flex;
  flex-direction: column;
  align-items: start;
  gap: 2px;
}
.ps-val {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-muted);
}
.ps-unit {
  font-size: 11px;
  color: var(--text-muted);
}
.ps-label {
  font-size: 10px;
  color: var(--text-muted);
}

.todo-badge {
  background: var(--danger);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 10px;
  margin-right: 4px;
}
.todo-list {
  height: 90px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.todo-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
}
.todo-item.done {
  opacity: 0.4;
}
.todo-item.done .todo-text {
  text-decoration: line-through;
}
.todo-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
}
.todo-dot.risk {
  background: var(--danger);
}
.todo-dot.patrol {
  background: var(--primary);
}
.todo-dot.shift {
  background: var(--warning);
}
.todo-dot.supply {
  background: var(--accent);
}
.todo-text {
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.todo-more{
  display: flex;
  align-items: center;
  justify-content: end;
}

/* ===== AR字样Tab图标 ===== */
.tab-ar-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  color: var(--primary);
  border: 1.5px solid var(--primary);
  border-radius: 4px;
  padding: 1px 3px;
}
</style>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import AppTabBar from '@/components/AppTabBar.vue';
import { useProductUi } from '@/features/app/product-ui.js';

const router = useRouter();
const { ui } = useProductUi();
const task = computed( () => ui.value.dashboard.task );
const site = computed( () => ui.value.sites[ 0 ] );
const totalCheckpoints = computed( () => task.value.checkpoints.length );
const checkedCount = computed( () => task.value.checkpoints.filter( ( checkpoint ) => checkpoint.checked ).length );
const patrolProgress = computed( () => totalCheckpoints.value === 0 ? 0 : Math.round( checkedCount.value / totalCheckpoints.value * 100 ) );

function navigate(path: string): void {
	void router.push( path );
}
</script>

<template>
	<main class="page home-page">
		<header class="hero"><div><p class="eyebrow">{{ ui.application.shortName }}</p><h1>{{ ui.application.name }}</h1><p class="site-name">{{ site.name }}</p></div><div class="conditions"><span>{{ ui.weather.icon }} {{ ui.weather.desc }} {{ ui.weather.temp }}℃</span><strong>{{ ui.dashboard.pressure.label }} {{ ui.dashboard.pressure.value }} {{ ui.dashboard.pressure.unit }}</strong><small>{{ ui.dashboard.pressure.status }}</small></div></header>
		<section class="card task-card"><div class="section-heading"><h2>{{ ui.dashboard.taskTitle }}</h2><span class="tag tag-medium">进行中</span></div><h3>{{ task.title }}</h3><p>{{ task.section }}</p><div class="task-meta"><span>{{ task.patrolRange }}</span><span>{{ task.team }} · {{ task.teamCount }} 人</span></div><button class="btn-primary" type="button" @click="navigate('/water-network/ar?autoStart=1')">{{ ui.application.arEntryLabel }}</button></section>
		<section class="section"><h2 class="section-title">{{ ui.dashboard.riskTitle }}</h2><div class="stats-grid"><div class="card stat"><strong>{{ ui.dashboard.riskStats.fixedPoints }}</strong><span>重点管段</span></div><div class="card stat"><strong>{{ ui.dashboard.riskStats.pendingReview }}</strong><span>待复核</span></div><div class="card stat danger"><strong>{{ ui.dashboard.riskStats.monitorAlerts }}</strong><span>压力告警</span></div></div></section>
		<section class="card route-card" @click="navigate('/water-network/map')"><div class="section-heading"><h2>{{ ui.dashboard.routeTitle }}</h2><span>查看地图 ›</span></div><p>{{ ui.dashboard.route.distance }} · 预计 {{ ui.dashboard.route.duration }} · {{ ui.dashboard.route.checkpointCount }} 个巡检点</p><div class="route-line"><i></i><i></i><i></i></div></section>
		<section class="section"><h2 class="section-title">快捷入口</h2><div class="quick-grid"><button v-for="item in ui.dashboard.quickMenus" :key="item.label" class="card quick-item" type="button" @click="navigate(item.path)"><span>{{ item.icon }}</span><b>{{ item.label }}</b><small>{{ item.desc }}</small></button></div></section>
		<section class="card progress-card"><div class="section-heading"><h2>{{ ui.dashboard.progressTitle }}</h2><strong>{{ patrolProgress }}%</strong></div><div class="progress-bar"><div class="progress-fill" :style="{ width: `${patrolProgress}%` }"></div></div><p>{{ checkedCount }}/{{ totalCheckpoints }} 个巡检点已完成</p></section>
	</main>
	<AppTabBar />
</template>

<style scoped>
.home-page { padding-bottom: calc(92px + var(--safe-bottom)); }.hero { display:flex; justify-content:space-between; gap:16px; padding:12px 0 22px; }.eyebrow { color:var(--primary); font-size:12px; letter-spacing:.12em; }h1 { margin:2px 0; font-size:24px; line-height:1.3; }.site-name, .task-card > p, .task-meta, .route-card p, .progress-card p { color:var(--text-secondary); font-size:13px; }.conditions { display:flex; flex-direction:column; align-items:flex-end; gap:3px; color:var(--text-secondary); font-size:12px; }.conditions strong { color:var(--text-primary); font-size:13px; }.conditions small { color:var(--accent); }.section-heading { display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px; }.section-heading h2 { font-size:15px; }.section-heading > span { color:var(--primary); font-size:12px; }.task-card h3 { font-size:17px; margin:4px 0; }.task-meta { display:grid; gap:4px; margin:12px 0; }.task-card .btn-primary { width:100%; }.section { margin-top:18px; }.stats-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }.stat { display:flex; flex-direction:column; gap:4px; padding:13px; }.stat strong { color:var(--primary); font-size:21px; }.stat span { color:var(--text-secondary); font-size:12px; }.stat.danger strong { color:var(--danger); }.route-card { margin-top:18px; cursor:pointer; }.route-line { display:flex; align-items:center; justify-content:space-between; margin-top:16px; border-top:2px dashed rgba(0,212,255,.45); }.route-line i { width:10px; height:10px; margin-top:-6px; border-radius:50%; background:var(--primary); box-shadow:0 0 8px var(--primary); }.route-line i:last-child { background:var(--accent); }.quick-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }.quick-item { min-height:106px; display:flex; flex-direction:column; align-items:flex-start; gap:5px; border:0; color:var(--text-primary); text-align:left; cursor:pointer; }.quick-item span { color:var(--primary); font-size:20px; }.quick-item b { font-size:13px; }.quick-item small { color:var(--text-secondary); font-size:11px; }.progress-card { margin-top:18px; }.progress-card .section-heading strong { color:var(--primary); }.progress-card p { margin-top:8px; }
</style>

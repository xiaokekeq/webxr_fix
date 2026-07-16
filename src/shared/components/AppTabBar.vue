<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

interface TabItem { key: string; label: string; path: string; icon: string; autoStart?: boolean; }

const TEXT = { navLabel: '主导航', home: '首页', ar: 'AR 巡查', map: '地图', records: '记录', profile: '我的' } as const;
const route = useRoute();
const router = useRouter();
const tabs = computed<TabItem[]>( () => [
	{ key: 'home', label: TEXT.home, path: '/', icon: '⌂' },
	{ key: 'ar', label: TEXT.ar, path: '/ar', icon: 'AR', autoStart: true },
	{ key: 'map', label: TEXT.map, path: '/map', icon: '◫' },
	{ key: 'records', label: TEXT.records, path: '/records', icon: '☰' },
	{ key: 'profile', label: TEXT.profile, path: '/profile', icon: '◉' }
] );
const activePath = computed( () => tabs.value.find( ( item ) => route.path === item.path || item.path !== '/' && route.path.startsWith( `${item.path}/` ) )?.path ?? '/' );

function navigate(tab: TabItem): void {
	if ( route.path !== tab.path ) void router.push( { path: tab.path, query: tab.autoStart ? { autoStart: '1' } : undefined } );
}
</script>

<template>
	<nav class="app-tabbar" :aria-label="TEXT.navLabel">
		<button v-for="tab in tabs" :key="tab.key" type="button" class="app-tabbar-item" :class="{ active: activePath === tab.path, accent: tab.key === 'ar' }" @click="navigate(tab)">
			<span class="app-tabbar-icon">{{ tab.icon }}</span><span class="app-tabbar-label">{{ tab.label }}</span>
		</button>
	</nav>
</template>

<style scoped>
.app-tabbar { position:fixed; right:0; bottom:0; left:0; z-index:60; display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); align-items:end; padding:8px 10px calc(8px + env(safe-area-inset-bottom)); border-top:1px solid rgba(255,255,255,.08); background:rgba(6,11,20,.94); box-shadow:0 -10px 28px rgba(0,0,0,.28); backdrop-filter:blur(16px); }.app-tabbar-item { display:flex; min-height:52px; flex-direction:column; align-items:center; justify-content:center; gap:4px; border:0; background:transparent; color:rgba(220,231,255,.66); font-size:11px; font-weight:600; }.app-tabbar-item.active { color:#33c7ff; }.app-tabbar-icon { display:inline-flex; width:28px; height:28px; align-items:center; justify-content:center; border:1px solid rgba(255,255,255,.06); border-radius:10px; background:rgba(255,255,255,.03); font-size:13px; }.app-tabbar-item.accent .app-tabbar-icon { font-size:14px; font-weight:800; }.app-tabbar-item.active .app-tabbar-icon { border-color:rgba(69,208,255,.28); background:linear-gradient(180deg,rgba(47,186,255,.24),rgba(31,115,255,.14)); box-shadow:0 0 18px rgba(0,193,255,.16); }.app-tabbar-label { line-height:1.1; white-space:nowrap; }
</style>

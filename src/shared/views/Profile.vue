<script setup lang="ts">
import { useRouter } from 'vue-router';
import AppTabBar from '@/shared/components/AppTabBar.vue';
import { useProjectUi } from '@/shared/config/project-config.js';

const router = useRouter();
const { ui } = useProjectUi();

function navigate(path?: string): void {
	if ( path !== undefined ) void router.push( path );
}
</script>

<template>
	<main class="page profile-page">
		<van-nav-bar :title="ui.profile.title" fixed placeholder />
		<section class="profile-header card-glow"><div class="avatar">{{ ui.profile.avatar }}</div><div><h1>{{ ui.profile.name }}</h1><p>{{ ui.profile.role }}</p></div></section>
		<section class="profile-list"><button v-for="item in ui.profile.items" :key="item.label" class="profile-item card" type="button" @click="navigate(item.path)"><span>{{ item.icon }}</span><b>{{ item.label }}</b><van-icon name="arrow" color="#556677" /></button></section>
	</main>
	<AppTabBar />
</template>

<style scoped>
.profile-page { padding-bottom:calc(92px + var(--safe-bottom)); }.profile-header { display:flex; align-items:center; gap:14px; margin-bottom:14px; }.avatar { display:grid; width:54px; height:54px; place-items:center; border:2px solid var(--border-active); border-radius:50%; color:var(--primary); font-size:20px; font-weight:700; }.profile-header h1 { font-size:18px; }.profile-header p { margin-top:4px; color:var(--text-secondary); font-size:13px; }.profile-list { display:grid; gap:8px; }.profile-item { display:flex; align-items:center; gap:12px; width:100%; color:var(--text-primary); text-align:left; cursor:pointer; }.profile-item > span { width:24px; color:var(--primary); text-align:center; }.profile-item b { flex:1; font-size:14px; }
</style>

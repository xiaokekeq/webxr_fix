<script setup lang="ts">
import { useRouter } from 'vue-router';
import AppTabBar from '@/components/AppTabBar.vue';
import { useProductUi } from '@/features/app/product-ui.js';

const router = useRouter();
const { ui } = useProductUi();
</script>

<template>
	<main class="page records-page">
		<van-nav-bar :title="ui.records.title" fixed placeholder />
		<p class="subtitle">集中查看供水管网的巡检、告警与维修处置记录。</p>
		<section class="record-cards">
			<button v-for="item in ui.records.items" :key="item.label" class="record-card card-glow" type="button" @click="router.push(item.path)">
				<span class="rc-icon">{{ item.icon }}</span><span class="rc-label">{{ item.label }}</span><span class="rc-count">{{ item.count }}</span><van-icon name="arrow" />
			</button>
		</section>
	</main>
	<AppTabBar />
</template>

<style scoped>
.records-page { padding-bottom:calc(92px + var(--safe-bottom)); }.subtitle { margin:4px 0 18px; color:var(--text-secondary); font-size:13px; }.record-cards { display:grid; gap:10px; }.record-card { width:100%; display:flex; align-items:center; gap:12px; color:var(--text-primary); text-align:left; cursor:pointer; }.rc-icon { width:28px; color:var(--primary); font-size:22px; text-align:center; }.rc-label { flex:1; font-size:15px; font-weight:600; }.rc-count { color:var(--text-secondary); font-size:13px; }
</style>

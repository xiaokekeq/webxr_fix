<script setup lang="ts">
const TEXT = {
	title: 'Marker 调试入口',
	description: '该页面仅用于 Marker 拍照点角和算法调试，不作为主 AR 的正式配准入口。',
	open: '打开 Marker Test（Debug）',
	back: '返回首页'
} as const;

const defaultTarget = '/marker-test/';
</script>

<template>
	<div class="mobile-shell marker-view">
		<section class="glass-card card">
			<div class="card__title">{{ TEXT.title }}</div>
			<p class="card__desc">
				{{ TEXT.description }}
			</p>
			<div class="action-stack">
				<a class="pill-button primary" :href="defaultTarget">{{ TEXT.open }}</a>
				<router-link class="pill-button ghost" to="/">{{ TEXT.back }}</router-link>
			</div>
		</section>
	</div>
</template>

<style scoped>
.marker-view {
	display: grid;
	align-items: center;
}

.card {
	border-radius: var( --radius-lg );
	padding: 24px;
}

.card__title {
	font-size: 24px;
	font-weight: 700;
}

.card__desc {
	color: var( --text-subtle );
	line-height: 1.7;
}

.action-stack {
	display: grid;
	gap: 12px;
}
</style>

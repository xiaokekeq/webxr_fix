<script setup lang="ts">
defineProps<{
	title: string;
	first?: boolean;
}>();
</script>

<template>
	<div class="ar-panel-section" :class="{ first: first === true }">
		<div class="ar-panel-section-title">{{ title }}</div>
		<slot />
	</div>
</template>

<style scoped>
.ar-panel-section + .ar-panel-section {
	margin-top: 14px;
	padding-top: 14px;
	border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.ar-panel-section.first {
	margin-top: 0;
	padding-top: 0;
	border-top: 0;
}

.ar-panel-section-title {
	font-size: 12px;
	font-weight: 600;
	color: rgba(226, 236, 255, 0.88);
}
</style>

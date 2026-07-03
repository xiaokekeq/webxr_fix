<script setup lang="ts">
export interface ArInfoGridItem {
	label: string;
	value: string | number;
	wide?: boolean;
}

defineProps<{
	items: ArInfoGridItem[];
}>();
</script>

<template>
	<div class="ar-info-grid">
		<div
			v-for="item in items"
			:key="item.label"
			class="ar-info-card"
			:class="{ wide: item.wide === true }"
		>
			<span>{{ item.label }}</span>
			<strong>{{ item.value }}</strong>
		</div>
	</div>
</template>

<style scoped>
.ar-info-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 10px;
}

.ar-info-card {
	padding: 12px;
	border-radius: 16px;
	background: rgba(255, 255, 255, 0.04);
	border: 1px solid rgba(255, 255, 255, 0.06);
}

.ar-info-card span {
	display: block;
	font-size: 11px;
	color: rgba(210, 225, 255, 0.64);
}

.ar-info-card strong {
	display: block;
	margin-top: 6px;
	font-size: 13px;
	font-weight: 600;
	word-break: break-word;
}

.ar-info-card.wide {
	grid-column: 1 / -1;
}

@media (max-width: 420px) {
	.ar-info-grid {
		grid-template-columns: 1fr;
	}
}
</style>

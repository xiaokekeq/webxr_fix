<script setup lang="ts">
defineProps<{ value: number; ariaLabel: string }>();
const emit = defineEmits<{ input: [value: number] }>();
</script>

<template>
	<div
		class="floating-value-rail"
		@pointerdown.stop
		@pointermove.stop
		@pointerup.stop
		@click.stop
		@touchstart.stop
		@touchmove.stop.prevent
		@touchend.stop
	>
		<input
			:value="value"
			type="range"
			min="0"
			max="100"
			:aria-label="ariaLabel"
			@input="emit('input', Number(($event.target as HTMLInputElement).value))"
		>
	</div>
</template>

<style scoped>
.floating-value-rail {
	position: fixed;
	z-index: 9;
	right: max(10px, env(safe-area-inset-right));
	top: clamp(120px, 28vh, 260px);
	width: 42px;
	height: clamp(180px, 34vh, 320px);
	display: grid;
	place-items: center;
	border: 1px solid rgba(255, 255, 255, 0.16);
	border-radius: 999px;
	background: rgba(12, 22, 36, 0.28);
	box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
	backdrop-filter: blur(14px) saturate(135%);
	-webkit-backdrop-filter: blur(14px) saturate(135%);
	touch-action: none;
	user-select: none;
}

input {
	width: 24px;
	height: calc(100% - 24px);
	margin: 0;
	writing-mode: vertical-lr;
	direction: rtl;
	accent-color: #22d3ee;
	cursor: pointer;
	touch-action: none;
}
</style>

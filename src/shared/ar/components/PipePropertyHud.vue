<script setup lang="ts">
import { computed } from 'vue';
import type { SelectedComponentState } from '@/localization/core/registration-store.js';
import type { ComponentPropertyHudField } from '@/shared/config/project-config.js';
import { createComponentPropertyHudRows } from '@/shared/ar/property-hud.js';

const props = defineProps<{
	selectedComponent: SelectedComponentState | null;
	fields: ComponentPropertyHudField[];
}>();

const emit = defineEmits<{
	close: [];
}>();

const rows = computed( () => (
	props.selectedComponent === null
		? []
		: createComponentPropertyHudRows( props.selectedComponent, props.fields )
) );
</script>

<template>
	<div v-if="selectedComponent !== null" class="pipe-property-hud" aria-live="polite">
		<section
			class="pipe-property-card"
			data-ar-ui="true"
			role="dialog"
			aria-modal="false"
			aria-label="水管构件信息"
			@pointerdown.stop
			@click.stop
		>
			<header class="pipe-property-header">
				<div class="pipe-property-heading">
					<div class="pipe-property-eyebrow">构件信息</div>
					<h2 :title="selectedComponent.displayName">{{ selectedComponent.displayName }}</h2>
				</div>
				<button
					type="button"
					class="pipe-property-close"
					aria-label="关闭构件信息"
					@click="emit('close')"
				>
					×
				</button>
			</header>

			<div class="pipe-property-content">
				<dl class="pipe-property-list">
					<div v-for="row in rows" :key="row.key" class="pipe-property-row">
						<dt>{{ row.label }}</dt>
						<dd>{{ row.value }}</dd>
					</div>
				</dl>
			</div>
		</section>
	</div>
</template>

<style scoped>
.pipe-property-hud {
	position: fixed;
	inset: 0;
	z-index: 6;
	pointer-events: none;
}

.pipe-property-card {
	position: absolute;
	top: max(16px, env(safe-area-inset-top));
	left: 50%;
	width: min(88vw, 360px);
	max-height: min(42vh, 360px);
	transform: translateX(-50%);
	display: flex;
	flex-direction: column;
	overflow: hidden;
	border: 1px solid rgba(148, 163, 184, 0.28);
	border-radius: 18px;
	background: rgba(21, 61, 113, 0.48);
	box-shadow: 0 20px 52px rgba(0, 0, 0, 0.34);
	backdrop-filter: blur(22px);
	color: #eff6ff;
	pointer-events: auto;
}

.pipe-property-header {
	display: flex;
	align-items: flex-start;
	gap: 10px;
	padding: 14px 12px 10px 16px;
	border-bottom: 1px solid rgba(148, 163, 184, 0.18);
}

.pipe-property-heading {
	min-width: 0;
	flex: 1;
}

.pipe-property-eyebrow {
	font-size: 11px;
	font-weight: 800;
	letter-spacing: 0.08em;
	color: rgba(125, 211, 252, 0.9);
}

h2 {
	margin: 3px 0 0;
	overflow: hidden;
	font-size: 17px;
	line-height: 1.35;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.pipe-property-close {
	width: 40px;
	min-width: 40px;
	height: 40px;
	border: 1px solid rgba(148, 163, 184, 0.3);
	border-radius: 50%;
	background: rgba(15, 23, 42, 0.72);
	color: #eff6ff;
	font-size: 26px;
	line-height: 1;
	cursor: pointer;
}

.pipe-property-close:active {
	transform: scale(0.94);
}

.pipe-property-content {
	min-height: 0;
	overflow-y: auto;
	overscroll-behavior: contain;
	padding: 4px 16px 12px;
}

.pipe-property-list {
	margin: 0;
}

.pipe-property-row {
	display: grid;
	grid-template-columns: minmax(76px, 0.72fr) minmax(0, 1.28fr);
	gap: 12px;
	padding: 10px 0;
	border-bottom: 1px solid rgba(148, 163, 184, 0.12);
	font-size: 13px;
	line-height: 1.45;
}

.pipe-property-row:last-child {
	border-bottom: 0;
}

dt {
	color: rgba(191, 219, 254, 0.72);
}

dd {
	min-width: 0;
	margin: 0;
	overflow-wrap: anywhere;
	text-align: right;
	color: #f8fafc;
}
</style>

<script setup lang="ts">
import { computed } from 'vue';
import type { RegistrationStoreState } from '@/localization/core/registration-store.js';

const props = defineProps<{
	state: RegistrationStoreState;
}>();

const emit = defineEmits<{
	close: [];
}>();

const visible = computed( () => (
	props.state.annotationDetail.visible
	|| props.state.propertyPanel.name !== '未选择构件'
) );

const title = computed( () => (
	props.state.annotationDetail.visible
		? props.state.annotationDetail.title
		: props.state.propertyPanel.name
) );

const subtitle = computed( () => (
	props.state.annotationDetail.visible
		? props.state.annotationDetail.subtitle
		: props.state.propertyPanel.meshName ?? props.state.propertyPanel.type
) );

const fields = computed( () => {
	if ( props.state.annotationDetail.visible && props.state.annotationDetail.fields.length > 0 ) {
		return props.state.annotationDetail.fields;
	}

	const panel = props.state.propertyPanel;
	return [
		{ label: '类型', value: panel.type },
		{ label: '管径', value: panel.diameter },
		{ label: '材质', value: panel.material },
		{ label: '埋深', value: panel.depth },
		{ label: '状态', value: panel.status },
		{ label: '材质名称', value: panel.materialName ?? '-' },
		{ label: '备注', value: panel.remark }
	].filter( ( item ) => item.value !== undefined && item.value !== '' );
} );
</script>

<template>
	<transition name="model-info-fade">
		<section v-if="visible" class="model-info-panel" @pointerdown.stop @click.stop>
			<div class="model-info-header">
				<div>
					<div class="model-info-kicker">构件信息</div>
					<div class="model-info-title">{{ title || '未命名构件' }}</div>
					<div v-if="subtitle" class="model-info-subtitle">{{ subtitle }}</div>
				</div>
				<button type="button" class="model-info-close" @click="emit('close')">关闭</button>
			</div>
			<div class="model-info-grid">
				<div v-for="field in fields" :key="field.label" class="model-info-item">
					<span>{{ field.label }}</span>
					<strong>{{ field.value || '-' }}</strong>
				</div>
			</div>
		</section>
	</transition>
</template>

<style scoped>
.model-info-panel {
	position: fixed;
	z-index: 9;
	left: 16px;
	right: 16px;
	bottom: calc(82px + env(safe-area-inset-bottom));
	padding: 14px;
	border-radius: 22px;
	background: rgba(8, 15, 27, 0.88);
	border: 1px solid rgba(0, 212, 255, 0.2);
	box-shadow: 0 22px 72px rgba(0, 0, 0, 0.42);
	backdrop-filter: blur(24px);
	color: #eff6ff;
}

.model-info-header {
	display: flex;
	justify-content: space-between;
	gap: 12px;
	align-items: flex-start;
}

.model-info-kicker {
	font-size: 11px;
	color: rgba(125, 231, 255, 0.82);
	font-weight: 800;
	letter-spacing: 0.08em;
}

.model-info-title {
	margin-top: 4px;
	font-size: 18px;
	font-weight: 900;
}

.model-info-subtitle {
	margin-top: 3px;
	font-size: 12px;
	color: rgba(226, 232, 240, 0.72);
}

.model-info-close {
	border: 1px solid rgba(148, 163, 184, 0.22);
	border-radius: 999px;
	padding: 8px 12px;
	background: rgba(15, 23, 42, 0.82);
	color: #dbeafe;
	font-size: 12px;
	font-weight: 800;
}

.model-info-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 8px;
	margin-top: 12px;
}

.model-info-item {
	padding: 9px 10px;
	border-radius: 14px;
	background: rgba(255, 255, 255, 0.045);
	border: 1px solid rgba(255, 255, 255, 0.07);
}

.model-info-item span {
	display: block;
	font-size: 11px;
	color: rgba(203, 213, 225, 0.68);
}

.model-info-item strong {
	display: block;
	margin-top: 4px;
	font-size: 12px;
	line-height: 1.45;
	word-break: break-word;
}

.model-info-item:last-child {
	grid-column: 1 / -1;
}

.model-info-fade-enter-active,
.model-info-fade-leave-active {
	transition: opacity 0.18s ease, transform 0.18s ease;
}

.model-info-fade-enter-from,
.model-info-fade-leave-to {
	opacity: 0;
	transform: translateY(10px);
}

@media (min-width: 720px) {
	.model-info-panel {
		left: auto;
		right: 20px;
		width: min(420px, 42vw);
	}
}
</style>

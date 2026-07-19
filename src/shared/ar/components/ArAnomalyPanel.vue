<script setup lang="ts">
import { computed, ref } from 'vue';
import type { EngineeringAnnotation } from '@/engine/annotation/annotation-types.js';
import { filterActiveAnomalies } from '@/shared/ar/anomaly-panel.js';

const props = defineProps<{
	annotations: EngineeringAnnotation[];
}>();

const isOpen = ref( false );
const expandedId = ref<string | null>( null );
const dismissedIds = ref<string[]>( [] );

const anomalies = computed( () => filterActiveAnomalies( props.annotations, dismissedIds.value ) );
const dangerCount = computed( () => anomalies.value.filter( ( item ) => item.severity === 'danger' ).length );
const warningCount = computed( () => anomalies.value.length - dangerCount.value );

function toggleDetails(id: string): void {
	expandedId.value = expandedId.value === id ? null : id;
}

function dismiss(id: string): void {
	dismissedIds.value.push( id );
	if ( expandedId.value === id ) expandedId.value = null;
}

function severityLabel(annotation: EngineeringAnnotation): string {
	return annotation.severity === 'danger' ? '危险' : '警告';
}
</script>

<template>
	<div
		class="anomaly-ui"
		data-ar-ui="true"
		@pointerdown.stop
		@click.stop
	>
		<button
			type="button"
			class="anomaly-launcher"
			:class="{ active: isOpen }"
			:aria-expanded="isOpen"
			aria-controls="ar-anomaly-panel"
			@click="isOpen = !isOpen"
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
			</svg>
			<span>异常信息</span>
			<b v-if="anomalies.length > 0" class="anomaly-badge">{{ anomalies.length }}</b>
		</button>

		<Transition name="anomaly-panel">
			<section
				v-if="isOpen"
				id="ar-anomaly-panel"
				class="anomaly-panel"
				role="dialog"
				aria-labelledby="ar-anomaly-title"
			>
				<header class="panel-header">
					<div>
						<h2 id="ar-anomaly-title">异常信息</h2>
						<p>
							共 {{ anomalies.length }} 条 /
							<strong class="danger-text">{{ dangerCount }} 条危险</strong> /
							<strong class="warning-text">{{ warningCount }} 条警告</strong>
						</p>
					</div>
					<button type="button" class="panel-close" aria-label="关闭异常信息" @click="isOpen = false">×</button>
				</header>

				<div class="anomaly-list">
					<article
						v-for="annotation in anomalies"
						:key="annotation.id"
						class="anomaly-card"
						:class="annotation.severity"
					>
						<div class="card-heading">
							<span class="severity-icon" aria-hidden="true">!</span>
							<strong class="severity-name">{{ severityLabel(annotation) }}</strong>
							<span class="annotation-title">{{ annotation.title }}</span>
							<button
								type="button"
								class="chevron"
								:aria-label="expandedId === annotation.id ? '收起详情' : '展开详情'"
								@click="toggleDetails(annotation.id)"
							>
								{{ expandedId === annotation.id ? '⌃' : '⌄' }}
							</button>
						</div>

						<div class="card-summary">
							<p>{{ annotation.description || annotation.status || '暂无异常描述' }}</p>
							<div class="card-actions">
								<button type="button" class="view-button" @click="toggleDetails(annotation.id)">查看</button>
								<span aria-hidden="true">|</span>
								<button type="button" class="delete-button" :aria-label="`隐藏 ${annotation.title}`" @click="dismiss(annotation.id)">
									<svg viewBox="0 0 24 24" aria-hidden="true">
										<path d="M4 7h16M9 7V4h6v3m-9 0 1 14h10l1-14M10 11v6m4-6v6" />
									</svg>
								</button>
							</div>
						</div>

						<div v-if="expandedId === annotation.id" class="card-details">
							<div v-if="annotation.status" class="detail-row">
								<span>状态</span>
								<strong>{{ annotation.status }}</strong>
							</div>
							<div v-for="(value, label) in annotation.properties" :key="label" class="detail-row">
								<span>{{ label }}</span>
								<strong>{{ value ?? '-' }}</strong>
							</div>
						</div>
					</article>

					<div v-if="anomalies.length === 0" class="empty-state">
						当前模型没有危险或警告信息
					</div>
				</div>
			</section>
		</Transition>
	</div>
</template>

<style scoped>
.anomaly-ui {
	position: fixed;
	inset: 0;
	z-index: 9;
	pointer-events: none;
	color: #f8fafc;
}

.anomaly-launcher,
.anomaly-panel {
	pointer-events: auto;
	background: rgba(9, 16, 26, 0.78);
	border: 1px solid rgba(148, 163, 184, 0.68);
	box-shadow: 0 22px 70px rgba(0, 0, 0, 0.38);
	backdrop-filter: blur(22px);
}

.anomaly-launcher {
	position: absolute;
	top: max(94px, calc(env(safe-area-inset-top) + 80px));
	right: 16px;
	width: 68px;
	min-height: 72px;
	display: grid;
	place-items: center;
	gap: 3px;
	padding: 9px 6px 7px;
	border-radius: 12px;
	color: #f8fafc;
	font-size: 11px;
	font-weight: 700;
}

.anomaly-launcher.active,
.anomaly-launcher:focus-visible {
	border-color: rgba(56, 189, 248, 0.85);
	outline: none;
}

.anomaly-launcher svg {
	width: 28px;
	height: 28px;
	fill: none;
	stroke: currentColor;
	stroke-width: 1.7;
	stroke-linecap: round;
	stroke-linejoin: round;
}

.anomaly-badge {
	position: absolute;
	top: -9px;
	right: -8px;
	min-width: 25px;
	height: 25px;
	display: grid;
	place-items: center;
	padding: 0 5px;
	border-radius: 999px;
	background: #ff3b3b;
	box-shadow: 0 0 0 2px rgba(9, 16, 26, 0.8);
	font-size: 13px;
}

.anomaly-panel {
	position: absolute;
	top: max(178px, calc(env(safe-area-inset-top) + 154px));
	left: 50%;
	width: min(calc(100vw - 32px), 520px);
	max-height: calc(100vh - 280px - env(safe-area-inset-bottom));
	display: flex;
	flex-direction: column;
	transform: translateX(-50%);
	padding: 18px;
	border-radius: 24px;
}

.panel-header {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 12px;
}

.panel-header h2 {
	margin: 0;
	font-size: 22px;
}

.panel-header p {
	margin: 8px 0 14px;
	color: rgba(226, 232, 240, 0.86);
	font-size: 14px;
}

.danger-text,
.anomaly-card.danger .severity-name {
	color: #ff5353;
}

.warning-text,
.anomaly-card.warning .severity-name {
	color: #facc15;
}

.panel-close {
	border: 0;
	background: transparent;
	color: rgba(241, 245, 249, 0.82);
	font-size: 34px;
	font-weight: 200;
	line-height: 0.8;
}

.anomaly-list {
	display: grid;
	gap: 12px;
	min-height: 0;
	overflow-y: auto;
	overscroll-behavior: contain;
}

.anomaly-card {
	padding: 14px;
	border: 1px solid;
	border-radius: 16px;
	background: rgba(15, 23, 42, 0.48);
}

.anomaly-card.danger {
	border-color: rgba(255, 59, 59, 0.9);
	background: linear-gradient(135deg, rgba(127, 29, 29, 0.27), rgba(15, 23, 42, 0.48));
}

.anomaly-card.warning {
	border-color: rgba(250, 204, 21, 0.9);
	background: linear-gradient(135deg, rgba(113, 63, 18, 0.24), rgba(15, 23, 42, 0.48));
}

.card-heading {
	display: grid;
	grid-template-columns: 28px auto minmax(0, 1fr) 26px;
	align-items: center;
	gap: 9px;
}

.severity-icon {
	width: 28px;
	height: 26px;
	display: grid;
	place-items: center;
	clip-path: polygon(50% 0, 100% 100%, 0 100%);
	background: #facc15;
	color: #172033;
	font-size: 15px;
	font-weight: 900;
}

.danger .severity-icon {
	background: #ff5353;
}

.severity-name,
.annotation-title {
	font-size: 15px;
}

.annotation-title {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.chevron,
.view-button,
.delete-button {
	border: 0;
	background: transparent;
	color: inherit;
}

.chevron {
	font-size: 22px;
	line-height: 1;
}

.card-summary {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 12px;
	margin-top: 10px;
}

.card-summary p {
	margin: 0;
	color: rgba(241, 245, 249, 0.86);
	font-size: 13px;
	line-height: 1.55;
}

.card-actions {
	flex: none;
	display: flex;
	align-items: center;
	gap: 8px;
	color: rgba(226, 232, 240, 0.68);
}

.view-button {
	padding: 4px 0;
	color: #38bdf8;
	font-size: 13px;
}

.delete-button {
	width: 25px;
	height: 25px;
	padding: 2px;
}

.delete-button svg {
	width: 100%;
	height: 100%;
	fill: none;
	stroke: currentColor;
	stroke-width: 1.8;
	stroke-linecap: round;
	stroke-linejoin: round;
}

.card-details {
	margin-top: 12px;
	padding: 10px 12px;
	border: 1px solid rgba(148, 163, 184, 0.3);
	border-radius: 12px;
	background: rgba(2, 6, 23, 0.28);
}

.detail-row {
	display: grid;
	grid-template-columns: minmax(82px, auto) minmax(0, 1fr);
	gap: 10px;
	padding: 4px 0;
	font-size: 12px;
	line-height: 1.45;
}

.detail-row span {
	color: rgba(203, 213, 225, 0.72);
}

.detail-row strong {
	font-weight: 500;
	word-break: break-word;
}

.empty-state {
	padding: 32px 12px;
	border: 1px dashed rgba(148, 163, 184, 0.34);
	border-radius: 14px;
	color: rgba(203, 213, 225, 0.68);
	text-align: center;
	font-size: 13px;
}

.anomaly-panel-enter-active,
.anomaly-panel-leave-active {
	transition: opacity 0.16s ease, transform 0.16s ease;
}

.anomaly-panel-enter-from,
.anomaly-panel-leave-to {
	opacity: 0;
	transform: translate(-50%, 10px);
}

@media (max-height: 720px) {
	.anomaly-panel {
		top: max(112px, calc(env(safe-area-inset-top) + 94px));
		max-height: calc(100vh - 205px - env(safe-area-inset-bottom));
	}
}
</style>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppTabBar from '../components/AppTabBar.vue';
import {
	DISPLAY_MODE_OPTIONS,
	SECTION_CUT_PLANE_MODE_OPTIONS,
	getDisplayModeLabel
} from '@/features/ar/types/display-modes.js';
import { useArShellStore } from '@/features/ar/stores/ar-shell.js';

const TEXT = {
	title: '现场基准配置',
	subtitle: '本功能用于建立现场基准。系统不会保存本次 AR 会话的临时坐标矩阵，只保存可复用的工程基准信息。',
	unknownModel: '未选择站点',
	enterAr: '进入 AR 配置',
	saveBaseline: '保存现场基准配置',
	placeModel: '手动场景定位',
	placeHitTest: '临时放置模型',
	exitAr: '退出配置',
	markerDebug: '打开调试页（Debug）',
	resetPlacement: '重置放置',
	currentModel: '站点 / 模型',
	baselineSummary: '现场基准',
	sessionStatus: '当前会话状态',
	placementMode: '放置方式',
	displayMode: '显示模式',
	projectStage: '工程阶段',
	sectionPlane: '剖切方向',
	coarseRegistration: '粗定位准备',
	gpsBiasCorrection: 'GPS 偏差记录',
	markerCorrection: '控制标志校正',
	markerStatus: '控制标志状态',
	localizationSource: '当前定位来源',
	runtimeStatus: '运行状态',
	arSupport: 'AR 支持',
	refreshGps: '刷新 GPS',
	enableCoarse: '启用粗定位',
	saveGpsBias: '记录 GPS 偏差',
	clearGpsBias: '清除 GPS 偏差',
	gpsBiasWarning: '该补偿仅用于后续巡查中的粗定位 fallback，不代表精确配准。',
	refreshMarker: '刷新调试结果',
	startCollect: '手动四角点校正',
	captureCorner: '采集当前角点',
	solveApply: '求解并应用',
	resetMarker: '重置角点',
	clearMarker: '清除当前校正',
	placementLocalized: '按定位固定',
	placementTemporary: '临时放到平面',
	savedAvailable: '已保存',
	savedUnavailable: '未保存',
	supportAvailable: '可用',
	supportChecking: '检测中',
	supportUnavailable: '不可用',
	startArTitle: '点击进入 AR 配置',
	startArSub: '在当前 AR 会话里完成模型放置、控制标志校正、手动场景定位和 GPS 偏差记录。',
	cornersCollected: '已采集角点',
	nextCorner: '下一角点',
	controlTargetCount: '控制标志数量',
	baselineGpsBias: 'GPS 偏差基准',
	currentMode: '工作模式'
} as const;

const route = useRoute();
const router = useRouter();
const store = useArShellStore();

const canvasHost = ref<HTMLElement | null>( null );
const xrButtonHost = ref<HTMLElement | null>( null );

const engine = computed( () => store.engine );
const currentModelName = computed(
	() => engine.value.availableModels.find( ( item ) => item.id === engine.value.selectedModelId )?.name ?? TEXT.unknownModel
);
const placementModeLabel = computed( () =>
	engine.value.placementMode === 'hit-test-temporary'
		? TEXT.placementTemporary
		: TEXT.placementLocalized
);
const arSupportLabel = computed( () => {
	switch ( engine.value.arSupportState ) {
		case 'supported':
			return TEXT.supportAvailable;
		case 'checking':
			return TEXT.supportChecking;
		default:
			return TEXT.supportUnavailable;
	}
} );
const sliderVisible = computed(
	() => engine.value.displayMode === 'transparent-xray'
		|| engine.value.displayMode === 'layer-peeling'
		|| engine.value.displayMode === 'section-cut'
);
const sliderValue = computed<number>( {
	get() {
		switch ( engine.value.displayMode ) {
			case 'transparent-xray':
				return engine.value.transparentXrayValue;
			case 'layer-peeling':
				return engine.value.layerPeelingValue;
			case 'section-cut':
				return engine.value.sectionCutValue;
			default:
				return 0;
		}
	},
	set(value: number) {
		store.actions.setStructureRevealValue( value );
	}
} );

const sessionCards = computed( () => [
	{ label: TEXT.currentMode, value: engine.value.workflowMode },
	{ label: TEXT.localizationSource, value: engine.value.registrationChainDebug.arSessionLocalization.source || 'unknown' },
	{ label: TEXT.runtimeStatus, value: engine.value.runtimeStatus },
	{ label: TEXT.markerStatus, value: engine.value.savedMarkerLocalization.available ? 'debug-only' : TEXT.savedUnavailable }
]);

async function mountEngineHosts(): Promise<void> {
	await store.initialize();
	store.actions.setWorkflowMode( 'site-baseline-config' );
	if ( typeof route.query.siteId === 'string' && route.query.siteId.length > 0 ) {
		store.actions.selectModel( route.query.siteId );
	}
	await nextTick();
	if ( canvasHost.value === null || xrButtonHost.value === null ) {
		return;
	}

	store.mountHosts( {
		canvasHost: canvasHost.value,
		xrButtonHost: xrButtonHost.value
	} );
}

async function startArSession(): Promise<void> {
	await mountEngineHosts();
	await nextTick();
	store.actions.setWorkflowMode( 'site-baseline-config' );
	store.actions.enterAr();
}

function handleModelChange(event: Event): void {
	const target = event.target as HTMLSelectElement;
	store.actions.selectModel( target.value );
}

function openMarkerDebug(): void {
	void router.push( '/marker-debug' );
}

onMounted( () => {
	void mountEngineHosts();
	store.actions.setWorkflowMode( 'site-baseline-config' );
	store.actions.activatePanel( 'registration' );
} );
</script>

<template>
	<div class="calibration-page" @click="store.actions.handleArUiInteraction()">
		<div class="page-scroll">
			<header class="hero-card">
				<div class="hero-main">
					<div>
						<div class="hero-title">{{ TEXT.title }}</div>
						<div class="hero-subtitle">{{ TEXT.subtitle }}</div>
					</div>
					<div class="hero-badge">{{ currentModelName }}</div>
				</div>
				<div class="hero-chips">
					<span class="hero-chip">{{ TEXT.arSupport }} {{ arSupportLabel }}</span>
					<span class="hero-chip">{{ TEXT.currentMode }} {{ engine.workflowMode }}</span>
					<span class="hero-chip">{{ TEXT.displayMode }} {{ getDisplayModeLabel(engine.displayMode) }}</span>
				</div>
			</header>

			<section class="scene-shell">
				<div ref="canvasHost" class="scene-layer"></div>
				<div ref="xrButtonHost" class="scene-hidden"></div>

				<div v-if="engine.appMode !== 'ar-session'" class="launch-overlay">
					<div class="launch-badge">AR</div>
					<div class="launch-title">{{ TEXT.startArTitle }}</div>
					<p class="launch-subtitle">{{ TEXT.startArSub }}</p>
					<button type="button" class="launch-button" @click.stop="startArSession">
						{{ TEXT.enterAr }}
					</button>
				</div>
			</section>

			<div v-if="sliderVisible" class="side-slider">
				<input v-model="sliderValue" class="side-slider-range" type="range" min="0" max="100" step="1" />
			</div>

			<section class="action-row">
				<button type="button" class="action-button primary" @click="startArSession">
					{{ TEXT.enterAr }}
				</button>
				<button type="button" class="action-button primary" @click="store.actions.saveSiteCalibrationBaseline()">
					{{ TEXT.saveBaseline }}
				</button>
				<button
					v-if="engine.appMode === 'ar-session'"
					type="button"
					class="action-button"
					@click="store.actions.placeModel()"
				>
					{{ TEXT.placeModel }}
				</button>
				<button
					v-if="engine.appMode === 'ar-session'"
					type="button"
					class="action-button"
					@click="store.actions.placeModelAtHitTest()"
				>
					{{ TEXT.placeHitTest }}
				</button>
				<button type="button" class="action-button" @click="store.actions.saveGpsBiasCorrectionFromCurrentPose()">
					{{ TEXT.saveGpsBias }}
				</button>
				<button type="button" class="action-button" @click="openMarkerDebug">
					{{ TEXT.markerDebug }}
				</button>
				<button
					v-if="engine.appMode === 'ar-session'"
					type="button"
					class="action-button"
					@click="store.actions.exitAr()"
				>
					{{ TEXT.exitAr }}
				</button>
				<button type="button" class="action-button" @click="store.actions.resetPlacement()">
					{{ TEXT.resetPlacement }}
				</button>
			</section>

			<section class="panel-card">
				<div class="panel-title">{{ TEXT.currentModel }}</div>
				<select class="select-field" :value="engine.selectedModelId" @change="handleModelChange">
					<option v-for="model in engine.availableModels" :key="model.id" :value="model.id">
						{{ model.name }}
					</option>
				</select>
			</section>

			<section class="panel-card">
				<div class="panel-title">{{ TEXT.baselineSummary }}</div>
				<div class="status-grid">
					<div class="status-card">
						<div class="status-label">状态</div>
						<div class="status-value">{{ engine.siteCalibrationBaseline.statusText }}</div>
					</div>
					<div class="status-card">
						<div class="status-label">{{ TEXT.controlTargetCount }}</div>
						<div class="status-value">{{ engine.siteCalibrationBaseline.controlTargetCount }}</div>
					</div>
					<div class="status-card">
						<div class="status-label">{{ TEXT.baselineGpsBias }}</div>
						<div class="status-value">{{ engine.siteCalibrationBaseline.gpsBiasAvailable ? TEXT.savedAvailable : TEXT.savedUnavailable }}</div>
					</div>
					<div class="status-card">
						<div class="status-label">更新时间</div>
						<div class="status-value">{{ engine.siteCalibrationBaseline.updatedAtText }}</div>
					</div>
				</div>
			</section>

			<section class="panel-card">
				<div class="panel-title">{{ TEXT.sessionStatus }}</div>
				<div class="status-grid">
					<div v-for="item in sessionCards" :key="item.label" class="status-card">
						<div class="status-label">{{ item.label }}</div>
						<div class="status-value">{{ item.value }}</div>
					</div>
				</div>
			</section>

			<section class="panel-card">
				<div class="panel-title">{{ TEXT.placementMode }}</div>
				<div class="chip-grid">
					<button
						type="button"
						class="chip-button"
						:class="{ active: engine.placementMode === 'localized' }"
						@click="store.actions.setPlacementMode('localized')"
					>
						{{ TEXT.placementLocalized }}
					</button>
					<button
						type="button"
						class="chip-button"
						:class="{ active: engine.placementMode === 'hit-test-temporary' }"
						@click="store.actions.setPlacementMode('hit-test-temporary')"
					>
						{{ TEXT.placementTemporary }}
					</button>
				</div>
				<div class="helper-text">{{ placementModeLabel }}</div>
			</section>

			<section class="panel-card">
				<div class="panel-title">{{ TEXT.displayMode }}</div>
				<div class="chip-grid">
					<button
						v-for="item in DISPLAY_MODE_OPTIONS"
						:key="item.value"
						type="button"
						class="chip-button"
						:class="{ active: engine.displayMode === item.value }"
						@click="store.actions.setDisplayMode(item.value)"
					>
						{{ item.label }}
					</button>
				</div>
			</section>

			<section v-if="engine.displayMode === 'section-cut'" class="panel-card">
				<div class="panel-title">{{ TEXT.sectionPlane }}</div>
				<div class="chip-grid">
					<button
						v-for="item in SECTION_CUT_PLANE_MODE_OPTIONS"
						:key="item.value"
						type="button"
						class="chip-button"
						:class="{ active: engine.sectionCutPlaneMode === item.value }"
						@click="store.actions.setSectionCutPlaneMode(item.value)"
					>
						{{ item.label }}
					</button>
				</div>
			</section>

			<section class="panel-card">
				<div class="panel-title">{{ TEXT.projectStage }}</div>
				<div class="chip-grid">
					<button
						v-for="(stage, index) in engine.timelineStages"
						:key="stage"
						type="button"
						class="chip-button"
						:class="{ active: engine.currentTimelineStageIndex === index }"
						@click="store.actions.setTimelineStage(index)"
					>
						{{ stage }}
					</button>
				</div>
			</section>

			<section class="panel-card">
				<div class="panel-title">{{ TEXT.coarseRegistration }}</div>
				<div class="chip-grid">
					<button type="button" class="chip-button" @click="store.actions.refreshGeoLocation()">
						{{ TEXT.refreshGps }}
					</button>
					<button type="button" class="chip-button active" @click="store.actions.enableCoarseRegistration()">
						{{ TEXT.enableCoarse }}
					</button>
				</div>
			</section>

			<section class="panel-card">
				<div class="panel-title">{{ TEXT.gpsBiasCorrection }}</div>
				<div class="marker-meta">
					<div>状态：{{ engine.gpsBiasCorrection.statusText }}</div>
					<div>来源：{{ engine.gpsBiasCorrection.source || '-' }}</div>
					<div>delta ENU：{{ engine.gpsBiasCorrection.deltaEnuText }}</div>
					<div>更新时间：{{ engine.gpsBiasCorrection.updatedAtText }}</div>
				</div>
				<div class="helper-text">{{ TEXT.gpsBiasWarning }}</div>
				<div class="chip-grid">
					<button type="button" class="chip-button" @click="store.actions.refreshGeoLocation()">
						{{ TEXT.refreshGps }}
					</button>
					<button type="button" class="chip-button active" @click="store.actions.saveGpsBiasCorrectionFromCurrentPose()">
						{{ TEXT.saveGpsBias }}
					</button>
					<button type="button" class="chip-button" @click="store.actions.clearGpsBiasCorrection()">
						{{ TEXT.clearGpsBias }}
					</button>
				</div>
			</section>

			<section class="panel-card">
				<div class="panel-title">{{ TEXT.markerCorrection }}</div>
				<div class="marker-meta">
					<div>{{ TEXT.markerStatus }}：{{ engine.savedMarkerLocalization.available ? 'debug-only' : TEXT.savedUnavailable }}</div>
					<div>{{ TEXT.cornersCollected }}：{{ engine.markerCalibration.capturedCornerCount }}/{{ engine.markerCalibration.expectedCornerCount }}</div>
					<div>{{ TEXT.nextCorner }}：{{ engine.markerCalibration.nextCornerLabel || '-' }}</div>
				</div>
				<div class="chip-grid">
					<button type="button" class="chip-button" @click="store.actions.refreshSavedMarkerLocalization()">
						{{ TEXT.refreshMarker }}
					</button>
					<button type="button" class="chip-button" @click="store.actions.startCurrentSessionMarkerCalibration()">
						{{ TEXT.startCollect }}
					</button>
					<button type="button" class="chip-button" @click="store.actions.captureCurrentSessionMarkerCorner()">
						{{ TEXT.captureCorner }}
					</button>
					<button type="button" class="chip-button active" @click="store.actions.solveAndApplyCurrentSessionMarkerCalibration()">
						{{ TEXT.solveApply }}
					</button>
					<button type="button" class="chip-button" @click="store.actions.resetCurrentSessionMarkerCalibration()">
						{{ TEXT.resetMarker }}
					</button>
					<button type="button" class="chip-button" @click="store.actions.clearMarkerLocalizationCorrection()">
						{{ TEXT.clearMarker }}
					</button>
				</div>
			</section>
		</div>

		<AppTabBar />
	</div>
</template>

<style scoped>
.calibration-page {
	min-height: 100vh;
	background: linear-gradient(180deg, #07101b 0%, #0b1625 100%);
	color: #eff6ff;
}

.page-scroll {
	padding: max(16px, env(safe-area-inset-top)) 16px calc(98px + env(safe-area-inset-bottom));
}

.hero-card,
.panel-card,
.scene-shell {
	border-radius: 20px;
	background: rgba(12, 22, 36, 0.9);
	border: 1px solid rgba(94, 194, 255, 0.12);
	box-shadow: 0 16px 30px rgba(0, 0, 0, 0.18);
}

.hero-card {
	padding: 18px;
	margin-bottom: 14px;
}

.hero-main {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 12px;
}

.hero-title {
	font-size: 24px;
	font-weight: 700;
}

.hero-subtitle {
	margin-top: 6px;
	font-size: 13px;
	line-height: 1.6;
	color: rgba(210, 225, 255, 0.7);
}

.hero-badge,
.hero-chip {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	padding: 6px 12px;
	border-radius: 999px;
	border: 1px solid rgba(69, 208, 255, 0.24);
	background: rgba(0, 212, 255, 0.08);
	font-size: 12px;
	color: #bff3ff;
}

.hero-chips {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin-top: 14px;
}

.scene-shell {
	position: relative;
	height: min(42vh, 380px);
	overflow: hidden;
	margin-bottom: 14px;
}

.scene-layer,
.scene-ar {
	position: absolute;
	inset: 0;
}

.scene-hidden {
	position: absolute;
	width: 0;
	height: 0;
	overflow: hidden;
}

.launch-overlay {
	position: absolute;
	inset: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	padding: 24px;
	text-align: center;
	background: linear-gradient(180deg, rgba(8, 13, 24, 0.72), rgba(8, 13, 24, 0.44));
	backdrop-filter: blur(10px);
	z-index: 5;
}

.launch-badge {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 72px;
	height: 72px;
	border-radius: 22px;
	background: linear-gradient(180deg, #17c8ff, #1594ff);
	font-size: 32px;
	font-weight: 800;
}

.launch-title {
	margin-top: 16px;
	font-size: 26px;
	font-weight: 700;
}

.launch-subtitle {
	margin: 10px 0 0;
	max-width: 420px;
	font-size: 13px;
	line-height: 1.6;
	color: rgba(220, 234, 255, 0.76);
}

.launch-button,
.action-button,
.chip-button {
	border: 0;
}

.launch-button {
	margin-top: 18px;
	padding: 12px 22px;
	border-radius: 999px;
	background: #11c9ff;
	color: #031019;
	font-size: 14px;
	font-weight: 700;
}

.side-slider {
	position: fixed;
	right: 6px;
	top: 52%;
	transform: translateY(-50%);
	z-index: 28;
	pointer-events: none;
}

.side-slider-range {
	width: 176px;
	height: 22px;
	margin: 0;
	transform: rotate(-90deg);
	transform-origin: center;
	accent-color: #00d4ff;
	pointer-events: auto;
}

.action-row {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
	gap: 10px;
	margin-bottom: 14px;
}

.action-button,
.chip-button {
	padding: 12px 14px;
	border-radius: 14px;
	background: rgba(255, 255, 255, 0.04);
	color: rgba(225, 236, 255, 0.74);
	font-size: 12px;
	border: 1px solid rgba(255, 255, 255, 0.08);
}

.action-button.primary,
.chip-button.active {
	background: rgba(0, 212, 255, 0.16);
	border-color: rgba(0, 212, 255, 0.34);
	color: #fff;
}

.panel-card {
	padding: 16px;
	margin-bottom: 14px;
}

.panel-title {
	font-size: 15px;
	font-weight: 700;
	margin-bottom: 12px;
}

.select-field {
	width: 100%;
	padding: 12px 14px;
	border-radius: 14px;
	border: 1px solid rgba(255, 255, 255, 0.08);
	background: rgba(255, 255, 255, 0.04);
	color: #f3f8ff;
}

.status-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 10px;
}

.status-card {
	padding: 12px;
	border-radius: 14px;
	background: rgba(255, 255, 255, 0.04);
	border: 1px solid rgba(255, 255, 255, 0.06);
}

.status-label {
	font-size: 11px;
	color: rgba(210, 225, 255, 0.64);
}

.status-value {
	margin-top: 6px;
	font-size: 14px;
	font-weight: 600;
}

.chip-grid {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.helper-text,
.marker-meta {
	margin-top: 10px;
	font-size: 12px;
	line-height: 1.6;
	color: rgba(210, 225, 255, 0.68);
}

@media (max-width: 420px) {
	.hero-title {
		font-size: 21px;
	}

	.hero-badge {
		max-width: 42%;
		font-size: 11px;
	}

	.action-row,
	.status-grid {
		grid-template-columns: 1fr;
	}

	.side-slider-range {
		width: 152px;
	}
}
</style>

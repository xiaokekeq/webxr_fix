<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppTabBar from '../components/AppTabBar.vue';
import ArInfoGrid from '@/components/ar/ArInfoGrid.vue';
import ArPanelSection from '@/components/ar/ArPanelSection.vue';
import {
	DISPLAY_MODE_OPTIONS,
	SECTION_CUT_PLANE_MODE_OPTIONS,
	getDisplayModeLabel,
	getDisplayModeSliderValueText
} from '@/features/ar/types/display-modes.js';
import { useArShellStore } from '@/features/ar/stores/ar-shell.js';
import type { ManualAdjustmentPreset } from '@/localization/manual/manual-registration.js';

type CalibrationPanelView = 'overview' | 'placement' | 'display' | 'calibration';

const TEXT = {
	title: '现场基准配置',
	enterArTitle: '进入 AR 配准',
	enterArSub: '先选择模型，再进入 AR 完成放置、微调和现场基准保存。',
	enterAr: '进入 AR',
	selectModel: '选择模型',
	status: '状态',
	waiting: '待进入 AR',
	scanning: '正在识别平面',
	ready: '可开始放置',
	placing: '正在放置模型',
	placed: '配准中',
	placement: '模型放置',
	display: '显示控制',
	calibration: '空间校准',
	exit: '退出 AR',
	panelTool: '控制面板',
	closePanel: '收起',
	placeModel: '应用配准放置',
	placeHitTest: '应用平面临放',
	resetPlacement: '清除当前放置',
	placementActions: '放置操作',
	sessionOverview: '会话总览',
	overview: '总览',
	displayMode: '模型显示',
	sectionPlane: '剖切方向',
	projectStage: '阶段筛选',
	markerCalibration: '角点采集说明',
	precisionCalibration: '控制标志精配',
	startCollect: '开始角点采集',
	captureCorner: '记录当前角点',
	solveApply: '解算并应用精配',
	resetMarker: '重置角点',
	clearMarker: '清除精配结果',
	cornersCollected: '已记录角点',
	nextCorner: '待记录角点',
	manualAdjustment: '放置微调',
	finePreset: '细调',
	mediumPreset: '中调',
	coarsePreset: '粗调',
	xAxis: 'X 轴',
	yAxis: 'Y 轴',
	zAxis: 'Z 轴',
	yaw: '旋转',
	scale: '缩放',
	negative: '减',
	positive: '加',
	saveManual: '保存本次微调结果',
	resetManual: '重置本次微调',
	clearSavedManual: '清除已存微调',
	gpsBias: '粗配准与 GPS 补偿',
	refreshGps: '刷新定位',
	enableCoarse: '启用粗配准',
	saveGpsBias: '记录 GPS 补偿',
	clearGpsBias: '清除 GPS 补偿',
	saveBaseline: '保存现场基准',
	markerDebug: '打开诊断页',
	unknownModel: '未选择站点'
} as const;

const PANEL_OPTIONS: Array<{ value: CalibrationPanelView; label: string }> = [
	{ value: 'overview', label: TEXT.overview },
	{ value: 'placement', label: TEXT.placement },
	{ value: 'display', label: TEXT.display },
	{ value: 'calibration', label: TEXT.calibration }
];

const MANUAL_PRESET_OPTIONS: Array<{ value: ManualAdjustmentPreset; label: string }> = [
	{ value: 'fine', label: TEXT.finePreset },
	{ value: 'medium', label: TEXT.mediumPreset },
	{ value: 'coarse', label: TEXT.coarsePreset }
];

const route = useRoute();
const router = useRouter();
const store = useArShellStore();

const canvasHost = ref<HTMLElement | null>( null );
const xrButtonHost = ref<HTMLElement | null>( null );
const activePanelView = ref<CalibrationPanelView>( 'overview' );

const engine = computed( () => store.engine );
const ui = computed( () => store.ui );
const hasArSession = computed( () => engine.value.appMode === 'ar-session' );
const currentModelName = computed(
	() => engine.value.availableModels.find( ( item ) => item.id === engine.value.selectedModelId )?.name ?? TEXT.unknownModel
);
const runtimeStatusText = computed( () => engine.value.runtimeStatus );
const baselineSummaryCards = computed( () => [
	{ label: '现场基准', value: engine.value.siteCalibrationBaseline.statusText },
	{ label: '控制点', value: engine.value.siteCalibrationBaseline.controlTargetCount },
	{ label: 'GPS 偏差', value: engine.value.siteCalibrationBaseline.gpsBiasAvailable ? '已保存' : '未保存' },
	{ label: '显示模式', value: getDisplayModeLabel( engine.value.displayMode ) }
] );
const sessionSnapshotCards = computed( () => [
	{ label: '运行状态', value: engine.value.runtimeStatus },
	{ label: '放置状态', value: engine.value.registrationStatusDetail },
	{ label: '粗配准诊断', value: engine.value.coarseLocationDebugText, wide: true },
	{ label: '空间定位来源', value: engine.value.registrationChainDebug.arSessionLocalization.source || '-' },
	{ label: '模型位置', value: engine.value.placementSummary.positionText, wide: true },
	{ label: '模型姿态', value: engine.value.placementSummary.quaternionText, wide: true },
	{ label: '模型缩放', value: engine.value.placementSummary.scaleText }
] );
const markerCalibrationCards = computed( () => [
	{ label: TEXT.cornersCollected, value: `${engine.value.markerCalibration.capturedCornerCount}/${engine.value.markerCalibration.expectedCornerCount}` },
	{ label: TEXT.nextCorner, value: engine.value.markerCalibration.nextCornerLabel || '-' }
] );
const manualAdjustmentCards = computed( () => [
	{ label: '平移偏移', value: engine.value.manualReadout.positionText, wide: true },
	{ label: '航向修正', value: engine.value.manualReadout.yawText },
	{ label: '比例修正', value: engine.value.manualReadout.scaleText }
] );
const calibrationGuideCards = computed( () => [
	{
		label: '操作顺序',
		value: '先开始采集，再按左上、右上、右下、左下顺序记录 4 个角点，最后执行解算并应用。',
		wide: true
	}
] );
const gpsBiasCards = computed( () => [
	{ label: '补偿状态', value: engine.value.gpsBiasCorrection.statusText, wide: true },
	{ label: 'ENU 偏差', value: engine.value.gpsBiasCorrection.deltaEnuText },
	{ label: '最近更新', value: engine.value.gpsBiasCorrection.updatedAtText }
] );
const sliderVisible = computed(
	() => hasArSession.value
		&& (
			engine.value.displayMode === 'transparent-xray'
			|| engine.value.displayMode === 'layer-peeling'
			|| engine.value.displayMode === 'section-cut'
		)
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
const sliderText = computed( () =>
	getDisplayModeSliderValueText( engine.value.displayMode, sliderValue.value )
);
const sessionStatusText = computed( () => {
	if ( hasArSession.value === false ) {
		return TEXT.waiting;
	}

	switch ( engine.value.arSessionPhase ) {
		case 'scanning':
			return TEXT.scanning;
		case 'ready-to-place':
			return TEXT.ready;
		case 'placing':
			return TEXT.placing;
		case 'placed':
			return TEXT.placed;
		default:
			return engine.value.runtimeStatus;
	}
} );

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

function activatePanelView(view: CalibrationPanelView): void {
	activePanelView.value = view;
}

function toggleWorkspacePanel(): void {
	if ( ui.value.drawerOpen ) {
		store.actions.toggleDrawer();
		return;
	}

	store.actions.activatePanel( 'registration' );
}

async function handleEnableCoarseRegistration(): Promise<void> {
	await store.actions.enableCoarseRegistration();
}

async function handleRefreshGps(): Promise<void> {
	await store.actions.refreshGeoLocation();
}

async function handleApplyLocalizedPlacement(): Promise<void> {
	store.actions.setPlacementMode( 'localized' );
	await store.actions.placeModel();
}

function handleApplyHitTestPlacement(): void {
	store.actions.setPlacementMode( 'hit-test-temporary' );
	store.actions.placeModelAtHitTest();
}

function handleStartPrecisionCalibration(): void {
	activePanelView.value = 'calibration';
	store.actions.startCurrentSessionMarkerCalibration();
}

function handleSolvePrecisionCalibration(): void {
	activePanelView.value = 'calibration';
	store.actions.solveAndApplyCurrentSessionMarkerCalibration();
}

function openMarkerDebug(): void {
	void router.push( '/marker-debug' );
}

onMounted( () => {
	void mountEngineHosts();
	store.actions.setWorkflowMode( 'site-baseline-config' );
} );
</script>

<template>
	<div class="calibration-page" :class="{ 'ar-active': hasArSession }" @click="store.actions.handleArUiInteraction()">
		<div class="page-scroll">
			<header class="page-header" @pointerdown.stop="store.actions.handleArUiInteraction()" @click.stop>
				<div>
					<div class="page-title">{{ TEXT.title }}</div>
					<div class="page-subtitle">{{ currentModelName }}</div>
				</div>
				<div class="status-chip">{{ TEXT.status }}：{{ sessionStatusText }}</div>
			</header>

			<section class="scene-shell">
				<div ref="canvasHost" class="scene-layer"></div>
				<div ref="xrButtonHost" class="scene-hidden"></div>

				<div
					v-if="!hasArSession"
					class="launch-overlay"
					@pointerdown.stop="store.actions.handleArUiInteraction()"
					@click.stop
				>
					<div class="launch-badge">AR</div>
					<div class="launch-title">{{ TEXT.enterArTitle }}</div>
					<p class="launch-subtitle">{{ TEXT.enterArSub }}</p>
					<label class="model-field">
						<span>{{ TEXT.selectModel }}</span>
						<select class="select-field" :value="engine.selectedModelId" @change="handleModelChange">
							<option v-for="model in engine.availableModels" :key="model.id" :value="model.id">
								{{ model.name }}
							</option>
						</select>
					</label>
					<div class="launch-actions">
						<button type="button" class="launch-button" @click.stop="startArSession">
							{{ TEXT.enterAr }}
						</button>
						<button type="button" class="secondary-button" @click.stop="openMarkerDebug">
							{{ TEXT.markerDebug }}
						</button>
					</div>
				</div>
			</section>

			<section v-if="!hasArSession" class="summary-card">
				<ArInfoGrid :items="baselineSummaryCards" />
			</section>

			<div v-if="sliderVisible" class="side-slider">
				<div class="side-slider-text">{{ sliderText }}</div>
				<input
					v-model="sliderValue"
					class="side-slider-range"
					type="range"
					min="0"
					max="100"
					step="1"
					@pointerdown.stop="store.actions.handleArUiInteraction()"
					@click.stop
				/>
			</div>
		</div>

		<transition name="sheet-fade">
			<section
				v-if="hasArSession && ui.drawerOpen"
				class="bottom-sheet"
				@pointerdown.stop="store.actions.handleArUiInteraction()"
				@click.stop
			>
				<div class="sheet-header">
					<div class="sheet-tabs">
						<button
							v-for="item in PANEL_OPTIONS"
							:key="item.value"
							type="button"
							class="sheet-tab"
							:class="{ active: activePanelView === item.value }"
							@click="activatePanelView(item.value)"
						>
							{{ item.label }}
						</button>
					</div>
					<button type="button" class="sheet-close" @click="store.actions.toggleDrawer()">
						{{ TEXT.closePanel }}
					</button>
				</div>

				<template v-if="activePanelView === 'overview'">
					<ArPanelSection :title="TEXT.sessionOverview" first>
						<ArInfoGrid :items="sessionSnapshotCards" />
						<div class="runtime-banner">{{ runtimeStatusText }}</div>
					</ArPanelSection>
				</template>

				<template v-else-if="activePanelView === 'placement'">
					<div class="sheet-section">
						<div class="section-label">{{ TEXT.placementActions }}</div>
						<div class="runtime-banner">应用配准放置会基于当前配准结果固定模型；应用平面临放仅按当前识别平面临时放置。</div>
						<div class="action-row">
							<button type="button" class="action-button primary" @click="handleApplyLocalizedPlacement()">
								{{ TEXT.placeModel }}
							</button>
							<button type="button" class="action-button" @click="handleApplyHitTestPlacement()">
								{{ TEXT.placeHitTest }}
							</button>
							<button type="button" class="action-button" @click="store.actions.resetPlacement()">
								{{ TEXT.resetPlacement }}
							</button>
						</div>
					</div>
				</template>

				<template v-else-if="activePanelView === 'display'">
					<div class="sheet-section">
						<div class="section-label">{{ TEXT.displayMode }}</div>
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
					</div>

					<div v-if="engine.displayMode === 'section-cut'" class="sheet-section">
						<div class="section-label">{{ TEXT.sectionPlane }}</div>
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
					</div>

					<div class="sheet-section">
						<div class="section-label">{{ TEXT.projectStage }}</div>
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
					</div>
				</template>

				<template v-else>
					<div class="sheet-section">
						<div class="section-label">{{ TEXT.precisionCalibration }}</div>
						<ArInfoGrid :items="markerCalibrationCards" />
						<div class="chip-grid">
							<button type="button" class="chip-button" @click="handleStartPrecisionCalibration()">
								{{ TEXT.startCollect }}
							</button>
							<button type="button" class="chip-button" @click="store.actions.captureCurrentSessionMarkerCorner()">
								{{ TEXT.captureCorner }}
							</button>
							<button type="button" class="chip-button active" @click="handleSolvePrecisionCalibration()">
								{{ TEXT.solveApply }}
							</button>
							<button type="button" class="chip-button" @click="store.actions.resetCurrentSessionMarkerCalibration()">
								{{ TEXT.resetMarker }}
							</button>
							<button type="button" class="chip-button" @click="store.actions.clearMarkerLocalizationCorrection()">
								{{ TEXT.clearMarker }}
							</button>
						</div>
					</div>

					<div class="sheet-section">
						<div class="section-label">{{ TEXT.manualAdjustment }}</div>
						<div class="chip-grid">
							<button
								v-for="item in MANUAL_PRESET_OPTIONS"
								:key="item.value"
								type="button"
								class="chip-button"
								:class="{ active: engine.manualAdjustmentPreset === item.value }"
								@click="store.actions.setManualAdjustmentPreset(item.value)"
							>
								{{ item.label }}
							</button>
						</div>
						<ArInfoGrid :items="manualAdjustmentCards" />
						<div class="adjust-grid">
							<div class="adjust-row">
								<span>{{ TEXT.xAxis }}</span>
								<button type="button" class="adjust-button" @click="store.actions.adjustTranslation('x', -1)">{{ TEXT.negative }}</button>
								<button type="button" class="adjust-button" @click="store.actions.adjustTranslation('x', 1)">{{ TEXT.positive }}</button>
							</div>
							<div class="adjust-row">
								<span>{{ TEXT.yAxis }}</span>
								<button type="button" class="adjust-button" @click="store.actions.adjustTranslation('y', -1)">{{ TEXT.negative }}</button>
								<button type="button" class="adjust-button" @click="store.actions.adjustTranslation('y', 1)">{{ TEXT.positive }}</button>
							</div>
							<div class="adjust-row">
								<span>{{ TEXT.zAxis }}</span>
								<button type="button" class="adjust-button" @click="store.actions.adjustTranslation('z', -1)">{{ TEXT.negative }}</button>
								<button type="button" class="adjust-button" @click="store.actions.adjustTranslation('z', 1)">{{ TEXT.positive }}</button>
							</div>
							<div class="adjust-row">
								<span>{{ TEXT.yaw }}</span>
								<button type="button" class="adjust-button" @click="store.actions.adjustYaw(-1)">{{ TEXT.negative }}</button>
								<button type="button" class="adjust-button" @click="store.actions.adjustYaw(1)">{{ TEXT.positive }}</button>
							</div>
							<div class="adjust-row">
								<span>{{ TEXT.scale }}</span>
								<button type="button" class="adjust-button" @click="store.actions.adjustScale(-1)">{{ TEXT.negative }}</button>
								<button type="button" class="adjust-button" @click="store.actions.adjustScale(1)">{{ TEXT.positive }}</button>
							</div>
						</div>
						<div class="action-row">
							<button type="button" class="action-button primary" @click="store.actions.saveManualRegistration()">
								{{ TEXT.saveManual }}
							</button>
							<button type="button" class="action-button" @click="store.actions.resetManualRegistration()">
								{{ TEXT.resetManual }}
							</button>
							<button type="button" class="action-button" @click="store.actions.clearSavedRegistration()">
								{{ TEXT.clearSavedManual }}
							</button>
						</div>
					</div>

					<div class="sheet-section">
						<div class="section-label">{{ TEXT.markerCalibration }}</div>
						<ArInfoGrid :items="calibrationGuideCards" />
					</div>

					<div class="sheet-section">
						<div class="section-label">{{ TEXT.gpsBias }}</div>
						<ArInfoGrid :items="gpsBiasCards" />
						<div class="action-row">
							<button type="button" class="action-button" @click="handleRefreshGps()">
								{{ TEXT.refreshGps }}
							</button>
							<button type="button" class="action-button" @click="handleEnableCoarseRegistration()">
								{{ TEXT.enableCoarse }}
							</button>
							<button type="button" class="action-button" @click="store.actions.saveGpsBiasCorrectionFromCurrentPose()">
								{{ TEXT.saveGpsBias }}
							</button>
							<button type="button" class="action-button" @click="store.actions.clearGpsBiasCorrection()">
								{{ TEXT.clearGpsBias }}
							</button>
						</div>
					</div>

					<div class="sheet-section">
						<div class="action-row">
							<button type="button" class="action-button primary" @click="store.actions.saveSiteCalibrationBaseline()">
								{{ TEXT.saveBaseline }}
							</button>
							<button type="button" class="action-button" @click="openMarkerDebug">
								{{ TEXT.markerDebug }}
							</button>
						</div>
					</div>
				</template>
			</section>
		</transition>

		<nav
			v-if="hasArSession"
			class="action-dock action-dock-compact"
			aria-label="AR 配准操作"
			@pointerdown.stop="store.actions.handleArUiInteraction()"
			@click.stop
		>
			<button type="button" class="dock-item dock-item-primary" @click.stop="toggleWorkspacePanel">
				<span class="dock-icon">板</span>
				<span class="dock-label">{{ TEXT.panelTool }}</span>
			</button>
			<button type="button" class="dock-item" @click.stop="store.actions.exitAr()">
				<span class="dock-icon">退</span>
				<span class="dock-label">{{ TEXT.exit }}</span>
			</button>
		</nav>

		<AppTabBar v-if="!hasArSession" />
	</div>
</template>

<style scoped>
.calibration-page {
	min-height: 100vh;
	background: linear-gradient(180deg, #07101b 0%, #0b1625 100%);
	color: #eff6ff;
}

.calibration-page.ar-active {
	background: transparent;
}

.page-scroll {
	position: relative;
	padding: max(16px, env(safe-area-inset-top)) 16px calc(102px + env(safe-area-inset-bottom));
}

.calibration-page.ar-active .page-scroll {
	padding: max(12px, env(safe-area-inset-top)) 12px calc(110px + env(safe-area-inset-bottom));
}

.page-header {
	position: relative;
	z-index: 22;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}

.page-title {
	font-size: 24px;
	font-weight: 700;
}

.page-subtitle {
	margin-top: 4px;
	font-size: 12px;
	color: rgba(210, 225, 255, 0.72);
}

.status-chip {
	display: inline-flex;
	align-items: center;
	padding: 8px 12px;
	border-radius: 999px;
	border: 1px solid rgba(69, 208, 255, 0.24);
	background: rgba(0, 212, 255, 0.08);
	font-size: 12px;
	color: #bff3ff;
	backdrop-filter: blur(10px);
}

.scene-shell {
	position: relative;
	height: min(52vh, 500px);
	margin-top: 18px;
	border-radius: 24px;
	overflow: hidden;
	border: 1px solid rgba(69, 208, 255, 0.18);
	background: rgba(8, 14, 24, 0.86);
}

.calibration-page.ar-active .scene-shell {
	position: fixed;
	inset: 0;
	height: 100dvh;
	margin-top: 0;
	border: 0;
	border-radius: 0;
	background: transparent;
	z-index: 1;
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
	pointer-events: none;
}

.launch-overlay {
	position: absolute;
	inset: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	padding: 24px;
	background: linear-gradient(180deg, rgba(8, 13, 24, 0.78), rgba(8, 13, 24, 0.56));
	backdrop-filter: blur(10px);
	text-align: center;
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
	font-size: 28px;
	font-weight: 700;
}

.launch-subtitle {
	margin: 10px 0 0;
	max-width: 360px;
	font-size: 13px;
	line-height: 1.6;
	color: rgba(220, 234, 255, 0.76);
}

.model-field {
	display: grid;
	gap: 8px;
	width: min(320px, 100%);
	margin-top: 18px;
	text-align: left;
}

.model-field span {
	font-size: 12px;
	color: rgba(210, 225, 255, 0.72);
}

.select-field {
	width: 100%;
	padding: 12px 14px;
	border-radius: 14px;
	border: 1px solid rgba(255, 255, 255, 0.08);
	background: rgba(255, 255, 255, 0.06);
	color: #eff6ff;
}

.launch-actions,
.action-row {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
}

.launch-actions {
	margin-top: 18px;
	justify-content: center;
}

.launch-button,
.secondary-button,
.dock-item,
.sheet-tab,
.sheet-close,
.chip-button,
.action-button,
.adjust-button {
	border: 0;
}

.launch-button,
.secondary-button {
	padding: 12px 22px;
	border-radius: 999px;
	font-size: 14px;
	font-weight: 700;
}

.launch-button,
.action-button.primary,
.dock-item-primary,
.chip-button.active,
.sheet-tab.active {
	background: rgba(0, 212, 255, 0.16);
	border-color: rgba(0, 212, 255, 0.34);
	color: #fff;
}

.launch-button {
	background: #11c9ff;
	color: #031019;
}

.secondary-button,
.sheet-close,
.sheet-tab,
.chip-button,
.action-button,
.adjust-button {
	padding: 10px 14px;
	border-radius: 14px;
	background: rgba(255, 255, 255, 0.04);
	color: rgba(225, 236, 255, 0.74);
	font-size: 12px;
	border: 1px solid rgba(255, 255, 255, 0.08);
}

.summary-card {
	margin-top: 16px;
	padding: 16px;
	border-radius: 22px;
	background: rgba(12, 22, 36, 0.9);
	border: 1px solid rgba(94, 194, 255, 0.12);
	box-shadow: 0 16px 30px rgba(0, 0, 0, 0.18);
}

.summary-grid,
.info-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 10px;
}

.summary-item,
.info-card {
	padding: 12px;
	border-radius: 16px;
	background: rgba(255, 255, 255, 0.04);
	border: 1px solid rgba(255, 255, 255, 0.06);
}

.summary-item span,
.info-card span {
	display: block;
	font-size: 11px;
	color: rgba(210, 225, 255, 0.64);
}

.summary-item strong,
.info-card strong {
	display: block;
	margin-top: 6px;
	font-size: 13px;
	font-weight: 600;
	word-break: break-word;
}

.info-card.wide {
	grid-column: 1 / -1;
}

.side-slider {
	position: fixed;
	right: 8px;
	top: 50%;
	transform: translateY(-50%);
	z-index: 34;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 10px;
	padding: 12px 8px;
	border-radius: 18px;
	background: rgba(7, 12, 21, 0.74);
	backdrop-filter: blur(16px);
	border: 1px solid rgba(255, 255, 255, 0.08);
	box-shadow: 0 16px 34px rgba(0, 0, 0, 0.24);
	pointer-events: none;
}

.side-slider-text {
	min-width: 92px;
	padding: 6px 10px;
	border-radius: 999px;
	background: rgba(0, 212, 255, 0.12);
	color: #d8f8ff;
	font-size: 11px;
	font-weight: 600;
	line-height: 1;
	text-align: center;
	white-space: nowrap;
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

.action-dock {
	position: fixed;
	left: 12px;
	right: 12px;
	bottom: calc(12px + env(safe-area-inset-bottom));
	z-index: 36;
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 10px;
	padding: 10px;
	border-radius: 22px;
	background: rgba(7, 12, 21, 0.88);
	backdrop-filter: blur(18px);
	border: 1px solid rgba(255, 255, 255, 0.08);
	box-shadow: 0 18px 42px rgba(0, 0, 0, 0.28);
}

.action-dock-compact {
	grid-template-columns: repeat(2, minmax(0, 1fr));
}

.dock-item {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 6px;
	min-height: 54px;
	border-radius: 16px;
	background: rgba(255, 255, 255, 0.04);
	color: rgba(225, 236, 255, 0.78);
	border: 1px solid rgba(255, 255, 255, 0.06);
}

.dock-item-primary {
	background: rgba(0, 212, 255, 0.16);
	border-color: rgba(0, 212, 255, 0.32);
	color: #fff;
}

.dock-icon {
	font-size: 15px;
	font-weight: 700;
	line-height: 1;
}

.dock-label {
	font-size: 11px;
	line-height: 1;
}

.bottom-sheet {
	position: fixed;
	left: 12px;
	right: 12px;
	bottom: calc(92px + env(safe-area-inset-bottom));
	z-index: 38;
	height: min(58vh, 520px);
	padding: 14px;
	overflow-y: auto;
	border-radius: 24px;
	background: rgba(10, 16, 28, 0.94);
	backdrop-filter: blur(22px);
	border: 1px solid rgba(255, 255, 255, 0.08);
	box-shadow: 0 20px 40px rgba(0, 0, 0, 0.28);
}

.sheet-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	margin-bottom: 10px;
}

.sheet-tabs {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.sheet-section-first {
	margin-top: 0;
	padding-top: 0;
	border-top: 0;
}

.sheet-section + .sheet-section {
	margin-top: 14px;
	padding-top: 14px;
	border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.section-label {
	font-size: 12px;
	font-weight: 600;
	color: rgba(226, 236, 255, 0.88);
}

.chip-grid {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin-top: 10px;
}

.runtime-banner {
	margin-top: 10px;
	padding: 10px 12px;
	border-radius: 14px;
	background: rgba(0, 212, 255, 0.08);
	border: 1px solid rgba(0, 212, 255, 0.18);
	font-size: 12px;
	color: #d5f7ff;
}

.adjust-grid {
	display: grid;
	gap: 8px;
	margin-top: 12px;
}

.adjust-row {
	display: grid;
	grid-template-columns: minmax(64px, 1fr) 72px 72px;
	gap: 8px;
	align-items: center;
}

.adjust-row span {
	font-size: 12px;
	color: rgba(220, 234, 255, 0.84);
}

.sheet-fade-enter-active,
.sheet-fade-leave-active {
	transition: opacity 0.22s ease, transform 0.22s ease;
}

.sheet-fade-enter-from,
.sheet-fade-leave-to {
	opacity: 0;
	transform: translateY(10px);
}

@media (max-width: 420px) {
	.page-title {
		font-size: 21px;
	}

	.launch-title {
		font-size: 22px;
	}

	.summary-grid,
	.info-grid {
		grid-template-columns: 1fr;
	}

	.side-slider {
		right: 4px;
		padding: 10px 6px;
	}

	.side-slider-range {
		width: 152px;
	}

	.action-dock {
		gap: 8px;
		padding: 8px;
	}

	.bottom-sheet {
		bottom: calc(88px + env(safe-area-inset-bottom));
		height: min(62vh, 540px);
	}

	.adjust-row {
		grid-template-columns: 1fr 1fr 1fr;
	}
}
</style>

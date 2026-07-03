<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppTabBar from '../components/AppTabBar.vue';
import {
	DISPLAY_MODE_OPTIONS,
	SECTION_CUT_PLANE_MODE_OPTIONS,
	getDisplayModeLabel,
	getDisplayModeSliderValueText
} from '@/features/ar/types/display-modes.js';
import { useArShellStore } from '@/features/ar/stores/ar-shell.js';
import type { ManualAdjustmentPreset } from '@/localization/manual/manual-registration.js';

type CalibrationPanelView = 'placement' | 'display' | 'calibration';

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
	placement: '放置',
	display: '视图',
	calibration: '校准',
	exit: '退出',
	closePanel: '收起面板',
	placementMode: '放置方式',
	placementLocalized: '按定位固定',
	placementTemporary: '临时放到平面',
	placeModel: '手动场景定位',
	placeHitTest: '放到识别平面',
	resetPlacement: '重置放置',
	placementSummary: '当前放置',
	displayMode: '查看模式',
	sectionPlane: '剖切方向',
	projectStage: '工程阶段',
	panelStatus: '当前状态',
	markerCalibration: '控制标志校准',
	precisionCalibration: '精确配准',
	startCollect: '开始校准',
	captureCorner: '采集角点',
	solveApply: '完成校准',
	resetMarker: '重置角点',
	clearMarker: '清除校准',
	cornersCollected: '已采集角点',
	nextCorner: '下一角点',
	manualAdjustment: '手动微调',
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
	saveManual: '保存微调',
	resetManual: '重置微调',
	clearSavedManual: '清除已存微调',
	gpsBias: 'GPS 偏差',
	refreshGps: '刷新 GPS',
	enableCoarse: '启用粗配准',
	saveGpsBias: '记录当前位置',
	clearGpsBias: '清除记录',
	saveBaseline: '保存现场基准',
	markerDebug: '调试页',
	unknownModel: '未选择站点'
} as const;

const PANEL_OPTIONS: Array<{ value: CalibrationPanelView; label: string }> = [
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
const activePanelView = ref<CalibrationPanelView>( 'placement' );

const engine = computed( () => store.engine );
const hasArSession = computed( () => engine.value.appMode === 'ar-session' );
const currentModelName = computed(
	() => engine.value.availableModels.find( ( item ) => item.id === engine.value.selectedModelId )?.name ?? TEXT.unknownModel
);
const runtimeStatusText = computed( () => engine.value.runtimeStatus );
const panelStatusCards = computed( () => [
	{ label: '运行状态', value: engine.value.runtimeStatus },
	{ label: '配准状态', value: engine.value.registrationStatusDetail },
	{ label: '粗配准', value: engine.value.coarseLocationDebugText },
	{ label: '定位来源', value: engine.value.registrationChainDebug.arSessionLocalization.source || '-' }
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

async function handleEnableCoarseRegistration(): Promise<void> {
	await store.actions.enableCoarseRegistration();
}

async function handleRefreshGps(): Promise<void> {
	await store.actions.refreshGeoLocation();
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
				<div class="summary-grid">
					<div class="summary-item">
						<span>现场基准</span>
						<strong>{{ engine.siteCalibrationBaseline.statusText }}</strong>
					</div>
					<div class="summary-item">
						<span>控制点</span>
						<strong>{{ engine.siteCalibrationBaseline.controlTargetCount }}</strong>
					</div>
					<div class="summary-item">
						<span>GPS 偏差</span>
						<strong>{{ engine.siteCalibrationBaseline.gpsBiasAvailable ? '已保存' : '未保存' }}</strong>
					</div>
					<div class="summary-item">
						<span>显示模式</span>
						<strong>{{ getDisplayModeLabel(engine.displayMode) }}</strong>
					</div>
				</div>
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
			<section v-if="hasArSession" class="bottom-sheet" @pointerdown.stop="store.actions.handleArUiInteraction()" @click.stop>
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
				</div>

				<div class="sheet-section sheet-section-first">
					<div class="section-label">{{ TEXT.panelStatus }}</div>
					<div class="info-grid">
						<div v-for="item in panelStatusCards" :key="item.label" class="info-card" :class="{ wide: item.label === '粗配准' }">
							<span>{{ item.label }}</span>
							<strong>{{ item.value }}</strong>
						</div>
					</div>
					<div class="runtime-banner">{{ runtimeStatusText }}</div>
				</div>

				<template v-if="activePanelView === 'placement'">
					<div class="sheet-section">
						<div class="section-label">{{ TEXT.placementMode }}</div>
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
					</div>

					<div class="sheet-section">
						<div class="section-label">{{ TEXT.placementSummary }}</div>
						<div class="info-grid">
							<div class="info-card">
								<span>位置</span>
								<strong>{{ engine.placementSummary.positionText }}</strong>
							</div>
							<div class="info-card">
								<span>旋转</span>
								<strong>{{ engine.placementSummary.quaternionText }}</strong>
							</div>
							<div class="info-card">
								<span>缩放</span>
								<strong>{{ engine.placementSummary.scaleText }}</strong>
							</div>
							<div class="info-card">
								<span>定位来源</span>
								<strong>{{ engine.registrationChainDebug.arSessionLocalization.source || '-' }}</strong>
							</div>
						</div>
						<div class="action-row">
							<button type="button" class="action-button primary" @click="store.actions.placeModel()">
								{{ TEXT.placeModel }}
							</button>
							<button type="button" class="action-button" @click="store.actions.placeModelAtHitTest()">
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
						<div class="info-grid">
							<div class="info-card">
								<span>{{ TEXT.cornersCollected }}</span>
								<strong>{{ engine.markerCalibration.capturedCornerCount }}/{{ engine.markerCalibration.expectedCornerCount }}</strong>
							</div>
							<div class="info-card">
								<span>{{ TEXT.nextCorner }}</span>
								<strong>{{ engine.markerCalibration.nextCornerLabel || '-' }}</strong>
							</div>
						</div>
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
						<div class="info-grid">
							<div class="info-card wide">
								<span>位置偏移</span>
								<strong>{{ engine.manualReadout.positionText }}</strong>
							</div>
							<div class="info-card">
								<span>旋转</span>
								<strong>{{ engine.manualReadout.yawText }}</strong>
							</div>
							<div class="info-card">
								<span>缩放</span>
								<strong>{{ engine.manualReadout.scaleText }}</strong>
							</div>
						</div>
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
						<div class="info-grid">
							<div class="info-card wide">
								<span>提示</span>
								<strong>先点开始校准，再依次采集 4 个角点，最后点完成校准。</strong>
							</div>
						</div>
					</div>

					<div class="sheet-section">
						<div class="section-label">{{ TEXT.gpsBias }}</div>
						<div class="info-grid">
							<div class="info-card wide">
								<span>状态</span>
								<strong>{{ engine.gpsBiasCorrection.statusText }}</strong>
							</div>
							<div class="info-card">
								<span>偏差</span>
								<strong>{{ engine.gpsBiasCorrection.deltaEnuText }}</strong>
							</div>
							<div class="info-card">
								<span>更新时间</span>
								<strong>{{ engine.gpsBiasCorrection.updatedAtText }}</strong>
							</div>
						</div>
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
.sheet-tab,
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

.bottom-sheet {
	position: fixed;
	left: 12px;
	right: 12px;
	bottom: calc(12px + env(safe-area-inset-bottom));
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

	.bottom-sheet {
		height: min(62vh, 540px);
	}

	.adjust-row {
		grid-template-columns: 1fr 1fr 1fr;
	}
}
</style>

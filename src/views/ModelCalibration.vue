<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ArInfoGrid from '@/components/ar/ArInfoGrid.vue';
import ArModelInfoPanel from '@/components/ar/ArModelInfoPanel.vue';
import ArPanelSection from '@/components/ar/ArPanelSection.vue';
import ArPlacementStatusSection from '@/components/ar/ArPlacementStatusSection.vue';
import {
	DISPLAY_MODE_OPTIONS,
	SECTION_CUT_PLANE_MODE_OPTIONS,
	getDisplayModeLabel
} from '@/features/ar/types/display-modes.js';
import { useArShellStore } from '@/features/ar/stores/ar-shell.js';
import type { ManualAdjustmentPreset } from '@/localization/manual/manual-registration.js';

type CalibrationPanelView = 'overview' | 'config' | 'marker' | 'ar-check' | 'display' | 'debug';

const TEXT = {
	title: '现场基准配置',
	subtitle: '工程真值校验',
	enterArTitle: '进入 AR 校验',
	enterArSub: '本页面用于校验模型配置、RTK 工程真值和控制标志，不保存当前 AR 会话矩阵、XR anchor 或 modelRoot.position。',
	enterAr: '进入 AR 校验',
	selectModel: '选择站点',
	status: '状态',
	waiting: '待进入 AR',
	scanning: '正在扫描平面',
	ready: '平面已检测',
	placing: '正在应用校验放置',
	placed: '校验中',
	panelTool: '校验面板',
	exit: '退出 AR',
	closePanel: '收起',
	overview: '总览',
	config: '配置检查',
	marker: '控制标志',
	arCheck: 'AR 校验',
	display: '显示控制',
	debug: '调试',
	displayMode: '模型显示',
	sectionPlane: '剖切方向',
	startCollect: '开始四角点采集',
	captureCorner: '采集当前角点',
	solveApply: '完成校验校正',
	resetMarker: '重置角点',
	clearMarker: '清除本次校正',
	saveBaseline: '保存基准确认',
	markerDebug: '打开调试页',
	temporaryPlacement: '临时演示放置',
	localizedPlacement: '按校正结果放置',
	resetPlacement: '清除当前放置',
	manualAdjustment: '手动校验调整',
	saveManual: '保存手动校验结果',
	resetManual: '重置本次调整',
	clearSavedManual: '清除已存调整',
	unknownModel: '未选择站点'
} as const;

const PANEL_OPTIONS: Array<{ value: CalibrationPanelView; label: string }> = [
	{ value: 'overview', label: TEXT.overview },
	{ value: 'config', label: TEXT.config },
	{ value: 'marker', label: TEXT.marker },
	{ value: 'ar-check', label: TEXT.arCheck },
	{ value: 'display', label: TEXT.display },
	{ value: 'debug', label: TEXT.debug }
];

const MANUAL_PRESET_OPTIONS: Array<{ value: ManualAdjustmentPreset; label: string }> = [
	{ value: 'fine', label: '细调' },
	{ value: 'medium', label: '中调' },
	{ value: 'coarse', label: '粗调' }
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
const configStatus = computed( () => engine.value.engineeringConfigStatus );
const currentModel = computed(
	() => engine.value.availableModels.find( ( item ) => item.id === engine.value.selectedModelId )
);
const currentModelName = computed( () => currentModel.value?.name ?? TEXT.unknownModel );
const currentConfigUrl = computed( () => currentModel.value?.configUrl ?? '-' );

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

const overviewCards = computed( () => [
	{ label: '当前站点', value: currentModelName.value },
	{ label: '配置 JSON', value: currentConfigUrl.value, wide: true },
	{ label: 'RTK 工程真值', value: configStatus.value.hasRtkSurveyDataset ? `已加载 ${configStatus.value.rtkPointCount} 点` : '未加载' },
	{ label: '控制标志', value: configStatus.value.hasControlTargets ? `已配置 ${configStatus.value.controlTargetCount} 个` : '未配置' },
	{ label: '控制标志来源', value: configStatus.value.controlTargetSourceText },
	{ label: '当前显示', value: getDisplayModeLabel( engine.value.displayMode ) }
] );

const configCards = computed( () => [
	{ label: 'siteOrigin', value: configStatus.value.hasSiteOrigin ? configStatus.value.siteOriginText : '未配置', wide: true },
	{ label: 'modelLocalToEnu', value: configStatus.value.hasModelLocalToEnu ? '已配置' : '未配置' },
	{ label: 'rtkSurveyDataset', value: configStatus.value.hasRtkSurveyDataset ? `已加载 ${configStatus.value.rtkPointCount} 点` : '未加载' },
	{ label: 'controlTargets', value: configStatus.value.hasControlTargets ? `${configStatus.value.controlTargetCount} 个` : '未配置' },
	{ label: 'placementAnchorEnu', value: configStatus.value.hasPlacementAnchor ? configStatus.value.placementAnchorText : '未配置', wide: true },
	{ label: 'undergroundObjects', value: `${configStatus.value.undergroundObjectCount} 个` },
	{ label: 'sensors', value: `${configStatus.value.sensorCount} 个` },
	{ label: 'riskPoints', value: `${configStatus.value.riskPointCount} 个` }
] );

const configWarnings = computed( () => {
	const warnings: string[] = [];
	if ( configStatus.value.hasRtkSurveyDataset === false ) {
		warnings.push( '当前模型未配置 RTK 测量数据，请先补充工程真值配置。' );
	}
	if ( configStatus.value.hasControlTargets === false ) {
		warnings.push( '当前模型未配置控制标志，无法进行正式 AR 空间校正。' );
	}
	if ( configStatus.value.hasPlacementAnchor === false ) {
		warnings.push( '当前模型未配置地面参考点，手动场景定位可能不可用。' );
	}
	if ( configStatus.value.baselineMismatch ) {
		warnings.push( '当前已保存现场基准与模型配置可能不一致，请确认是否更新基准配置。' );
	}
	return warnings;
} );

const markerCards = computed( () => {
	if ( configStatus.value.controlTargetSummaries.length === 0 ) {
		return [ { label: '控制标志', value: '未配置', wide: true } ];
	}

	return configStatus.value.controlTargetSummaries.flatMap( ( target, index ) => [
		{ label: `Marker ${index + 1}`, value: `${target.name} / ${target.id}`, wide: true },
		{ label: 'imageUrl', value: target.imageUrl, wide: true },
		{ label: 'centerEnu', value: target.centerEnuText, wide: true },
		{ label: 'cornersEnu', value: target.cornersEnuText, wide: true },
		{ label: 'yawDeg', value: target.yawDegText },
		{ label: 'sizeMeters', value: target.sizeMetersText },
		{ label: 'trackingWidthMeters', value: target.trackingWidthMetersText },
		{ label: 'plane', value: target.planeText }
	] );
} );

const markerCalibrationCards = computed( () => [
	{ label: '目标 Marker', value: configStatus.value.controlTargetSummaries[ 0 ]?.name ?? engine.value.markerCalibration.markerId ?? '-' },
	{ label: 'Marker id', value: engine.value.markerCalibration.markerId ?? configStatus.value.activeControlTargetId ?? '-' },
	{ label: '当前要采集', value: engine.value.markerCalibration.nextCornerLabel || '-' },
	{ label: '已采集数量', value: `${engine.value.markerCalibration.capturedCornerCount}` },
	{ label: '角点总数', value: `${engine.value.markerCalibration.expectedCornerCount}` },
	{ label: '失败原因', value: engine.value.runtimeStatus || '-', wide: true }
] );

const manualAdjustmentCards = computed( () => [
	{ label: '平移偏移', value: engine.value.manualReadout.positionText, wide: true },
	{ label: '航向修正', value: engine.value.manualReadout.yawText },
	{ label: '比例修正', value: engine.value.manualReadout.scaleText }
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

watch( hasArSession, syncArOverlayClass, { immediate: true } );

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

async function handleApplyLocalizedPlacement(): Promise<void> {
	store.actions.setPlacementMode( 'localized' );
	await store.actions.placeModel();
}

function handleApplyHitTestPlacement(): void {
	store.actions.setPlacementMode( 'hit-test-temporary' );
	console.info( '[ArUiTemporaryPlacementWarningShown]', {
		mode: engine.value.workflowMode,
		siteId: engine.value.selectedModelId || null,
		modelId: engine.value.selectedModelId || null,
		sessionId: engine.value.markerCalibration.currentSessionId,
		currentStep: 'debug-temporary-placement',
		localizationSource: engine.value.registrationChainDebug.arSessionLocalization.source,
		targetId: configStatus.value.activeControlTargetId ?? null,
		message: '临时演示放置仅用于调试展示，不代表工程真实位置'
	} );
	store.actions.placeModelAtHitTest();
}

function handleStartPrecisionCalibration(): void {
	activePanelView.value = 'ar-check';
	store.actions.startCurrentSessionMarkerCalibration();
}

function handleSolvePrecisionCalibration(): void {
	activePanelView.value = 'ar-check';
	store.actions.solveAndApplyCurrentSessionMarkerCalibration();
}

function handleSaveBaseline(): void {
	console.info( '[ArUiConfigStatusResolved]', {
		mode: engine.value.workflowMode,
		siteId: engine.value.selectedModelId || null,
		modelId: engine.value.selectedModelId || null,
		sessionId: engine.value.markerCalibration.currentSessionId,
		currentStep: 'load-config',
		localizationSource: engine.value.registrationChainDebug.arSessionLocalization.source,
		targetId: configStatus.value.activeControlTargetId ?? null,
		message: '仅保存配置确认状态和备注，不保存 ENU -> AR local、XR anchor 或 modelRoot.position'
	} );
	store.actions.saveSiteCalibrationBaseline();
}

function openMarkerDebug(): void {
	void router.push( '/marker-debug' );
}

onMounted( () => {
	void mountEngineHosts();
	store.actions.setWorkflowMode( 'site-baseline-config' );
} );

onUnmounted( () => {
	setArOverlayClass( false );
} );

function syncArOverlayClass(active: boolean): void {
	setArOverlayClass( active );
}

function setArOverlayClass(active: boolean): void {
	document.documentElement.classList.toggle( 'ar-dom-overlay-active', active );
	document.body.classList.toggle( 'ar-dom-overlay-active', active );
}
</script>

<template>
	<div class="calibration-page" :class="{ 'ar-active': hasArSession }" @click="store.actions.handleArUiInteraction()">
		<div class="page-scroll">
			<header class="page-header" @pointerdown.stop="store.actions.handleArUiInteraction()" @click.stop>
				<div>
					<div class="page-title">{{ TEXT.title }}</div>
					<div class="page-subtitle">{{ TEXT.subtitle }}：{{ currentModelName }}</div>
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
					<div class="launch-badge">RTK</div>
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
					<button type="button" class="launch-button" @click.stop="startArSession">
						{{ TEXT.enterAr }}
					</button>
				</div>
			</section>

			<div v-if="sliderVisible" class="side-slider">
				<input
					v-model="sliderValue"
					class="side-slider-range"
					type="range"
					min="0"
					max="100"
					step="1"
					aria-label="模型显示强度"
					@pointerdown.stop="store.actions.handleArUiInteraction()"
					@click.stop
				>
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
					<ArPanelSection title="配置校验总览" first>
						<ArInfoGrid :items="overviewCards" />
						<div class="runtime-banner">
							RTK 测量数据用于建立工程真值。本页面用于校验模型配置、控制标志和现场空间关系，不保存本次 AR 会话矩阵。
						</div>
						<div class="runtime-banner">
							当前静态 JSON 需要在配置文件或后端中修改，浏览器运行时不会直接写回 public JSON。
						</div>
					</ArPanelSection>
				</template>

				<template v-else-if="activePanelView === 'config'">
					<ArPanelSection title="工程真值配置检查" first>
						<ArInfoGrid :items="configCards" />
						<div v-for="warning in configWarnings" :key="warning" class="runtime-banner warning">
							{{ warning }}
						</div>
					</ArPanelSection>
				</template>

				<template v-else-if="activePanelView === 'marker'">
					<ArPanelSection title="控制标志详情" first>
						<ArInfoGrid :items="markerCards" />
						<div class="runtime-banner">
							一个带方向 Marker 可以完成当前会话配准；普通无方向控制点只能确定位置，不能稳定确定朝向。普通控制点方案建议至少两个点，或一个点 + 手动 yaw 校正。
						</div>
					</ArPanelSection>
				</template>

				<template v-else-if="activePanelView === 'ar-check'">
					<ArPlacementStatusSection :state="engine" title="AR 校验状态" first />
					<ArPanelSection title="手动四角点校验">
						<ArInfoGrid :items="markerCalibrationCards" />
						<div class="runtime-banner">
							请按 leftTop 左上角、rightTop 右上角、rightBottom 右下角、leftBottom 左下角的顺序采集控制标志四角。
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
					</ArPanelSection>
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
				</template>

				<template v-else>
					<div class="sheet-section">
						<div class="section-label">调试 / 临时演示</div>
						<div class="runtime-banner warning">
							临时演示放置和手动校验调整仅用于调试展示，不代表工程真实位置，不应作为正式巡查定位结果。
						</div>
						<div class="action-row">
							<button type="button" class="action-button" @click="handleApplyLocalizedPlacement()">
								{{ TEXT.localizedPlacement }}
							</button>
							<button type="button" class="action-button" @click="handleApplyHitTestPlacement()">
								{{ TEXT.temporaryPlacement }}
							</button>
							<button type="button" class="action-button" @click="store.actions.resetPlacement()">
								{{ TEXT.resetPlacement }}
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
								<span>X 轴</span>
								<button type="button" class="adjust-button" @click="store.actions.adjustTranslation('x', -1)">负向</button>
								<button type="button" class="adjust-button" @click="store.actions.adjustTranslation('x', 1)">正向</button>
							</div>
							<div class="adjust-row">
								<span>Y 轴</span>
								<button type="button" class="adjust-button" @click="store.actions.adjustTranslation('y', -1)">负向</button>
								<button type="button" class="adjust-button" @click="store.actions.adjustTranslation('y', 1)">正向</button>
							</div>
							<div class="adjust-row">
								<span>Z 轴</span>
								<button type="button" class="adjust-button" @click="store.actions.adjustTranslation('z', -1)">负向</button>
								<button type="button" class="adjust-button" @click="store.actions.adjustTranslation('z', 1)">正向</button>
							</div>
							<div class="adjust-row">
								<span>旋转</span>
								<button type="button" class="adjust-button" @click="store.actions.adjustYaw(-1)">负向</button>
								<button type="button" class="adjust-button" @click="store.actions.adjustYaw(1)">正向</button>
							</div>
							<div class="adjust-row">
								<span>缩放</span>
								<button type="button" class="adjust-button" @click="store.actions.adjustScale(-1)">缩小</button>
								<button type="button" class="adjust-button" @click="store.actions.adjustScale(1)">放大</button>
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
						<div class="action-row">
							<button type="button" class="action-button primary" @click="handleSaveBaseline()">
								{{ TEXT.saveBaseline }}
							</button>
							<button type="button" class="action-button" @click="openMarkerDebug">
								{{ TEXT.markerDebug }}
							</button>
						</div>
						<div class="runtime-banner">
							仅保存配置确认状态和备注，不保存 ENU -> AR local、XR anchor 或 modelRoot.position。
						</div>
					</div>
				</template>
			</section>
		</transition>

		<nav
			v-if="hasArSession"
			class="action-dock action-dock-compact"
			aria-label="AR 校验操作"
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

		<ArModelInfoPanel
			v-if="hasArSession && ui.drawerOpen === false"
			:state="engine"
			@close="store.actions.closePropertyPanel()"
		/>
	</div>
</template>

<style scoped>
.calibration-page {
	min-height: 100vh;
	background: linear-gradient(180deg, #07101b 0%, #0b1625 100%);
	color: #eff6ff;
	font-size: 13px;
}

.calibration-page.ar-active {
	background: transparent;
}

:global(html.ar-dom-overlay-active),
:global(body.ar-dom-overlay-active),
:global(body.ar-dom-overlay-active #app) {
	background: transparent !important;
}

.page-scroll {
	position: relative;
	min-height: 100vh;
	overflow: hidden;
}

.page-header {
	position: fixed;
	z-index: 5;
	top: max(14px, env(safe-area-inset-top));
	left: 18px;
	right: 18px;
	display: flex;
	justify-content: space-between;
	gap: 12px;
	align-items: flex-start;
}

.page-title {
	font-size: 24px;
	font-weight: 800;
	letter-spacing: 0.03em;
	text-shadow: 0 2px 14px rgba(0, 0, 0, 0.32);
}

.page-subtitle {
	margin-top: 4px;
	font-size: 12px;
	color: rgba(239, 246, 255, 0.76);
}

.status-chip {
	padding: 8px 12px;
	border-radius: 999px;
	background: rgba(15, 23, 42, 0.48);
	border: 1px solid rgba(255, 255, 255, 0.16);
	backdrop-filter: blur(18px);
	color: #dffaff;
	font-size: 12px;
	font-weight: 700;
}

.scene-shell,
.scene-layer {
	position: fixed;
	inset: 0;
	background: transparent;
}

.calibration-page.ar-active .scene-shell,
.calibration-page.ar-active .scene-layer {
	background: transparent;
}

.scene-layer :deep(canvas) {
	width: 100% !important;
	height: 100% !important;
	display: block;
	background: transparent !important;
}

.scene-hidden {
	position: absolute;
	inset: auto 0 0 auto;
	width: 1px;
	height: 1px;
	overflow: hidden;
	opacity: 0;
	pointer-events: none;
}

.launch-overlay {
	position: fixed;
	left: 20px;
	right: 20px;
	bottom: 92px;
	z-index: 6;
	padding: 18px;
	border-radius: 24px;
	background: rgba(8, 15, 27, 0.78);
	border: 1px solid rgba(255, 255, 255, 0.14);
	box-shadow: 0 26px 72px rgba(0, 0, 0, 0.38);
	backdrop-filter: blur(24px);
}

.launch-badge {
	width: 44px;
	height: 40px;
	display: grid;
	place-items: center;
	border-radius: 14px;
	background: #00d4ff;
	color: #00131a;
	font-weight: 900;
}

.launch-title {
	margin-top: 12px;
	font-size: 20px;
	font-weight: 800;
}

.launch-subtitle {
	margin: 8px 0 14px;
	color: rgba(226, 232, 240, 0.78);
	font-size: 13px;
	line-height: 1.6;
}

.model-field {
	display: grid;
	gap: 7px;
	color: rgba(226, 232, 240, 0.82);
	font-size: 12px;
}

.select-field {
	width: 100%;
	border: 1px solid rgba(148, 163, 184, 0.25);
	border-radius: 14px;
	background: rgba(15, 23, 42, 0.74);
	color: #eff6ff;
	padding: 10px 12px;
	outline: none;
	font-size: 13px;
}

.launch-button,
.action-button,
.chip-button,
.sheet-close,
.adjust-button {
	border: 0;
	color: #eff6ff;
	background: rgba(15, 23, 42, 0.82);
	border: 1px solid rgba(148, 163, 184, 0.22);
	border-radius: 14px;
	padding: 10px 12px;
	font-size: 12px;
	font-weight: 800;
}

.launch-button,
.action-button.primary,
.chip-button.active {
	background: linear-gradient(135deg, rgba(0, 212, 255, 0.34), rgba(20, 184, 166, 0.24));
	border-color: rgba(0, 212, 255, 0.44);
}

.launch-button {
	width: 100%;
	margin-top: 14px;
}

.action-dock {
	position: fixed;
	z-index: 7;
	left: 16px;
	right: 16px;
	bottom: max(14px, env(safe-area-inset-bottom));
	display: grid;
	grid-template-columns: 1.2fr 1fr;
	gap: 8px;
	padding: 8px;
	border-radius: 22px;
	background: rgba(8, 15, 27, 0.72);
	border: 1px solid rgba(255, 255, 255, 0.12);
	backdrop-filter: blur(24px);
}

.dock-item {
	min-height: 50px;
	border: 1px solid rgba(148, 163, 184, 0.18);
	border-radius: 16px;
	background: rgba(15, 23, 42, 0.82);
	color: #eff6ff;
	font-weight: 800;
}

.dock-item-primary {
	background: rgba(0, 212, 255, 0.18);
	border-color: rgba(0, 212, 255, 0.36);
}

.dock-icon,
.dock-label {
	display: block;
}

.dock-icon {
	font-size: 18px;
	line-height: 1;
}

.dock-label {
	font-size: 11px;
	margin-top: 2px;
}

.bottom-sheet {
	position: fixed;
	z-index: 8;
	left: 16px;
	right: 16px;
	bottom: calc(82px + env(safe-area-inset-bottom));
	max-height: 62vh;
	overflow: auto;
	padding: 14px;
	border-radius: 24px;
	background: rgba(8, 15, 27, 0.86);
	border: 1px solid rgba(255, 255, 255, 0.12);
	box-shadow: 0 28px 80px rgba(0, 0, 0, 0.42);
	backdrop-filter: blur(24px);
}

.sheet-header {
	display: flex;
	gap: 8px;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 12px;
}

.sheet-tabs,
.chip-grid,
.action-row {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
}

.sheet-tab {
	border: 1px solid rgba(148, 163, 184, 0.2);
	border-radius: 14px;
	background: rgba(15, 23, 42, 0.74);
	color: #dbeafe;
	padding: 9px 11px;
	font-size: 12px;
	font-weight: 800;
}

.sheet-tab.active {
	background: rgba(0, 212, 255, 0.2);
	border-color: rgba(0, 212, 255, 0.42);
	color: #fff;
}

.sheet-section {
	margin-top: 12px;
}

.section-label {
	margin-bottom: 8px;
	font-size: 13px;
	font-weight: 900;
	color: #e0f2fe;
}

.runtime-banner {
	margin-top: 10px;
	padding: 9px 11px;
	border-radius: 13px;
	background: rgba(0, 212, 255, 0.08);
	border: 1px solid rgba(0, 212, 255, 0.18);
	font-size: 12px;
	line-height: 1.55;
	color: #d5f7ff;
}

.runtime-banner.warning {
	background: rgba(245, 158, 11, 0.12);
	border-color: rgba(245, 158, 11, 0.28);
	color: #ffe8b6;
}

.adjust-grid {
	display: grid;
	gap: 10px;
	margin-top: 12px;
}

.adjust-row {
	display: grid;
	grid-template-columns: 72px 1fr 1fr;
	gap: 8px;
	align-items: center;
	color: #dbeafe;
	font-size: 12px;
}

.side-slider {
	position: fixed;
	z-index: 7;
	right: 12px;
	top: 50%;
	transform: translateY(-50%);
	padding: 16px 8px;
	border-radius: 999px;
	background: rgba(15, 23, 42, 0.46);
	border: 1px solid rgba(255, 255, 255, 0.18);
	box-shadow: 0 18px 54px rgba(0, 0, 0, 0.32);
	backdrop-filter: blur(20px);
}

.side-slider-range {
	writing-mode: vertical-lr;
	direction: rtl;
	width: 24px;
	height: 160px;
	accent-color: #00d4ff;
}

.sheet-fade-enter-active,
.sheet-fade-leave-active {
	transition: opacity 0.18s ease, transform 0.18s ease;
}

.sheet-fade-enter-from,
.sheet-fade-leave-to {
	opacity: 0;
	transform: translateY(12px);
}

@media (max-width: 720px) {
	.page-header {
		left: 14px;
		right: 14px;
	}

	.page-title {
		font-size: 22px;
	}

	.status-chip {
		max-width: 42vw;
		font-size: 11px;
	}
}
</style>

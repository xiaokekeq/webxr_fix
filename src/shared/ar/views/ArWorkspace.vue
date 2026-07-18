<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ArInfoGrid from '@/components/ar/ArInfoGrid.vue';
import ArFloatingValueRail from '@/components/ar/ArFloatingValueRail.vue';
import UndergroundDisplayControls from '@/components/ar/UndergroundDisplayControls.vue';
import ArPanelSection from '@/components/ar/ArPanelSection.vue';
import ArPlacementStatusSection from '@/components/ar/ArPlacementStatusSection.vue';
import PipePropertyHud from '@/shared/ar/components/PipePropertyHud.vue';
import { canApplyMockEngineeringCalibration } from '@/engine/session/registration-state-runtime.js';
import type { UndergroundInspectionTool, UndergroundMaterialMode } from '@/engine/visualization/underground-display-state.js';
import { useUndergroundDisplayControls } from '@/features/ar/composables/use-underground-display-controls.js';
import { useArShellStore } from '@/features/ar/stores/ar-shell.js';
import { useArApplicationContext } from '@/shared/config/project-config.js';

type InspectPanelView = 'display' | 'localization' | 'record';

const PANEL_OPTIONS: Array<{ value: InspectPanelView; label: string }> = [
	{ value: 'display', label: '显示' },
	{ value: 'localization', label: '配准' },
	{ value: 'record', label: '记录' }
];

const route = useRoute();
const router = useRouter();
const applicationContext = useArApplicationContext();
const projectConfig = applicationContext.projectConfig;
const store = useArShellStore();
store.configure( applicationContext );

const canvasHost = ref<HTMLElement | null>( null );
const xrButtonHost = ref<HTMLElement | null>( null );
const isEnteringAr = ref( false );
const isPlacingEngineeringModel = ref( false );
const activePanelView = ref<InspectPanelView>( 'localization' );
const markerCalibrationOverlayOpen = ref( false );
const markerApplyFeedback = ref<{
	type: 'success' | 'warning' | 'error';
	message: string;
	createdAt: number;
} | null>( null );

const engine = computed( () => store.engine );
const { activeAdjustment, floatingAdjustment, selectMaterial, selectTool } = useUndergroundDisplayControls( engine );
const ui = computed( () => store.ui );
const hasArSession = computed( () => engine.value.appMode === 'ar-session' );
const currentModel = computed(
	() => engine.value.availableModels.find( ( item ) => item.id === engine.value.selectedModelId )
);
const currentModelName = computed( () => currentModel.value?.name ?? '未选择模型' );
const requestedModelId = computed( () => {
	const routeModelId = projectConfig.showModelSelector && typeof route.query.siteId === 'string'
		? route.query.siteId
		: '';
	return routeModelId || projectConfig.defaultModelId;
} );
const isConfiguredModelAvailable = computed(
	() => engine.value.availableModels.some( ( model ) => model.id === requestedModelId.value )
);
const sceneReady = computed( () => (
	isConfiguredModelAvailable.value
	&& engine.value.selectedModelId === requestedModelId.value
	&& runtimeLoad.value.modelRuntimeLoadState === 'ready'
) );
const sceneUnavailableMessage = computed( () => {
	if ( isConfiguredModelAvailable.value === false ) {
		return '当前项目模型配置不可用';
	}
	if ( runtimeLoad.value.modelRuntimeLoadState === 'failed' ) {
		return runtimeLoad.value.modelRuntimeLoadErrorMessage ?? '模型配置不可用';
	}
	return sceneReady.value ? '' : '正在加载模型配置';
} );
const showDisplayControls = computed( () => {
	const capabilities = projectConfig.capabilities;
	return capabilities.sectionCut || capabilities.layerControl || capabilities.xray;
} );
const panelOptions = computed( () => PANEL_OPTIONS.filter( ( option ) => (
	option.value !== 'display' || showDisplayControls.value
) && (
	option.value !== 'record' || projectConfig.capabilities.inspectionRecord
) ) );
const configStatus = computed( () => engine.value.engineeringConfigStatus );
const runtimeLoad = computed( () => engine.value.modelRuntimeLoad );
const localizationReady = computed( () => engine.value.registrationChainDebug.arSessionLocalization.available );
const modelPlaced = computed( () => engine.value.placementSummary.positionText !== '-' );
const hitTestReady = computed(
	() => engine.value.arSessionPhase === 'ready-to-place'
		|| engine.value.arSessionPhase === 'placing'
		|| engine.value.arSessionPhase === 'placed'
);
const canUseMarkerCorners = computed( () => configStatus.value.activeControlTargetHasCornersEnu );
const xrSessionInteractive = computed( () => (
	engine.value.xrInteraction.tracking === 'normal'
	&& engine.value.xrInteraction.visibility === 'visible'
	&& engine.value.xrInteraction.worldLock !== 'pending'
	&& engine.value.xrInteraction.worldLock !== 'recalibration-required'
) );
const trackingRecoveryMessage = computed( () => {
	if ( hasArSession.value === false ) return '';
	if ( engine.value.xrInteraction.worldLock === 'recalibration-required' ) {
		return '空间坐标发生变化，请重新校正；模型保持原对象和最后有效位置。';
	}
	if ( engine.value.xrInteraction.worldLock === 'pending' ) return '正在建立现实锚点…';
	if ( engine.value.xrInteraction.tracking !== 'normal' || engine.value.xrInteraction.visibility !== 'visible' ) {
		return '跟踪恢复中，模型已冻结；放置、校正和模型拾取暂不可用。';
	}
	return '';
} );

const sessionStatusText = computed( () => {
	if ( hasArSession.value === false ) {
		return '待进入 AR';
	}
	if ( trackingRecoveryMessage.value ) return '跟踪恢复中';
	if ( engine.value.markerCalibration.active ) {
		return `采集四角 ${engine.value.markerCalibration.capturedCornerCount}/${engine.value.markerCalibration.expectedCornerCount}`;
	}
	if ( modelPlaced.value ) {
		return '模型已显示';
	}
	if ( localizationReady.value ) {
		return '空间校正完成';
	}
	if ( hitTestReady.value ) {
		return '等待四角校正';
	}
	return engine.value.runtimeStatus || '扫描平面';
} );

const configCards = computed( () => [
	{ label: '当前模型', value: `${engine.value.selectedModelId || '-'} / ${currentModelName.value}`, wide: true },
	{ label: 'siteOrigin', value: configStatus.value.hasSiteOrigin ? configStatus.value.siteOriginText : '未配置', wide: true },
	{ label: '模型控制点', value: `${configStatus.value.normalizedModelControlTargetCount} 个` },
	{ label: '业务标识', value: `${configStatus.value.annotationCount} 个` },
	{ label: '控制标志', value: formatActiveMarkerText(), wide: true },
	{ label: '四角 ENU', value: canUseMarkerCorners.value ? '已配置' : '缺失' }
] );

const activeControlTargetSummary = computed( () => {
	const activeId = configStatus.value.activeControlTargetId;
	if ( activeId !== undefined ) {
		return configStatus.value.controlTargetSummaries.find( ( item ) => item.id === activeId )
			?? configStatus.value.controlTargetSummaries[ 0 ];
	}
	return configStatus.value.controlTargetSummaries[ 0 ];
} );

const configWarnings = computed( () => {
	const warnings: string[] = [];
	if ( configStatus.value.hasRtkSurveyDataset === false ) {
		warnings.push( '当前未加载 RTK 测量数据，正在使用配置控制点与 Marker 校正。' );
	}
	if ( configStatus.value.normalizedModelControlTargetCount < configStatus.value.requiredModelControlTargetCount ) {
		warnings.push( '模型控制点不足，无法求解 modelLocalToEnu。' );
	} else if ( configStatus.value.hasModelLocalToEnu === false && runtimeLoad.value.modelRuntimeLoadState === 'loading' ) {
		warnings.push( 'Marker 工程配置已加载，模型运行时尚未准备完成。' );
	} else if ( configStatus.value.hasModelLocalToEnu === false && runtimeLoad.value.modelRuntimeLoadState === 'failed' ) {
		warnings.push( runtimeLoad.value.modelRuntimeLoadErrorMessage ?? '模型运行时加载失败。' );
	}
	if ( configStatus.value.hasControlTargets === false ) {
		warnings.push( '当前模型没有控制标志。' );
	}
	if ( canUseMarkerCorners.value === false ) {
		warnings.push( '当前控制标志缺少四角 ENU 坐标。' );
	}
	if ( configStatus.value.baselineMismatch ) {
		warnings.push( '已保存 baseline 与当前 JSON 不一致，本次使用当前 JSON。' );
	}
	if ( configStatus.value.hasMockEngineeringData ) {
		warnings.push( canApplyMockEngineeringCalibration()
			? '当前是 mock/demo 工程数据；开发环境允许完成流程，生产环境会禁止正式校正。'
			: configStatus.value.mockWarningText );
	}
	return warnings;
} );

const calibrationStatusCards = computed( () => [
	{ label: '目标 Marker', value: formatActiveMarkerText(), wide: true },
	{ label: '采集进度', value: `${engine.value.markerCalibration.capturedCornerCount}/${engine.value.markerCalibration.expectedCornerCount}` },
	{ label: '当前角点', value: engine.value.markerCalibration.nextCornerLabel || '-' },
	{ label: '误差', value: engine.value.markerCalibration.rmsErrorMeters === undefined ? '-' : `${engine.value.markerCalibration.rmsErrorMeters.toFixed( 3 )}m` },
	{ label: '航向', value: engine.value.markerCalibration.headingDeg === undefined ? '-' : `${engine.value.markerCalibration.headingDeg.toFixed( 2 )}deg` }
] );

const showMarkerCalibrationOverlay = computed(
	() => hasArSession.value && markerCalibrationOverlayOpen.value && engine.value.markerCalibration.active
);
const canStartMarkerCalibration = computed(
	() => hasArSession.value && xrSessionInteractive.value && hitTestReady.value && canUseMarkerCorners.value
);
const canCaptureMarkerCorner = computed(
	() => showMarkerCalibrationOverlay.value && xrSessionInteractive.value && hitTestReady.value && canUseMarkerCorners.value
);
const canApplyMarkerCalibration = computed(
	() => showMarkerCalibrationOverlay.value
		&& xrSessionInteractive.value
		&& canUseMarkerCorners.value
		&& ( configStatus.value.hasMockEngineeringData === false || canApplyMockEngineeringCalibration() )
		&& engine.value.markerCalibration.capturedCornerCount >= engine.value.markerCalibration.expectedCornerCount
);
const markerApplyBlockedReason = computed( () => {
	if ( hasArSession.value === false ) {
		return '请先进入 AR 会话。';
	}
	if ( xrSessionInteractive.value === false ) return trackingRecoveryMessage.value;
	if ( markerCalibrationOverlayOpen.value === false ) {
		return 'Marker 校正面板未打开。';
	}
	if ( engine.value.markerCalibration.active === false ) {
		return '请先开始当前会话 Marker 校正。';
	}
	if ( engine.value.markerCalibration.currentSessionId === null ) {
		return '当前 Marker 校正没有绑定 AR Session。';
	}
	if ( canUseMarkerCorners.value === false ) {
		return '当前控制标志缺少四角 ENU 坐标。';
	}
	if ( engine.value.markerCalibration.capturedCornerCount < engine.value.markerCalibration.expectedCornerCount ) {
		return `四角点数量不足：${engine.value.markerCalibration.capturedCornerCount}/${engine.value.markerCalibration.expectedCornerCount}`;
	}
	if ( configStatus.value.hasMockEngineeringData && canApplyMockEngineeringCalibration() === false ) {
		return configStatus.value.mockWarningText || '当前为示例工程坐标，请替换为 RTK 实测数据。';
	}
	return '';
} );
const canPlaceEngineeringModel = computed(
	() => hasArSession.value
		&& xrSessionInteractive.value
		&& configStatus.value.hasSiteOrigin
		&& configStatus.value.hasControlTargets
		&& canUseMarkerCorners.value
		&& localizationReady.value
		&& modelPlaced.value === false
		&& isPlacingEngineeringModel.value === false
		&& ( configStatus.value.hasMockEngineeringData === false || canApplyMockEngineeringCalibration() )
);
const placementBlockedText = computed( () => {
	if ( runtimeLoad.value.modelRuntimeLoadState === 'failed' ) {
		return runtimeLoad.value.modelRuntimeLoadErrorMessage ?? `模型运行时加载失败：${runtimeLoad.value.modelRuntimeLoadFailureReason ?? 'unknown'}`;
	}
	if ( runtimeLoad.value.modelRuntimeLoadState === 'loading' ) {
		return '模型资源仍在加载。';
	}
	if ( hasArSession.value === false ) {
		return '请先进入 AR。';
	}
	if ( xrSessionInteractive.value === false ) return trackingRecoveryMessage.value;
	if ( modelPlaced.value ) {
		return '模型已显示；如需重新放置，请先重置并重新完成 Marker 校正。';
	}
	if ( configStatus.value.hasSiteOrigin === false ) {
		return '缺少工程原点 siteOrigin。';
	}
	if ( configStatus.value.hasControlTargets === false ) {
		return '缺少控制标志 controlTargets。';
	}
	if ( canUseMarkerCorners.value === false ) {
		return '当前控制标志缺少四角 ENU。';
	}
	if ( localizationReady.value === false ) {
		return '请先完成四角点校正，再按工程坐标放置模型。';
	}
	if ( configStatus.value.hasMockEngineeringData && canApplyMockEngineeringCalibration() === false ) {
		return configStatus.value.mockWarningText || '生产环境禁止使用 mock/demo 工程数据完成正式放置。';
	}
	return '';
} );
const markerApplyBlockedText = computed( () => (
	markerApplyFeedback.value?.message ?? markerApplyBlockedReason.value
) );

const markerCornerPrompt = computed( () => {
	if ( canUseMarkerCorners.value === false ) {
		return '当前控制标志缺少四角 ENU 坐标。';
	}
	if ( hasArSession.value && hitTestReady.value === false ) {
		return '请先扫描地面。';
	}

	const label = engine.value.markerCalibration.nextCornerLabel;
	if ( label.includes( 'leftTop' ) ) {
		return '请采集三角桶底座落地点左上角 LT，不要点桶身或视觉边缘。';
	}
	if ( label.includes( 'rightTop' ) ) {
		return '请采集三角桶底座落地点右上角 RT，不要点桶身或视觉边缘。';
	}
	if ( label.includes( 'rightBottom' ) ) {
		return '请采集三角桶底座落地点右下角 RB，不要点桶身或视觉边缘。';
	}
	if ( label.includes( 'leftBottom' ) ) {
		return '请采集三角桶底座落地点左下角 LB，不要点桶身或视觉边缘。';
	}
	if ( label.includes( '左上' ) || label.includes( 'leftTop' ) ) {
		return '对准控制标志左上角 LT 后采集。';
	}
	if ( label.includes( '右上' ) || label.includes( 'rightTop' ) ) {
		return '对准控制标志右上角 RT 后采集。';
	}
	if ( label.includes( '右下' ) || label.includes( 'rightBottom' ) ) {
		return '对准控制标志右下角 RB 后采集。';
	}
	if ( label.includes( '左下' ) || label.includes( 'leftBottom' ) ) {
		return '对准控制标志左下角 LB 后采集。';
	}
	return '按 LT、RT、RB、LB 顺序采集。';
} );

const markerCornerSequenceText = computed( () => {
	const index = Math.min(
		engine.value.markerCalibration.capturedCornerCount,
		Math.max( engine.value.markerCalibration.expectedCornerCount - 1, 0 )
	);
	return `${index + 1}/${engine.value.markerCalibration.expectedCornerCount}: ${engine.value.markerCalibration.nextCornerLabel || '-'}`;
} );

const markerCornerEnuText = computed( () => {
	const index = Math.min(
		engine.value.markerCalibration.capturedCornerCount,
		Math.max( engine.value.markerCalibration.expectedCornerCount - 1, 0 )
	);
	const corners = activeControlTargetSummary.value?.cornersEnuText.split( ' / ' ) ?? [];
	return corners[ index ] ?? '-';
} );

const workflowHint = computed( () => {
	if ( localizationReady.value && modelPlaced.value ) {
		return '空间校正完成，模型已显示。';
	}
	if ( localizationReady.value ) {
		return '空间校正完成，等待模型自动放置。';
	}
	if ( hitTestReady.value ) {
		return '请完成控制标志四角校正。';
	}
	return hasArSession.value ? '请扫描地面。' : '请进入 AR。';
} );

watch( hasArSession, syncArOverlayClass, { immediate: true } );
watch( panelOptions, ( options ) => {
	if ( options.some( ( option ) => option.value === activePanelView.value ) === false ) {
		activePanelView.value = 'localization';
	}
}, { immediate: true } );
watch( requestedModelId, () => {
	void initializeSceneModel();
} );
watch(
	() => engine.value.markerCalibration.active,
	(active) => {
		if ( active === false ) {
			markerCalibrationOverlayOpen.value = false;
		}
	}
);
watch( hasArSession, (active) => {
	if ( active === false ) {
		markerCalibrationOverlayOpen.value = false;
	}
} );

function formatActiveMarkerText(): string {
	const id = configStatus.value.activeControlTargetId ?? '-';
	const name = configStatus.value.activeControlTargetName ?? '-';
	return `${id} / ${name}`;
}

async function mountEngineHosts(): Promise<void> {
	await initializeSceneModel();
	store.actions.setWorkflowMode( 'ar-inspection' );
	await nextTick();
	if ( canvasHost.value === null || xrButtonHost.value === null ) {
		return;
	}

	store.mountHosts( {
		canvasHost: canvasHost.value,
		xrButtonHost: xrButtonHost.value
	} );
}

async function initializeSceneModel(): Promise<void> {

	await store.initialize();
	if ( isConfiguredModelAvailable.value === false ) {
		return;
	}
	if ( engine.value.selectedModelId !== requestedModelId.value ) {
		store.actions.selectModel( requestedModelId.value );
	}

}

function startArSession(): void {
	if ( isEnteringAr.value || hasArSession.value || sceneReady.value === false ) return;
	isEnteringAr.value = true;
	store.actions.setWorkflowMode( 'ar-inspection' );
	void store.actions.enterAr().finally( () => {
		isEnteringAr.value = false;
	} );
}

function handleModelChange(event: Event): void {
	store.actions.selectModel( ( event.target as HTMLSelectElement ).value );
}

function activatePanelView(view: InspectPanelView): void {
	activePanelView.value = view;
}

function selectMaterialMode(mode: UndergroundMaterialMode): void {
	store.actions.setUndergroundMaterialMode( mode );
	selectMaterial( mode );
	store.actions.closeDrawer();
}

function selectInspectionTool(tool: UndergroundInspectionTool): void {
	store.actions.setUndergroundInspectionTool( tool );
	selectTool( tool );
	if ( tool !== 'section-cut' ) store.actions.closeDrawer();
}

function selectSectionMode(mode: 'horizontal-section' | 'cross-section' | 'longitudinal-section'): void {
	store.actions.setSectionCutPlaneMode( mode );
	activeAdjustment.value = 'section-cut';
	store.actions.closeDrawer();
}

let pendingFloatingValue = 0;
let floatingInputFrame = 0;
function updateFloatingValue(value: number): void {
	pendingFloatingValue = value;
	if ( floatingInputFrame !== 0 ) return;
	floatingInputFrame = requestAnimationFrame( () => {
		floatingInputFrame = 0;
		if ( activeAdjustment.value === 'xray-opacity' ) store.actions.setTransparentXrayValue( pendingFloatingValue );
		if ( activeAdjustment.value === 'layer-peeling' ) store.actions.setLayerPeelingValue( pendingFloatingValue );
		if ( activeAdjustment.value === 'section-cut' ) store.actions.setSectionCutValue( pendingFloatingValue );
	} );
}

function openWorkspacePanel(): void {
	if ( ui.value.drawerOpen ) {
		store.actions.toggleDrawer();
		return;
	}

	store.actions.activatePanel( 'registration' );
}

function closeDrawerIfOpen(): void {
	if ( ui.value.drawerOpen ) {
		store.actions.toggleDrawer();
	}
}

async function handleStartMarkerCalibration(): Promise<void> {
	markerApplyFeedback.value = null;
	store.actions.startCurrentSessionMarkerCalibration();
	await nextTick();
	if ( engine.value.markerCalibration.active ) {
		markerCalibrationOverlayOpen.value = true;
		closeDrawerIfOpen();
	}
}

function handleCaptureMarkerCorner(): void {
	markerApplyFeedback.value = null;
	store.actions.captureCurrentSessionMarkerCorner();
}

async function handleResetMarkerCalibration(): Promise<void> {
	markerApplyFeedback.value = null;
	if ( engine.value.markerCalibration.active ) {
		store.actions.cancelCurrentSessionMarkerCalibration();
		await nextTick();
	}
	store.actions.startCurrentSessionMarkerCalibration();
	await nextTick();
	markerCalibrationOverlayOpen.value = engine.value.markerCalibration.active;
	closeDrawerIfOpen();
}

async function handleApplyMarkerCalibration(): Promise<void> {
	markerApplyFeedback.value = null;
	const blockedReason = markerApplyBlockedReason.value;
	if ( canApplyMarkerCalibration.value === false ) {
		markerApplyFeedback.value = {
			type: 'warning',
			message: blockedReason || '当前条件不足，无法完成 Marker 校正。',
			createdAt: Date.now()
		};
		return;
	}

	const result = store.actions.solveAndApplyCurrentSessionMarkerCalibration();
	await nextTick();
	if ( result.ok === false ) {
		markerApplyFeedback.value = {
			type: 'error',
			message: result.reason,
			createdAt: Date.now()
		};
		markerCalibrationOverlayOpen.value = true;
		return;
	}
	markerApplyFeedback.value = {
		type: 'success',
		message: result.placementState === 'marker-applied-model-runtime-pending'
			? 'Marker 校正成功，正在等待模型资源。'
			: 'Marker 校正已完成，工程坐标已对齐，请点击工程放置模型。',
		createdAt: Date.now()
	};
	markerCalibrationOverlayOpen.value = engine.value.markerCalibration.active;
	closeDrawerIfOpen();
}

async function handlePlaceEngineeringModel(): Promise<void> {
	if ( canPlaceEngineeringModel.value === false ) {
		return;
	}

	isPlacingEngineeringModel.value = true;
	try {
		await store.actions.placeModel();
	} finally {
		isPlacingEngineeringModel.value = false;
	}
}

async function handleExitMarkerCalibration(): Promise<void> {
	markerApplyFeedback.value = null;
	if ( engine.value.markerCalibration.active ) {
		store.actions.cancelCurrentSessionMarkerCalibration();
	}
	markerCalibrationOverlayOpen.value = false;
	await nextTick();
	closeDrawerIfOpen();
}

function exitPage(): void {
	if ( hasArSession.value ) {
		store.actions.exitAr();
		return;
	}
	void router.push( '/' );
}

onMounted( async () => {
	await mountEngineHosts();
	store.actions.setWorkflowMode( 'ar-inspection' );
} );

onUnmounted( () => {
	if ( floatingInputFrame !== 0 ) cancelAnimationFrame( floatingInputFrame );
	setArOverlayClass( false );
	store.dispose();
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
	<div class="inspect-page" :class="{ 'ar-active': hasArSession }">
		<div class="page-scroll">
			<header
			v-if="showMarkerCalibrationOverlay === false"
			class="page-header"
			data-ar-ui="true"
			@click.stop
			>
				<div>
					<div class="page-title">{{ projectConfig.labels.arTitle }}</div>
					<div class="page-subtitle">{{ projectConfig.labels.arSubtitle ?? currentModelName }}</div>
				</div>
				<div class="status-chip">状态：{{ sessionStatusText }}</div>
			</header>

			<div
				v-if="trackingRecoveryMessage"
				class="tracking-recovery-banner"
				data-ar-ui="true"
				role="status"
			>
				{{ trackingRecoveryMessage }}
			</div>

			<section class="scene-shell">
				<div ref="canvasHost" class="scene-layer"></div>
				<div ref="xrButtonHost" class="scene-hidden"></div>

				<div
					v-if="!hasArSession"
					class="launch-overlay"
					data-ar-ui="true"
					@click.stop
				>
					<div class="launch-badge">AR</div>
					<div class="launch-title">{{ projectConfig.labels.enterAr }}</div>
					<p class="launch-subtitle">
						{{ sceneUnavailableMessage || '模型配置已就绪，进入 AR 后采集控制标志四角点。' }}
					</p>
					<label v-if="projectConfig.showModelSelector" class="model-field">
						<span>选择站点</span>
						<select class="select-field" :value="engine.selectedModelId" @change="handleModelChange">
							<option v-for="model in engine.availableModels" :key="model.id" :value="model.id">
								{{ model.name }}
							</option>
						</select>
					</label>
					<button type="button" class="launch-button" :disabled="sceneReady === false || isEnteringAr" @click.stop="startArSession">
						{{ isEnteringAr ? '正在进入…' : projectConfig.labels.enterAr }}
					</button>
				</div>
			</section>

		</div>

		<PipePropertyHud
			v-if="hasArSession"
			:selected-component="engine.selectedComponent"
			:annotation-detail="engine.annotationDetail"
			:fields="projectConfig.componentPropertyHud.fields"
			@close="store.actions.closePropertyPanel()"
		/>

		<nav
			v-if="hasArSession && showMarkerCalibrationOverlay === false"
			class="action-dock action-dock-compact"
			aria-label="AR 操作"
			data-ar-ui="true"
			@click.stop
		>
			<button type="button" class="dock-item dock-item-primary" @click.stop="openWorkspacePanel">
				<span class="dock-icon">板</span>
				<span class="dock-label">控制面板</span>
			</button>
			<button v-if="projectConfig.capabilities.screenshot" type="button" class="dock-item" @click.stop="store.actions.takeSnapshot()">
				<span class="dock-icon">图</span>
				<span class="dock-label">截图</span>
			</button>
			<button type="button" class="dock-item" @click.stop="exitPage">
				<span class="dock-icon">退</span>
				<span class="dock-label">退出 AR</span>
			</button>
		</nav>

		<ArFloatingValueRail
			v-if="hasArSession && showDisplayControls && ui.drawerOpen === false && floatingAdjustment !== null && showMarkerCalibrationOverlay === false"
			:model-value="floatingAdjustment.value"
			:ariaLabel="floatingAdjustment.label"
			@update:model-value="updateFloatingValue"
		/>

		<transition name="sheet-fade">
			<section
				v-if="ui.drawerOpen && showMarkerCalibrationOverlay === false"
				class="bottom-sheet"
				data-ar-ui="true"
				@pointermove.stop
				@pointerup.stop
				@touchstart.stop
				@touchmove.stop
				@touchend.stop
				@click.stop
			>
				<div class="sheet-header">
					<div class="sheet-tabs">
						<button
						v-for="item in panelOptions"
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
						收起
					</button>
				</div>

				<template v-if="activePanelView === 'display' && showDisplayControls">
					<UndergroundDisplayControls :material-mode="engine.undergroundMaterialMode" :inspection-tool="engine.undergroundInspectionTool" :section-mode="engine.sectionCutPlaneMode" @material="selectMaterialMode" @tool="selectInspectionTool" @section="selectSectionMode" />
				</template>

				<template v-else-if="activePanelView === 'localization'">
					<ArPanelSection title="工程配置" first>
						<ArInfoGrid :items="configCards" />
						<div v-for="warning in configWarnings" :key="warning" class="runtime-banner warning">
							{{ warning }}
						</div>
											</ArPanelSection>

					<ArPlacementStatusSection :state="engine" title="AR 定位" />
					<div v-if="projectConfig.capabilities.modelPlacement" class="action-row placement-action-row">
						<button
							type="button"
							class="action-button primary"
							:disabled="canPlaceEngineeringModel === false"
							@click="handlePlaceEngineeringModel()"
						>
							{{ isPlacingEngineeringModel ? '正在建立现实锚点…' : '按校正结果放置模型' }}
						</button>
						<button type="button" class="action-button" @click="store.actions.resetPlacement()">
							重置模型
						</button>
					</div>
					<div v-if="placementBlockedText" class="runtime-banner warning">
						{{ placementBlockedText }}
					</div>

					<ArPanelSection title="四角点校正">
						<ArInfoGrid :items="calibrationStatusCards" class="compact-info-grid" />
						<div class="runtime-banner" :class="{ warning: canUseMarkerCorners === false }">
							{{ markerCornerPrompt }}
						</div>
						<div class="runtime-banner">
							当前采集：{{ markerCornerSequenceText }}<br>
							控制标志：{{ configStatus.activeControlTargetId ?? '-' }}<br>
							对应 ENU：{{ markerCornerEnuText }}<br>
							当前采集顺序：左上 -> 右上 -> 右下 -> 左下
						</div>
						<div class="action-row">
							<button
								type="button"
								class="action-button"
								:disabled="canStartMarkerCalibration === false"
								@click="handleStartMarkerCalibration()"
							>
								开始四角点采集
							</button>
						</div>
					</ArPanelSection>
				</template>

				<template v-else-if="activePanelView === 'record' && projectConfig.capabilities.inspectionRecord">
					<div class="sheet-section">
						<div class="section-label">巡查记录</div>
						<div class="form-grid">
							<label class="field">
								<span>结果</span>
								<input
									:value="ui.inspectionDraft.result"
									type="text"
									@input="store.actions.updateInspectionDraft({ result: ($event.target as HTMLInputElement).value })"
								>
							</label>
							<label class="field">
								<span>类型</span>
								<input
									:value="ui.inspectionDraft.type"
									type="text"
									@input="store.actions.updateInspectionDraft({ type: ($event.target as HTMLInputElement).value })"
								>
							</label>
							<label class="field">
								<span>等级</span>
								<input
									:value="ui.inspectionDraft.severity"
									type="text"
									@input="store.actions.updateInspectionDraft({ severity: ($event.target as HTMLInputElement).value })"
								>
							</label>
							<label class="field full">
								<span>备注</span>
								<textarea
									rows="4"
									:value="ui.inspectionDraft.note"
									@input="store.actions.updateInspectionDraft({ note: ($event.target as HTMLTextAreaElement).value })"
								></textarea>
							</label>
						</div>
						<div class="action-row">
							<button type="button" class="action-button primary" @click="store.actions.saveInspectionRecord()">
								保存记录
							</button>
							<button type="button" class="action-button" @click="store.actions.exportInspectionRecords()">
								导出记录
							</button>
						</div>
					</div>
				</template>
			</section>
		</transition>

		<section
			v-if="showMarkerCalibrationOverlay"
			class="marker-calibration-overlay"
			data-ar-ui="true"
			@click.stop
		>
			<div class="marker-calibration-title">手动 Marker 四角点校正</div>
			<div class="marker-calibration-progress">
				{{ engine.markerCalibration.capturedCornerCount }}/{{ engine.markerCalibration.expectedCornerCount }}
				<span>{{ engine.markerCalibration.nextCornerLabel || '-' }}</span>
			</div>
			<div class="marker-calibration-hint">{{ markerCornerPrompt }}</div>
			<div class="marker-calibration-status">{{ engine.runtimeStatus }}</div>
			<div
				v-if="markerApplyFeedback || markerApplyBlockedText"
				class="marker-calibration-warning"
				:class="markerApplyFeedback?.type"
			>
				{{ markerApplyBlockedText }}
			</div>
			<div class="marker-calibration-actions">
				<button
					type="button"
					class="marker-action primary"
					:disabled="canCaptureMarkerCorner === false"
					@click="handleCaptureMarkerCorner()"
				>
					采集当前角点
				</button>
				<button
					type="button"
					class="marker-action success"
							:disabled="canApplyMarkerCalibration === false"
					@click="handleApplyMarkerCalibration()"
				>
					完成校正
				</button>
				<button type="button" class="marker-action" @click="handleResetMarkerCalibration()">
					重置采集
				</button>
				<button type="button" class="marker-action" @click="handleExitMarkerCalibration()">
					退出
				</button>
			</div>
		</section>

	</div>
</template>

<style scoped>
.inspect-page {
	min-height: 100vh;
	background: linear-gradient(180deg, #07101b 0%, #0b1625 100%);
	color: #eff6ff;
	font-size: 13px;
}

.inspect-page.ar-active {
	background: transparent;
}

.tracking-recovery-banner {
	position: fixed;
	top: max(84px, calc(env(safe-area-inset-top) + 72px));
	left: 50%;
	z-index: 8;
	width: min(88vw, 520px);
	transform: translateX(-50%);
	padding: 10px 14px;
	border: 1px solid rgba(250, 204, 21, 0.5);
	border-radius: 12px;
	background: rgba(30, 41, 59, 0.86);
	box-shadow: 0 12px 30px rgba(0, 0, 0, 0.3);
	color: #fef08a;
	font-weight: 700;
	line-height: 1.45;
	text-align: center;
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
	pointer-events: auto;
}

.page-title {
	font-size: 24px;
	font-weight: 800;
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

.inspect-page.ar-active .scene-shell,
.inspect-page.ar-active .scene-layer {
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
	width: 42px;
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

.model-field,
.field {
	display: grid;
	gap: 7px;
	color: rgba(226, 232, 240, 0.82);
	font-size: 12px;
}

.select-field,
.field input,
.field textarea {
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
.sheet-close {
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

.action-button:disabled,
.chip-button:disabled {
	opacity: 0.42;
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
	grid-template-columns: 1.2fr 1fr 1fr;
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
	left: 50%;
	transform: translateX(-50%);
	bottom: calc(82px + env(safe-area-inset-bottom));
	width: min(calc(100vw - 24px), 520px);
	max-height: min(48vh, 520px);
	overflow-y: auto;
	overscroll-behavior: contain;
	padding: 12px;
	border-radius: 20px;
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
	margin-bottom: 8px;
}

.sheet-tabs,
.chip-grid,
.action-row {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
}

.placement-action-row {
	margin: 10px 0 14px;
}

.placement-action-row .action-button {
	flex: 1 1 180px;
}

.sheet-tab {
	border: 1px solid rgba(148, 163, 184, 0.2);
	border-radius: 14px;
	background: rgba(15, 23, 42, 0.74);
	color: #dbeafe;
	padding: 7px 9px;
	font-size: 12px;
	font-weight: 800;
}

.sheet-tab.active {
	background: rgba(0, 212, 255, 0.2);
	border-color: rgba(0, 212, 255, 0.42);
	color: #fff;
}

.sheet-section {
	margin-top: 9px;
}

.section-label {
	margin-bottom: 6px;
	font-size: 12px;
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

.marker-calibration-overlay {
	position: fixed;
	z-index: 9;
	left: 14px;
	right: 14px;
	bottom: max(14px, env(safe-area-inset-bottom));
	display: grid;
	gap: 8px;
	padding: 12px;
	border-radius: 18px;
	background: rgba(8, 15, 27, 0.76);
	border: 1px solid rgba(255, 255, 255, 0.14);
	box-shadow: 0 22px 62px rgba(0, 0, 0, 0.38);
	backdrop-filter: blur(22px);
	pointer-events: auto;
}

.marker-calibration-title {
	font-size: 13px;
	font-weight: 900;
	color: #e0f2fe;
}

.marker-calibration-progress {
	display: flex;
	justify-content: space-between;
	gap: 10px;
	font-size: 12px;
	font-weight: 800;
	color: #d5f7ff;
}

.marker-calibration-progress span {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: rgba(226, 232, 240, 0.86);
}

.marker-calibration-hint {
	font-size: 12px;
	line-height: 1.45;
	color: rgba(226, 232, 240, 0.86);
}

.marker-calibration-status {
	font-size: 11px;
	line-height: 1.4;
	color: rgba(125, 211, 252, 0.94);
}

.marker-calibration-warning {
	padding: 7px 9px;
	border-radius: 11px;
	background: rgba(245, 158, 11, 0.14);
	border: 1px solid rgba(245, 158, 11, 0.3);
	color: #ffe8b6;
	font-size: 11px;
	line-height: 1.4;
}

.marker-calibration-warning.success {
	background: rgba(20, 184, 166, 0.16);
	border-color: rgba(45, 212, 191, 0.34);
	color: #ccfbf1;
}

.marker-calibration-warning.error {
	background: rgba(239, 68, 68, 0.16);
	border-color: rgba(248, 113, 113, 0.34);
	color: #fecaca;
}

.marker-calibration-actions {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 8px;
}

.marker-action {
	min-height: 44px;
	border: 1px solid rgba(148, 163, 184, 0.22);
	border-radius: 14px;
	background: rgba(15, 23, 42, 0.86);
	color: #eff6ff;
	font-size: 12px;
	font-weight: 900;
}

.marker-action.primary {
	background: rgba(0, 212, 255, 0.2);
	border-color: rgba(0, 212, 255, 0.42);
}

.marker-action.success {
	background: rgba(20, 184, 166, 0.22);
	border-color: rgba(45, 212, 191, 0.42);
}

.marker-action:disabled {
	opacity: 0.42;
}

.form-grid {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 10px;
}

.field.full {
	grid-column: 1 / -1;
}

.sheet-fade-enter-active,
.sheet-fade-leave-active {
	transition: opacity 0.18s ease, transform 0.18s ease;
}

.sheet-fade-enter-from,
.sheet-fade-leave-to {
	opacity: 0;
	transform: translate(-50%, 12px);
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

	.form-grid {
		grid-template-columns: 1fr;
	}
}
</style>

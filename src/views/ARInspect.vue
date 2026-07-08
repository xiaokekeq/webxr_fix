<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ArInfoGrid from '@/components/ar/ArInfoGrid.vue';
import ArModelInfoPanel from '@/components/ar/ArModelInfoPanel.vue';
import ArPanelSection from '@/components/ar/ArPanelSection.vue';
import ArPlacementStatusSection from '@/components/ar/ArPlacementStatusSection.vue';
import { canApplyMockEngineeringCalibration } from '@/engine/session/registration-state-runtime.js';
import {
	DISPLAY_MODE_OPTIONS,
	SECTION_CUT_PLANE_MODE_OPTIONS
} from '@/features/ar/types/display-modes.js';
import { useArShellStore } from '@/features/ar/stores/ar-shell.js';

type InspectPanelView = 'display' | 'localization' | 'record';

const PANEL_OPTIONS: Array<{ value: InspectPanelView; label: string }> = [
	{ value: 'display', label: '显示' },
	{ value: 'localization', label: '配准' },
	{ value: 'record', label: '记录' }
];

const route = useRoute();
const router = useRouter();
const store = useArShellStore();

const canvasHost = ref<HTMLElement | null>( null );
const xrButtonHost = ref<HTMLElement | null>( null );
const activePanelView = ref<InspectPanelView>( 'localization' );
const markerCalibrationOverlayOpen = ref( false );
const markerApplyFeedback = ref<{
	type: 'success' | 'warning' | 'error';
	message: string;
	createdAt: number;
} | null>( null );
const debugInfoOpen = ref( false );
const registrationDiagnosticOpen = ref( false );

const engine = computed( () => store.engine );
const ui = computed( () => store.ui );
const hasArSession = computed( () => engine.value.appMode === 'ar-session' );
const currentModel = computed(
	() => engine.value.availableModels.find( ( item ) => item.id === engine.value.selectedModelId )
);
const currentModelName = computed( () => currentModel.value?.name ?? '未选择站点' );
const currentConfigUrl = computed( () => currentModel.value?.configUrl ?? '-' );
const configStatus = computed( () => engine.value.engineeringConfigStatus );
const localizationReady = computed( () => engine.value.registrationChainDebug.arSessionLocalization.available );
const modelPlaced = computed( () => engine.value.placementSummary.positionText !== '-' );
const hitTestReady = computed(
	() => engine.value.arSessionPhase === 'ready-to-place'
		|| engine.value.arSessionPhase === 'placing'
		|| engine.value.arSessionPhase === 'placed'
);
const canUseMarkerCorners = computed( () => configStatus.value.activeControlTargetHasCornersEnu );

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

const sessionStatusText = computed( () => {
	if ( hasArSession.value === false ) {
		return '待进入 AR';
	}
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
	{ label: '模型控制点', value: `${engine.value.registrationChainDebug.engineeringControlRegistration.controlPointCount} 个` },
	{ label: '控制标志', value: formatActiveMarkerText(), wide: true },
	{ label: '四角 ENU', value: canUseMarkerCorners.value ? '已配置' : '缺失' }
] );

const debugCards = computed( () => [
	{ label: '配置 JSON', value: currentConfigUrl.value, wide: true },
	{ label: '数据来源', value: configStatus.value.hasMockEngineeringData ? 'mock/demo' : configStatus.value.engineeringDataSourceText },
	{ label: 'RTK 点数', value: configStatus.value.hasRtkSurveyDataset ? `${configStatus.value.rtkPointCount}` : '未加载' },
	{ label: '控制标志来源', value: configStatus.value.controlTargetSourceText },
	{ label: 'mock note', value: configStatus.value.mockWarningText || '-', wide: true }
] );

const activeControlTargetSummary = computed( () => {
	const activeId = configStatus.value.activeControlTargetId;
	if ( activeId !== undefined ) {
		return configStatus.value.controlTargetSummaries.find( ( item ) => item.id === activeId )
			?? configStatus.value.controlTargetSummaries[ 0 ];
	}
	return configStatus.value.controlTargetSummaries[ 0 ];
} );

const registrationDiagnosticCards = computed( () => [
	{ label: 'modelId', value: engine.value.selectedModelId || '-', wide: true },
	{ label: 'configUrl', value: currentConfigUrl.value, wide: true },
	{ label: 'siteOrigin', value: configStatus.value.hasSiteOrigin ? 'configured' : 'missing' },
	{ label: 'controlTargets', value: `${configStatus.value.controlTargetCount}` },
	{ label: 'activeTarget', value: configStatus.value.activeControlTargetId ?? '-' },
	{ label: 'cornersEnu', value: configStatus.value.activeControlTargetHasCornersEnu ? '4/4' : 'missing' },
	{ label: 'cornerOrder', value: activeControlTargetSummary.value?.cornerOrderText ?? '-' },
	{ label: 'capturedCornersAr', value: `${engine.value.markerCalibration.capturedCornerCount}/${engine.value.markerCalibration.expectedCornerCount}` },
	{ label: 'markerCalibration.status', value: formatMarkerCalibrationStatus() },
	{ label: 'ENU->AR transform', value: formatEnuToArTransformStatus() },
	{ label: 'transformSessionId', value: engine.value.markerCalibration.currentSessionId ?? '-' },
	{ label: 'currentSessionId', value: engine.value.markerCalibration.currentSessionId ?? '-' },
	{ label: 'placementAnchorEnu', value: configStatus.value.placementAnchorText || '-' },
	{ label: 'modelLocalToEnu', value: configStatus.value.hasModelLocalToEnu ? 'configured' : 'missing' },
	{ label: 'final AR position', value: engine.value.placementSummary.positionText },
	{ label: 'final AR quaternion', value: engine.value.placementSummary.quaternionText, wide: true },
	{ label: 'controlPointAlignment', value: engine.value.registrationStatusDetail || engine.value.runtimeStatus || '-', wide: true },
	{ label: 'marker self-check', value: engine.value.footprintDiagnostics.groundPlaneSelfCheckText, wide: true },
	{ label: 'marker->footprint distance', value: engine.value.footprintDiagnostics.markerToFootprintDistanceText, wide: true },
	{ label: 'marker->footprint heading', value: engine.value.footprintDiagnostics.markerToFootprintHeadingText, wide: true },
	{ label: 'footprint shape', value: engine.value.footprintDiagnostics.footprintShapeText, wide: true },
	{ label: 'footprint CPs', value: engine.value.footprintDiagnostics.footprintControlPointIdsText, wide: true },
	{ label: 'ENU usage', value: engine.value.footprintDiagnostics.enuUsageText, wide: true },
	{ label: 'footprint verdict', value: engine.value.footprintDiagnostics.verdictText, wide: true },
	{ label: 'diagnostic updated', value: engine.value.footprintDiagnostics.updatedAtText },
	{ label: 'placementMode', value: 'engineering' },
	{ label: 'placementSource', value: formatPlacementSource() },
	{ label: 'usedHitTestForFinalPlacement', value: 'false' },
	{ label: 'hasMockEngineeringData', value: configStatus.value.hasMockEngineeringData ? 'true' : 'false' },
	{ label: 'mock/demo reason', value: formatMockReason(), wide: true }
] );

const configWarnings = computed( () => {
	const warnings: string[] = [];
	if ( configStatus.value.hasRtkSurveyDataset === false ) {
		warnings.push( '当前模型未加载 RTK 测量数据。' );
	}
	if ( configStatus.value.hasModelLocalToEnu === false ) {
		warnings.push( '模型控制点不足，无法求解 modelLocalToEnu。' );
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
	() => hasArSession.value && hitTestReady.value && canUseMarkerCorners.value
);
const canCaptureMarkerCorner = computed(
	() => showMarkerCalibrationOverlay.value && hitTestReady.value && canUseMarkerCorners.value
);
const allowDebugMarkerApply = import.meta.env.DEV || import.meta.env.VITE_DEBUG_MARKER_APPLY === 'true';
const canApplyMarkerCalibration = computed(
	() => showMarkerCalibrationOverlay.value
		&& canUseMarkerCorners.value
		&& ( configStatus.value.hasMockEngineeringData === false || canApplyMockEngineeringCalibration() )
		&& engine.value.markerCalibration.capturedCornerCount >= engine.value.markerCalibration.expectedCornerCount
);
const markerApplyBlockedReason = computed( () => {
	if ( hasArSession.value === false ) {
		return '请先进入 AR 会话。';
	}
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
		&& configStatus.value.hasSiteOrigin
		&& configStatus.value.hasControlTargets
		&& canUseMarkerCorners.value
		&& localizationReady.value
		&& ( configStatus.value.hasMockEngineeringData === false || canApplyMockEngineeringCalibration() )
);
const placementBlockedText = computed( () => {
	if ( hasArSession.value === false ) {
		return '请先进入 AR。';
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

watch(
	workflowHint,
	(message) => {
		console.info( '[ArUiLocalizationStepChanged]', {
			mode: engine.value.workflowMode,
			siteId: engine.value.selectedModelId || null,
			modelId: engine.value.selectedModelId || null,
			sessionId: engine.value.markerCalibration.currentSessionId,
			currentStep: resolveCurrentStep(),
			localizationSource: engine.value.registrationChainDebug.arSessionLocalization.source,
			targetId: configStatus.value.activeControlTargetId ?? engine.value.markerCalibration.markerId,
			message
		} );
	},
	{ immediate: true }
);

watch( hasArSession, syncArOverlayClass, { immediate: true } );
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

function formatMarkerCalibrationStatus(): string {
	if ( engine.value.markerCalibration.applied ) {
		return 'applied';
	}
	if ( engine.value.markerCalibration.solved ) {
		return 'solved';
	}
	if ( engine.value.markerCalibration.active ) {
		return 'capturing';
	}
	return 'idle';
}

function formatEnuToArTransformStatus(): string {
	if ( localizationReady.value === false ) {
		return 'missing';
	}
	if ( engine.value.registrationChainDebug.arSessionLocalization.source !== 'marker' ) {
		return `non-marker:${engine.value.registrationChainDebug.arSessionLocalization.source}`;
	}
	if ( hasArSession.value === false || engine.value.markerCalibration.currentSessionId === null ) {
		return 'expired';
	}
	return 'generated';
}

function formatPlacementSource(): string {
	if ( localizationReady.value && engine.value.registrationChainDebug.arSessionLocalization.source === 'marker' ) {
		return 'marker-calibrated-enu';
	}
	return engine.value.registrationChainDebug.arSessionLocalization.source || 'missing';
}

function formatMockReason(): string {
	if ( configStatus.value.hasMockEngineeringData === false ) {
		return '-';
	}
	if ( configStatus.value.mockWarningText.length > 0 ) {
		return configStatus.value.mockWarningText;
	}
	if ( configStatus.value.mockRtkPointIds.length > 0 ) {
		return configStatus.value.mockRtkPointIds.join( ', ' );
	}
	return 'mock/demo engineering data';
}

function formatActiveMarkerText(): string {
	const id = configStatus.value.activeControlTargetId ?? '-';
	const name = configStatus.value.activeControlTargetName ?? '-';
	return `${id} / ${name}`;
}

function resolveCurrentStep(): string {
	if ( hasArSession.value === false ) {
		return 'enter-ar';
	}
	if ( engine.value.arSessionPhase === 'scanning' ) {
		return 'scan-plane';
	}
	if ( engine.value.markerCalibration.active ) {
		return 'capture-marker-corner';
	}
	if ( localizationReady.value === false ) {
		return 'align-marker';
	}
	if ( modelPlaced.value === false ) {
		return 'place-model';
	}
	return 'inspect';
}

async function mountEngineHosts(): Promise<void> {
	await store.initialize();
	store.actions.setWorkflowMode( 'ar-inspection' );
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
	store.actions.setWorkflowMode( 'ar-inspection' );
	store.actions.enterAr();
}

function handleModelChange(event: Event): void {
	store.actions.selectModel( ( event.target as HTMLSelectElement ).value );
}

function activatePanelView(view: InspectPanelView): void {
	activePanelView.value = view;
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
	console.info( '[MarkerCalibrationApplyClicked]', {
		modelId: engine.value.selectedModelId || null,
		currentSessionId: engine.value.markerCalibration.currentSessionId,
		markerCalibrationActive: engine.value.markerCalibration.active,
		capturedCornerCount: engine.value.markerCalibration.capturedCornerCount,
		expectedCornerCount: engine.value.markerCalibration.expectedCornerCount,
		canApplyMarkerCalibration: canApplyMarkerCalibration.value,
		markerApplyBlockedReason: blockedReason,
		hasMockEngineeringData: configStatus.value.hasMockEngineeringData,
		allowMockCalibration: canApplyMockEngineeringCalibration(),
		allowDebugMarkerApply,
		canUseMarkerCorners: canUseMarkerCorners.value,
		showMarkerCalibrationOverlay: showMarkerCalibrationOverlay.value,
		createdAt: Date.now()
	} );
	if ( canApplyMarkerCalibration.value === false && allowDebugMarkerApply === false ) {
		markerApplyFeedback.value = {
			type: 'warning',
			message: blockedReason || '当前条件不足，无法完成 Marker 校正。',
			createdAt: Date.now()
		};
		console.warn( '[MarkerCalibrationApplyBlockedInUi]', {
			reason: blockedReason,
			createdAt: Date.now()
		} );
		return;
	}

	const applied = store.actions.solveAndApplyCurrentSessionMarkerCalibration();
	console.info( '[MarkerCalibrationApplyResult]', {
		applied,
		message: applied ? 'Marker 校正已完成，工程坐标已对齐，请点击工程放置模型。' : 'Marker 校正未应用，面板保持打开。',
		runtimeStatus: engine.value.runtimeStatus,
		markerCalibration: engine.value.markerCalibration,
		createdAt: Date.now()
	} );
	await nextTick();
	if ( applied === false ) {
		markerApplyFeedback.value = {
			type: 'error',
			message: engine.value.runtimeStatus || markerApplyBlockedReason.value || 'Marker 校正失败，请查看控制台日志。',
			createdAt: Date.now()
		};
		markerCalibrationOverlayOpen.value = true;
		console.warn( '[MarkerCalibrationApplyFailedInUi]', {
			runtimeStatus: engine.value.runtimeStatus,
			markerCalibration: engine.value.markerCalibration,
			createdAt: Date.now()
		} );
		return;
	}
	markerApplyFeedback.value = {
		type: 'success',
		message: 'Marker 校正已完成，工程坐标已对齐，请点击工程放置模型。',
		createdAt: Date.now()
	};
	markerCalibrationOverlayOpen.value = engine.value.markerCalibration.active;
	closeDrawerIfOpen();
}

async function handlePlaceEngineeringModel(): Promise<void> {
	if ( canPlaceEngineeringModel.value === false ) {
		console.warn( '[EngineeringPlacementBlockedInUi]', {
			modelId: engine.value.selectedModelId || null,
			sessionId: engine.value.markerCalibration.currentSessionId,
			hasSiteOrigin: configStatus.value.hasSiteOrigin,
			hasControlTargets: configStatus.value.hasControlTargets,
			hasCornersEnu: canUseMarkerCorners.value,
			localizationReady: localizationReady.value,
			localizationSource: engine.value.registrationChainDebug.arSessionLocalization.source,
			hasMockEngineeringData: configStatus.value.hasMockEngineeringData,
			allowMockCalibration: canApplyMockEngineeringCalibration(),
			createdAt: Date.now()
		} );
		return;
	}

	await store.actions.placeModel();
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

onMounted( () => {
	void mountEngineHosts();
	store.actions.setWorkflowMode( 'ar-inspection' );
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
	<div class="inspect-page" :class="{ 'ar-active': hasArSession }" @click="store.actions.handleArUiInteraction()">
		<div class="page-scroll">
			<header
				v-if="showMarkerCalibrationOverlay === false"
				class="page-header"
				@pointerdown.stop="store.actions.handleArUiInteraction()"
				@click.stop
			>
				<div>
					<div class="page-title">堤防 AR 巡查</div>
					<div class="page-subtitle">{{ currentModelName }}</div>
				</div>
				<div class="status-chip">状态：{{ sessionStatusText }}</div>
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
					<div class="launch-title">进入 AR 巡查</div>
					<p class="launch-subtitle">
						读取工程配置后进入 AR；现场需要采集控制标志四角点。
					</p>
					<label class="model-field">
						<span>选择站点</span>
						<select class="select-field" :value="engine.selectedModelId" @change="handleModelChange">
							<option v-for="model in engine.availableModels" :key="model.id" :value="model.id">
								{{ model.name }}
							</option>
						</select>
					</label>
					<button type="button" class="launch-button" @click.stop="startArSession">
						进入 AR
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

		<nav
			v-if="hasArSession && showMarkerCalibrationOverlay === false"
			class="action-dock action-dock-compact"
			aria-label="AR 操作"
			@pointerdown.stop="store.actions.handleArUiInteraction()"
			@click.stop
		>
			<button type="button" class="dock-item dock-item-primary" @click.stop="openWorkspacePanel">
				<span class="dock-icon">板</span>
				<span class="dock-label">控制面板</span>
			</button>
			<button type="button" class="dock-item" @click.stop="store.actions.takeSnapshot()">
				<span class="dock-icon">图</span>
				<span class="dock-label">截图</span>
			</button>
			<button type="button" class="dock-item" @click.stop="exitPage">
				<span class="dock-icon">退</span>
				<span class="dock-label">退出 AR</span>
			</button>
		</nav>

		<transition name="sheet-fade">
			<section
				v-if="ui.drawerOpen && showMarkerCalibrationOverlay === false"
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
						收起
					</button>
				</div>

				<template v-if="activePanelView === 'display'">
					<div class="sheet-section">
						<div class="section-label">模型显示</div>
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
						<div class="section-label">剖切方向</div>
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
						<div class="section-label">地底预览</div>
						<div class="chip-grid">
							<button
								type="button"
								class="chip-button"
								:class="{ active: engine.undergroundPreviewEnabled }"
								@click="store.actions.toggleUndergroundPreview()"
							>
								{{ engine.undergroundPreviewEnabled ? '关闭下沉' : '下沉 1m' }}
							</button>
						</div>
					</div>
				</template>

				<template v-else-if="activePanelView === 'localization'">
					<ArPanelSection title="工程配置" first>
						<ArInfoGrid :items="configCards" />
						<div v-for="warning in configWarnings" :key="warning" class="runtime-banner warning">
							{{ warning }}
						</div>
						<button type="button" class="debug-toggle" @click="debugInfoOpen = !debugInfoOpen">
							{{ debugInfoOpen ? '收起调试信息' : '展开调试信息' }}
						</button>
						<ArInfoGrid v-if="debugInfoOpen" :items="debugCards" />
						<button type="button" class="debug-toggle" @click="registrationDiagnosticOpen = !registrationDiagnosticOpen">
							{{ registrationDiagnosticOpen ? '收起配准诊断' : '配准诊断' }}
						</button>
						<ArInfoGrid v-if="registrationDiagnosticOpen" :items="registrationDiagnosticCards" />
					</ArPanelSection>

					<ArPlacementStatusSection :state="engine" title="AR 定位" />
					<div class="action-row placement-action-row">
						<button
							type="button"
							class="action-button primary"
							:disabled="canPlaceEngineeringModel === false"
							@click="handlePlaceEngineeringModel()"
						>
							按校正结果放置模型
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

				<template v-else>
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
			@pointerdown.stop="store.actions.handleArUiInteraction()"
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
					:disabled="canApplyMarkerCalibration === false && allowDebugMarkerApply === false"
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

		<ArModelInfoPanel
			v-if="hasArSession && ui.drawerOpen === false && showMarkerCalibrationOverlay === false"
			:state="engine"
			@close="store.actions.closePropertyPanel()"
		/>
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
	left: 16px;
	right: 16px;
	bottom: calc(82px + env(safe-area-inset-bottom));
	max-height: 58vh;
	overflow: auto;
	overscroll-behavior: contain;
	padding: 14px 14px calc(112px + env(safe-area-inset-bottom));
	border-radius: 24px;
	background: rgba(8, 15, 27, 0.86);
	border: 1px solid rgba(255, 255, 255, 0.12);
	box-shadow: 0 28px 80px rgba(0, 0, 0, 0.42);
	backdrop-filter: blur(24px);
}

.debug-toggle {
	margin-top: 10px;
	border: 1px solid rgba(148, 163, 184, 0.22);
	border-radius: 12px;
	background: rgba(15, 23, 42, 0.72);
	color: #dbeafe;
	padding: 8px 10px;
	font-size: 12px;
	font-weight: 800;
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

	.form-grid {
		grid-template-columns: 1fr;
	}
}
</style>

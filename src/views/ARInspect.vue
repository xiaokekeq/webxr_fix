<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ArInfoGrid from '@/components/ar/ArInfoGrid.vue';
import ArFloatingValueRail from '@/components/ar/ArFloatingValueRail.vue';
import UndergroundDisplayControls from '@/components/ar/UndergroundDisplayControls.vue';
import ArPanelSection from '@/components/ar/ArPanelSection.vue';
import ArPlacementStatusSection from '@/components/ar/ArPlacementStatusSection.vue';
import { canApplyMockEngineeringCalibration } from '@/engine/session/registration-state-runtime.js';
import type { UndergroundInspectionTool, UndergroundMaterialMode } from '@/engine/visualization/underground-display-state.js';
import { useUndergroundDisplayControls } from '@/features/ar/composables/use-underground-display-controls.js';
import { useArShellStore } from '@/features/ar/stores/ar-shell.js';
import { arInfo, arWarn, isArDebugEnabled } from '@/engine/debug/ar-logger.js';

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
const displaySelectionError = ref( '' );
const markerCalibrationOverlayOpen = ref( false );
const markerApplyFeedback = ref<{
	type: 'success' | 'warning' | 'error';
	message: string;
	createdAt: number;
} | null>( null );
const arDebugMode = isArDebugEnabled();
const debugInfoOpen = ref( false );
const registrationDiagnosticOpen = ref( false );
const modelPlacementDiagnosticOpen = ref( false );
const diagnosticCopyFeedback = ref( '' );

const engine = computed( () => store.engine );
const { activeAdjustment, floatingAdjustment, selectMaterial, selectTool } = useUndergroundDisplayControls( engine );
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
	{ label: '业务标识', value: `${configStatus.value.annotationCount} 个` },
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
	{ label: 'model CP placement', value: engine.value.footprintDiagnostics.modelControlPointPlacementText, wide: true },
	{ label: 'model CP order', value: engine.value.footprintDiagnostics.modelControlPointOrderText, wide: true },
	{ label: 'modelLocal footprint', value: engine.value.footprintDiagnostics.modelLocalFootprintText, wide: true },
	{ label: 'underground display', value: engine.value.footprintDiagnostics.undergroundDisplayText, wide: true },
	{ label: 'model axis', value: engine.value.footprintDiagnostics.modelAxisText, wide: true },
	{ label: 'marker self-check', value: engine.value.footprintDiagnostics.groundPlaneSelfCheckText, wide: true },
	{ label: 'marker->footprint distance', value: engine.value.footprintDiagnostics.markerToFootprintDistanceText, wide: true },
	{ label: 'marker->footprint heading', value: engine.value.footprintDiagnostics.markerToFootprintHeadingText, wide: true },
	{ label: 'heading check', value: engine.value.footprintDiagnostics.markerToFootprintHeadingCheckText, wide: true },
	{ label: 'footprint shape', value: engine.value.footprintDiagnostics.footprintShapeText, wide: true },
	{ label: 'footprint CPs', value: engine.value.footprintDiagnostics.footprintControlPointIdsText, wide: true },
	{ label: 'ENU usage', value: engine.value.footprintDiagnostics.enuUsageText, wide: true },
	{ label: 'physical relation', value: engine.value.footprintDiagnostics.physicalRelationText, wide: true },
	{ label: 'marker physical', value: engine.value.footprintDiagnostics.markerPhysicalText, wide: true },
	{ label: 'footprint verdict', value: engine.value.footprintDiagnostics.verdictText, wide: true },
	{ label: 'diagnostic updated', value: engine.value.footprintDiagnostics.updatedAtText },
	{ label: 'placementMode', value: 'engineering' },
	{ label: 'placementSource', value: formatPlacementSource() },
	{ label: 'usedHitTestForFinalPlacement', value: 'false' },
	{ label: 'hasMockEngineeringData', value: configStatus.value.hasMockEngineeringData ? 'true' : 'false' },
	{ label: 'mock/demo reason', value: formatMockReason(), wide: true }
] );

const modelPlacementDebugCards = computed( () => {
	const debug = engine.value.modelPlacementDebug;
	return [
		{
			label: '地下显示',
			value: `模式 ${debug.undergroundMode ?? '-'}；深度 ${formatMeters( debug.depthMeters )}；来源 ${formatModelHeightSource( debug.modelHeightSource )}`,
			wide: true
		},
		{
			label: '显示偏移',
			value: `工程下沉 ${formatSignedMeters( debug.engineeringUndergroundOffsetY )}；透明度 ${formatOpacity( debug.xrayOpacity )}`,
			wide: true
		},
		{
			label: '工程误差',
			value: `${formatHorizontalStatus( debug.engineeringHorizontalRms )}；水平 RMS ${formatMeters( debug.engineeringHorizontalRms )}；高度 Max ${formatMeters( debug.engineeringVerticalMax )}`,
			wide: true
		},
		{
			label: '显示误差',
			value: `地表投影水平 RMS ${formatMeters( debug.surfaceProjectionHorizontalRms )}；底部深度误差 Max ${formatMeters( debug.bottomDepthErrorMax )}`,
			wide: true
		},
		{
			label: 'World Lock',
			value: `${formatWorldLockStatus( debug.worldLockStatus, debug.isWorldLocked )}；相机移动 ${formatMeters( debug.cameraMovedDistance )}；模型漂移 ${formatMeters( debug.modelWorldDeltaXZ )}`,
			wide: true
		},
		{
			label: '父级挂载',
			value: `model ${debug.modelParentName ?? '-'}；anchor ${debug.arModelAnchorParentName ?? '-'}；scene ${formatBoolean( debug.isArModelAnchorChildOfScene )}；camera ${formatBoolean( debug.isArModelAnchorChildOfCamera )}；reticle ${formatBoolean( debug.isArModelAnchorChildOfReticle )}`,
			wide: true
		},
		{
			label: '放置调用',
			value: `次数 ${debug.engineeringPlacementCallCount ?? 0}；替换 ${debug.replacedModelCount ?? 0}；原因 ${debug.lastPlacementReason ?? '-'}`,
			wide: true
		},
		{
			label: '结论',
			value: debug.conclusion ?? '-',
			wide: true
		},
		{
			label: '对象漂移',
			value: `model ${formatMeters( debug.modelWorldDeltaXZ )}/${formatMeters( debug.modelWorldDeltaY )}；modelAnchor ${formatMeters( debug.arModelAnchorWorldDeltaXZ )}/${formatMeters( debug.arModelAnchorWorldDeltaY )}；placementAnchor ${formatMeters( debug.arPlacementAnchorWorldDeltaXZ )}/${formatMeters( debug.arPlacementAnchorWorldDeltaY )}`,
			wide: true
		},
		{
			label: '相机距离',
			value: `cameraToModel ${formatMeters( debug.cameraToModelDistance )}；变化 ${formatMeters( debug.cameraToModelDistanceDelta )}`,
			wide: true
		},
		{
			label: '模型链路',
			value: debug.placedModelParentChain ?? '-',
			wide: true
		},
		{
			label: 'Anchor 链路',
			value: `modelAnchor: ${debug.arModelAnchorParentChain ?? '-'}；placementAnchor: ${debug.arPlacementAnchorParentChain ?? '-'}`,
			wide: true
		},
		{
			label: 'placementAnchor 更新',
			value: `次数 ${debug.placementAnchorUpdateCount ?? 0}；来源 ${debug.lastPlacementAnchorUpdateReason ?? 'none'}；frameLoop ${formatBoolean( debug.updatedPlacementAnchorFromFrameLoop )}；模型挂其下 ${formatBoolean( debug.isPlacedModelChildOfPlacementAnchor )}`,
			wide: true
		},
		{
			label: '矩阵变化',
			value: `engineering ${formatChanged( debug.engineeringMatrixChanged )}；modelWorld ${formatChanged( debug.placedModelMatrixWorldChanged )}；modelAnchor ${formatChanged( debug.arModelAnchorMatrixWorldChanged )}；placementAnchor ${formatChanged( debug.arPlacementAnchorMatrixWorldChanged )}；arFromEnu ${formatChanged( debug.arFromEnuMatrixChanged )}`,
			wide: true
		}
	];
} );

const modelPlacementDebugCardsExtended = computed( () => {
	const debug = engine.value.modelPlacementDebug;
	return [
		...modelPlacementDebugCards.value,
		{
			label: 'depth semantics',
			value: `source ${formatModelHeightSource( debug.modelHeightSource )}; axis ${formatDepthAxis( debug.modelHeightAxis )}; size ${formatMeters( debug.modelHeightX )}/${formatMeters( debug.modelHeightY )}/${formatMeters( debug.modelHeightZ )}; chosen ${formatMeters( debug.chosenModelHeight )}`,
			wide: true
		},
		{
			label: 'camera baseline',
			value: `initial ${formatMeters( debug.cameraToModelDistanceInitial )}; current ${formatMeters( debug.cameraToModelDistanceCurrent ?? debug.cameraToModelDistance )}; delta ${formatMeters( debug.cameraToModelDistanceDelta )}`,
			wide: true
		},
		{
			label: 'parent runtime',
			value: `unexpected ${formatBoolean( debug.unexpectedArModelAnchorParent )}; camera ${debug.cameraParentChain ?? '-'}; reticle ${debug.reticleParentChain ?? '-'}`,
			wide: true
		},
		{
			label: 'surface centers',
			value: `yellow ${formatVector3Compact( debug.yellowSurfaceCenterWorld )}; eng ${formatVector3Compact( debug.purpleEngineeringCenterWorld )}; underground ${formatVector3Compact( debug.undergroundExpectedCenterWorld )}`,
			wide: true
		},
		{
			label: 'surface world delta',
			value: `yellow ${formatMeters( debug.yellowSurfaceDeltaXZ )}/${formatMeters( debug.yellowSurfaceDeltaY )}; eng ${formatMeters( debug.purpleEngineeringDeltaXZ )}/${formatMeters( debug.purpleEngineeringDeltaY )}; underground ${formatMeters( debug.undergroundExpectedDeltaXZ )}/${formatMeters( debug.undergroundExpectedDeltaY )}`,
			wide: true
		},
		{
			label: 'surface delta',
			value: `eng-yellow ${formatMeters( debug.engineeringMinusYellowXZ )}/${formatMeters( debug.engineeringMinusYellowY )}; underground-yellow ${formatMeters( debug.undergroundMinusYellowXZ )}/${formatMeters( debug.undergroundMinusYellowY )}; underground-eng ${formatMeters( debug.undergroundMinusEngineeringXZ )}/${formatMeters( debug.undergroundMinusEngineeringY )}`,
			wide: true
		},
		{
			label: 'purple updates',
			value: `yellow ${formatUpdateMeta( debug.yellowUpdateCount, debug.yellowLastUpdateReason )}; eng ${formatUpdateMeta( debug.purpleEngineeringUpdateCount, debug.purpleEngineeringLastUpdateReason )}; underground ${formatUpdateMeta( debug.undergroundExpectedUpdateCount, debug.undergroundExpectedLastUpdateReason )}; current ${formatUpdateMeta( debug.currentModelActualUpdateCount, debug.currentModelActualLastUpdateReason )}; frameLoop ${formatBoolean( debug.purpleDiagnosticsUpdatedInFrameLoop )}`,
			wide: true
		}
	];
} );

const modelPlacementDebugGroups = computed( () => {
	const debug = engine.value.modelPlacementDebug;
	return [
		{
			title: '当前配置',
			tone: 'normal',
			items: [
				{ label: 'Build / 更新时间', value: `${debug.buildCommit ?? '-'} / ${formatTimestamp( debug.updatedAt )}`, wide: true },
				{ label: '地下模式', value: debug.undergroundMode ?? '-' },
				{ label: '定位方式', value: formatUndergroundPlacementMode( debug.undergroundPlacementMode ), wide: true },
				{ label: '模型高度来源 / 实际深度', value: `${formatModelHeightSource( debug.modelHeightSource )} / ${formatMeters( debug.depthMeters )}`, wide: true },
				{ label: '模型高度 / 覆土 / 总下沉', value: `${formatMeters( debug.modelHeight )} / ${formatMeters( debug.coverDepthMeters )} / ${formatMeters( debug.totalBottomDepthMeters )}`, wide: true },
				{ label: '工程地下偏移', value: formatSignedMeters( debug.engineeringUndergroundOffsetY ) },
				{ label: 'RTK 地表高程', value: debug.surfaceElevationText ?? '-', wide: true },
				{ label: '模型底部目标高程', value: debug.undergroundElevationText ?? '-', wide: true },
				{ label: '模型尺寸 X/Y/Z', value: `${formatMeters( debug.modelSizeX ?? debug.modelHeightX )} / ${formatMeters( debug.modelSizeY ?? debug.modelHeightY )} / ${formatMeters( debug.modelSizeZ ?? debug.modelHeightZ )}`, wide: true },
				{ label: 'height axis / chosen height', value: `${formatDepthAxis( debug.modelHeightAxis )} / ${formatMeters( debug.chosenModelHeight )}`, wide: true },
				{ label: 'height - Y diff', value: formatMeters( debug.modelHeightToYDifferenceMeters ), wide: true }
			]
		},
		{
			title: 'World Lock',
			tone: worldDeltaTone( Math.max( debug.placedModelDeltaXZ ?? debug.modelWorldDeltaXZ ?? 0, debug.modelAnchorDeltaXZ ?? debug.arModelAnchorWorldDeltaXZ ?? 0, debug.placementAnchorDeltaXZ ?? debug.arPlacementAnchorWorldDeltaXZ ?? 0 ) ),
			items: [
				{ label: '相机移动', value: formatMeters( debug.cameraMovedDistance ) },
				{ label: '模型漂移 XZ / Y', value: `${formatMeters( debug.placedModelDeltaXZ ?? debug.modelWorldDeltaXZ )} / ${formatSignedMeters( debug.placedModelDeltaY ?? debug.modelWorldDeltaY )}`, wide: true },
				{ label: 'modelAnchor 漂移 XZ', value: formatMeters( debug.modelAnchorDeltaXZ ?? debug.arModelAnchorWorldDeltaXZ ) },
				{ label: 'placementAnchor 漂移 XZ', value: formatMeters( debug.placementAnchorDeltaXZ ?? debug.arPlacementAnchorWorldDeltaXZ ) },
				{ label: '相机到模型 初始/当前/变化', value: `${formatMeters( debug.cameraToModelDistanceInitial )} / ${formatMeters( debug.cameraToModelDistanceCurrent )} / ${formatSignedMeters( debug.cameraToModelDistanceDelta )}`, wide: true },
				{ label: '模型父级链路', value: formatParentChain( debug.placedModelParentChain ), wide: true },
				{ label: 'modelAnchor 父级链路', value: formatParentChain( debug.modelAnchorParentChain ?? debug.arModelAnchorParentChain ), wide: true },
				{ label: 'placementAnchor 父级链路', value: formatParentChain( debug.placementAnchorParentChain ?? debug.arPlacementAnchorParentChain ), wide: true }
			]
		},
		{
			title: '矩阵变化',
			tone: matrixTone( debug ),
			items: [
				{ label: 'engineering', value: formatChanged( debug.engineeringMatrixChanged ), wide: true },
				{ label: 'model / modelAnchor', value: `${formatChanged( debug.placedModelMatrixWorldChanged )} / ${formatChanged( debug.modelAnchorMatrixWorldChanged ?? debug.arModelAnchorMatrixWorldChanged )}`, wide: true },
				{ label: 'placementAnchor / arFromEnu', value: `${formatChanged( debug.placementAnchorMatrixWorldChanged ?? debug.arPlacementAnchorMatrixWorldChanged )} / ${formatChanged( debug.arFromEnuMatrixChanged )}`, wide: true },
				{ label: '矩阵平移变化 eng/model', value: `${formatMeters( debug.engineeringMatrixTranslationDelta )} / ${formatMeters( debug.placedModelMatrixTranslationDelta )}`, wide: true }
			]
		},
		{
			title: '707 点位诊断',
			tone: worldDeltaTone( Math.max( debug.currentModelActualWorldDeltaXZ ?? 0, debug.undergroundExpectedWorldDeltaXZ ?? 0, debug.undergroundMinusEngineeringXZ ?? 0 ) ),
			items: [
				{ label: '黄/工程紫/地下点漂移 XZ', value: `${formatMeters( debug.yellowWorldDeltaXZ )} / ${formatMeters( debug.purpleEngineeringWorldDeltaXZ )} / ${formatMeters( debug.undergroundExpectedWorldDeltaXZ )}`, wide: true },
				{ label: '当前模型实际点漂移 XZ / Y', value: `${formatMeters( debug.currentModelActualWorldDeltaXZ )} / ${formatMeters( debug.currentModelActualWorldDeltaY )}`, wide: true },
				{ label: '工程紫 - 黄色 XZ / Y', value: `${formatMeters( debug.engineeringMinusYellowXZ )} / ${formatMeters( debug.engineeringMinusYellowY )}`, wide: true },
				{ label: '地下点 - 工程紫 XZ / Y', value: `${formatMeters( debug.undergroundMinusEngineeringXZ )} / ${formatMeters( debug.undergroundMinusEngineeringY )}`, wide: true },
				{ label: '地下点 - 黄色 XZ / Y', value: `${formatMeters( debug.undergroundMinusYellowXZ )} / ${formatMeters( debug.undergroundMinusYellowY )}`, wide: true }
			]
		},
		{
			title: '屏幕视差',
			tone: debug.parallaxStatus === 'real-world-movement' || debug.parallaxStatus === 'matrix-space-error' ? 'error' : debug.parallaxStatus === 'likely-parallax' ? 'warning' : 'normal',
			items: [
				{ label: '黄色屏幕漂移', value: formatPixels( debug.yellowScreenDeltaPx ) },
				{ label: '地下点屏幕漂移', value: formatPixels( debug.undergroundExpectedScreenDeltaPx ) },
				{ label: '黄-地下点屏幕距离 初始/当前/变化', value: `${formatPixels( debug.yellowToUndergroundScreenDistanceInitialPx )} / ${formatPixels( debug.yellowToUndergroundScreenDistanceCurrentPx )} / ${formatPixels( debug.yellowToUndergroundScreenDistanceDeltaPx )}`, wide: true },
				{ label: '说明', value: '屏幕像素变化需结合 world delta 判断，不能单独判定模型移动。', wide: true }
			]
		},
		{
			title: '更新来源',
			tone: 'normal',
			items: [
				{ label: '黄色 / 工程紫更新', value: `${formatUpdateMeta( debug.yellowUpdateCount, debug.yellowLastUpdateReason )} / ${formatUpdateMeta( debug.purpleEngineeringUpdateCount, debug.purpleEngineeringLastUpdateReason )}`, wide: true },
				{ label: '地下点 / 当前实际点更新', value: `${formatUpdateMeta( debug.undergroundExpectedUpdateCount, debug.undergroundExpectedLastUpdateReason )} / ${formatUpdateMeta( debug.currentModelActualUpdateCount, debug.currentModelActualLastUpdateReason )}`, wide: true },
				{ label: 'placementAnchor 更新', value: `${formatUpdateMeta( debug.placementAnchorUpdateCount, debug.lastPlacementAnchorUpdateReason )}; frame ${formatBoolean( debug.placementAnchorUpdatedFromFrameLoop )}; hit-test ${formatBoolean( debug.placementAnchorUpdatedFromHitTest )}; reticle ${formatBoolean( debug.placementAnchorUpdatedFromReticle )}`, wide: true },
				{ label: '模型放置', value: `次数 ${debug.engineeringPlacementCallCount ?? 0}; 替换 ${debug.replacedModelCount ?? 0}; 原因 ${debug.lastPlacementReason ?? '-'}`, wide: true },
				{ label: '结论', value: debug.conclusion ?? '-', wide: true }
			]
		}
	];
} );

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
		arInfo( 'ArUiLocalizationStepChanged', {
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

function formatMeters(value: number | null | undefined): string {
	return typeof value === 'number' && Number.isFinite( value )
		? `${value.toFixed( 2 )}m`
		: '-';
}

function formatSignedMeters(value: number | null | undefined): string {
	return typeof value === 'number' && Number.isFinite( value )
		? `${value >= 0 ? '+' : ''}${value.toFixed( 2 )}m`
		: '-';
}

function formatPixels(value: number | null | undefined): string {
	return typeof value === 'number' && Number.isFinite( value ) ? `${value.toFixed( 1 )}px` : '-';
}

function formatTimestamp(value: number | undefined): string {
	return value === undefined ? '-' : new Date( value ).toLocaleTimeString( 'zh-CN', { hour12: false } );
}

function formatParentChain(value: string[] | undefined): string {
	return value?.join( ' -> ' ) || '-';
}

function worldDeltaTone(value: number): 'normal' | 'warning' | 'error' {
	return value > 0.1 ? 'error' : value >= 0.05 ? 'warning' : 'normal';
}

function matrixTone(debug: {
	engineeringMatrixChanged?: boolean;
	placedModelMatrixWorldChanged?: boolean;
	modelAnchorMatrixWorldChanged?: boolean;
	placementAnchorMatrixWorldChanged?: boolean;
	arFromEnuMatrixChanged?: boolean;
}): 'normal' | 'error' {
	return Object.values( debug ).some( Boolean ) ? 'error' : 'normal';
}

function formatDepthAxis(value: 'y' | 'shortest-edge' | 'bbox-y' | undefined): string {
	return value ?? '-';
}

function formatModelHeightSource(value: string | undefined): string {
	switch ( value ) {
		case 'override':
			return '配置模型高度';
		case 'normalized-bbox-y':
			return 'normalized model local bbox-y';
		case 'placeable-report-y':
			return 'final model Y size';
		case 'bbox-y':
			return '模型 bbox-y';
		case 'y':
			return '模型 y';
		case 'shortest-edge':
			return '最短边';
		case 'invalid':
			return '无效';
		default:
			return '-';
	}
}

function formatOpacity(value: number | null | undefined): string {
	if ( typeof value !== 'number' || Number.isFinite( value ) === false ) {
		return '-';
	}
	return value <= 1 ? value.toFixed( 2 ) : `${value.toFixed( 0 )}%`;
}

function formatVector3Compact(
	value: { x: number; y: number; z: number } | null | undefined
): string {
	if ( value === undefined || value === null ) {
		return '-';
	}
	return `${value.x.toFixed( 2 )},${value.y.toFixed( 2 )},${value.z.toFixed( 2 )}`;
}

function formatUpdateMeta(count: number | undefined, reason: string | undefined): string {
	return `${count ?? 0}@${reason ?? 'none'}`;
}

async function copyModelPlacementDiagnostics(): Promise<void> {
	const debug = engine.value.modelPlacementDebug;
	const payload = {
		buildCommit: debug.buildCommit ?? null,
		sessionId: debug.sessionId ?? null,
		undergroundPlacementMode: debug.undergroundPlacementMode ?? null,
		modelHeightSource: debug.modelHeightSource ?? null,
		depthMeters: debug.depthMeters ?? null,
		modelHeight: debug.modelHeight ?? null,
		coverDepthMeters: debug.coverDepthMeters ?? null,
		totalBottomDepthMeters: debug.totalBottomDepthMeters ?? null,
		engineeringUndergroundOffsetY: debug.engineeringUndergroundOffsetY ?? null,
		surfaceElevationText: debug.surfaceElevationText ?? null,
		undergroundElevationText: debug.undergroundElevationText ?? null,
		cameraMovedDistance: debug.cameraMovedDistance ?? null,
		placedModelDeltaXZ: debug.placedModelDeltaXZ ?? debug.modelWorldDeltaXZ ?? null,
		modelAnchorDeltaXZ: debug.modelAnchorDeltaXZ ?? debug.arModelAnchorWorldDeltaXZ ?? null,
		placementAnchorDeltaXZ: debug.placementAnchorDeltaXZ ?? debug.arPlacementAnchorWorldDeltaXZ ?? null,
		cameraToModelDistanceInitial: debug.cameraToModelDistanceInitial ?? null,
		cameraToModelDistanceCurrent: debug.cameraToModelDistanceCurrent ?? null,
		cameraToModelDistanceDelta: debug.cameraToModelDistanceDelta ?? null,
		engineeringMatrixChanged: debug.engineeringMatrixChanged ?? null,
		placedModelMatrixWorldChanged: debug.placedModelMatrixWorldChanged ?? null,
		arFromEnuMatrixChanged: debug.arFromEnuMatrixChanged ?? null,
		engineeringMinusYellowXZ: debug.engineeringMinusYellowXZ ?? null,
		engineeringMinusYellowY: debug.engineeringMinusYellowY ?? null,
		undergroundMinusEngineeringXZ: debug.undergroundMinusEngineeringXZ ?? null,
		undergroundMinusEngineeringY: debug.undergroundMinusEngineeringY ?? null,
		yellowWorldDeltaXZ: debug.yellowWorldDeltaXZ ?? null,
		purpleEngineeringWorldDeltaXZ: debug.purpleEngineeringWorldDeltaXZ ?? null,
		undergroundExpectedWorldDeltaXZ: debug.undergroundExpectedWorldDeltaXZ ?? null,
		currentModelActualWorldDeltaXZ: debug.currentModelActualWorldDeltaXZ ?? null,
		yellowToUndergroundScreenDistanceDeltaPx: debug.yellowToUndergroundScreenDistanceDeltaPx ?? null,
		yellowUpdateCount: debug.yellowUpdateCount ?? 0,
		purpleEngineeringUpdateCount: debug.purpleEngineeringUpdateCount ?? 0,
		undergroundExpectedUpdateCount: debug.undergroundExpectedUpdateCount ?? 0,
		currentModelActualUpdateCount: debug.currentModelActualUpdateCount ?? 0,
		placementAnchorUpdateCount: debug.placementAnchorUpdateCount ?? 0,
		engineeringPlacementCallCount: debug.engineeringPlacementCallCount ?? 0,
		replacedModelCount: debug.replacedModelCount ?? 0,
		conclusion: debug.conclusion ?? null
	};
	try {
		await navigator.clipboard.writeText( JSON.stringify( payload, null, 2 ) );
		diagnosticCopyFeedback.value = '诊断数据已复制';
	} catch {
		diagnosticCopyFeedback.value = '复制失败，请检查浏览器剪贴板权限';
	}
}

function formatBoolean(value: boolean | undefined): string {
	if ( value === true ) {
		return '是';
	}
	if ( value === false ) {
		return '否';
	}
	return '-';
}

function formatChanged(value: boolean | undefined): string {
	return value === true ? '是' : '否';
}

function formatBuriedDepthSource(source: string | undefined): string {
	if ( source === 'model-height' ) {
		return '模型高度';
	}
	if ( source === 'configured-number' ) {
		return '配置数值';
	}
	return '未配置';
}

function formatUndergroundPlacementMode(mode: string | undefined): string {
	if ( mode === 'rtk-derived-elevation' ) {
		return 'RTK surface elevation derived';
	}
	if ( mode === 'visual-offset' ) {
		return 'visual offset';
	}
	return '-';
}

function formatHorizontalStatus(value: number | undefined): string {
	if ( typeof value !== 'number' || Number.isFinite( value ) === false ) {
		return '工程水平误差未知';
	}
	if ( value < 0.1 ) {
		return '工程水平误差正常';
	}
	if ( value <= 0.3 ) {
		return '工程水平误差警告';
	}
	return '工程水平误差异常';
}

function formatWorldLockStatus(
	status: string | undefined,
	isWorldLocked: boolean | null | undefined
): string {
	if ( status === 'normal' || isWorldLocked === true ) {
		return 'World Lock 正常';
	}
	if ( status === 'error' ) {
		return 'World Lock 异常';
	}
	if ( status === 'warning' ) {
		return 'World Lock 警告';
	}
	return '请移动手机后再判断';
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

async function selectUndergroundViewMode(mode: 'portal' | 'real-space'): Promise<void> {

	displaySelectionError.value = '';
	const result = await store.actions.setUndergroundViewMode( mode );
	if ( result.applied && result.effectiveMode === mode ) store.actions.closeDrawer();
	else displaySelectionError.value = result.failureReason === 'no-renderable-mesh-structure'
		? '未检测到可渲染的地下模型，已切换到真实空间。'
		: '地下顶视暂不可用，已保持真实空间显示。';

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
	arInfo( 'MarkerCalibrationApplyClicked', {
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
		arWarn( 'MarkerCalibrationApplyBlockedInUi', {
			reason: blockedReason,
			createdAt: Date.now()
		} );
		return;
	}

	const applied = store.actions.solveAndApplyCurrentSessionMarkerCalibration();
	arInfo( 'MarkerCalibrationApplyResult', {
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
		arWarn( 'MarkerCalibrationApplyFailedInUi', {
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
		arWarn( 'EngineeringPlacementBlockedInUi', {
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
	if ( floatingInputFrame !== 0 ) cancelAnimationFrame( floatingInputFrame );
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

		<ArFloatingValueRail
			v-if="hasArSession && ui.drawerOpen === false && floatingAdjustment !== null && showMarkerCalibrationOverlay === false"
			:model-value="floatingAdjustment.value"
			:ariaLabel="floatingAdjustment.label"
			@update:model-value="updateFloatingValue"
			@change-start="store.actions.handleArUiInteraction()"
		/>

		<transition name="sheet-fade">
			<section
				v-if="ui.drawerOpen && showMarkerCalibrationOverlay === false"
				class="bottom-sheet"
				@pointerdown.stop="store.actions.handleArUiInteraction()"
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
					<UndergroundDisplayControls :view-mode="engine.undergroundViewMode" :material-mode="engine.undergroundMaterialMode" :inspection-tool="engine.undergroundInspectionTool" :section-mode="engine.sectionCutPlaneMode" :error="displaySelectionError" @view="selectUndergroundViewMode" @material="selectMaterialMode" @tool="selectInspectionTool" @section="selectSectionMode" />
				</template>

				<template v-else-if="activePanelView === 'localization'">
					<ArPanelSection title="工程配置" first>
						<ArInfoGrid :items="configCards" />
						<div v-for="warning in configWarnings" :key="warning" class="runtime-banner warning">
							{{ warning }}
						</div>
						<button type="button" class="debug-toggle" @click="modelPlacementDiagnosticOpen = !modelPlacementDiagnosticOpen">
							{{ modelPlacementDiagnosticOpen ? '收起模型诊断' : '模型诊断' }}
						</button>
						<div v-if="modelPlacementDiagnosticOpen" class="model-diagnostic-groups">
							<div
								v-for="group in modelPlacementDebugGroups"
								:key="group.title"
								class="model-diagnostic-group"
								:class="group.tone"
							>
								<div class="section-label">{{ group.title }}</div>
								<ArInfoGrid :items="group.items" />
							</div>
							<button type="button" class="debug-toggle" @click="copyModelPlacementDiagnostics()">
								复制诊断数据
							</button>
							<div v-if="diagnosticCopyFeedback" class="runtime-banner">
								{{ diagnosticCopyFeedback }}
							</div>
							<details v-if="arDebugMode" class="diagnostic-raw">
								<summary>Raw debug JSON / matrices</summary>
								<pre>{{ JSON.stringify(engine.modelPlacementDebug, null, 2) }}</pre>
							</details>
						</div>
						<button v-if="arDebugMode" type="button" class="debug-toggle" @click="debugInfoOpen = !debugInfoOpen">
							{{ debugInfoOpen ? '收起调试信息' : '展开调试信息' }}
						</button>
						<ArInfoGrid v-if="arDebugMode && debugInfoOpen" :items="debugCards" />
							<button v-if="arDebugMode" type="button" class="debug-toggle" @click="registrationDiagnosticOpen = !registrationDiagnosticOpen">
							{{ registrationDiagnosticOpen ? '收起配准诊断' : '配准诊断' }}
						</button>
						<ArInfoGrid v-if="arDebugMode && registrationDiagnosticOpen" :items="registrationDiagnosticCards" />
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

.model-diagnostic-groups {
	display: grid;
	gap: 12px;
	margin-top: 10px;
}

.model-diagnostic-group {
	padding-left: 8px;
	border-left: 3px solid #22c55e;
}

.model-diagnostic-group.warning {
	border-left-color: #facc15;
}

.model-diagnostic-group.error {
	border-left-color: #ef4444;
}

.diagnostic-raw {
	font-size: 12px;
	color: rgba(230, 240, 255, 0.88);
}

.diagnostic-raw pre {
	max-height: 320px;
	overflow: auto;
	white-space: pre-wrap;
	word-break: break-word;
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

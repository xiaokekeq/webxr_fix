<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import ArInfoGrid from '@/components/ar/ArInfoGrid.vue';
import ArModelInfoPanel from '@/components/ar/ArModelInfoPanel.vue';
import ArPanelSection from '@/components/ar/ArPanelSection.vue';
import ArPlacementStatusSection from '@/components/ar/ArPlacementStatusSection.vue';
import CpuDepthDebugOverlay from '@/components/ar/CpuDepthDebugOverlay.vue';
import { cpuDepthDebugState } from '@/engine/visualization/cpu-depth-visualization.js';
import { useArShellStore } from '@/features/ar/stores/ar-shell.js';

type CalibrationPanelView = 'overview' | 'config' | 'model' | 'marker' | 'rtk' | 'save' | 'ar-check';

const PANEL_OPTIONS: Array<{ value: CalibrationPanelView; label: string }> = [
	{ value: 'overview', label: '工程概览' },
	{ value: 'config', label: '完整性' },
	{ value: 'model', label: '模型到 ENU' },
	{ value: 'marker', label: '控制标志' },
	{ value: 'rtk', label: 'RTK 数据' },
	{ value: 'save', label: '保存确认' },
	{ value: 'ar-check', label: 'AR 校验' }
];

const route = useRoute();
const store = useArShellStore();

const canvasHost = ref<HTMLElement | null>( null );
const xrButtonHost = ref<HTMLElement | null>( null );
const activePanelView = ref<CalibrationPanelView>( 'overview' );
const markerCalibrationOverlayOpen = ref( false );

const engine = computed( () => store.engine );
const ui = computed( () => store.ui );
const hasArSession = computed( () => engine.value.appMode === 'ar-session' );
const hitTestReady = computed(
	() => engine.value.arSessionPhase === 'ready-to-place'
		|| engine.value.arSessionPhase === 'placing'
		|| engine.value.arSessionPhase === 'placed'
);
const configStatus = computed( () => engine.value.engineeringConfigStatus );
const currentModel = computed(
	() => engine.value.availableModels.find( ( item ) => item.id === engine.value.selectedModelId )
);
const currentModelName = computed( () => currentModel.value?.name ?? '未选择站点' );
const currentConfigUrl = computed( () => currentModel.value?.configUrl ?? '-' );
const primaryAsset = computed( () => {
	const model = currentModel.value;
	if ( model === undefined ) {
		return undefined;
	}

	return model.assets.find( ( item ) => item.id === model.primaryAssetId ) ?? model.assets[ 0 ];
} );

const sessionStatusText = computed( () => {
	if ( hasArSession.value === false ) {
		return '待进入 AR';
	}

	if ( engine.value.markerCalibration.active ) {
		return `采集 Marker 四角点 ${engine.value.markerCalibration.capturedCornerCount}/${engine.value.markerCalibration.expectedCornerCount}`;
	}

	if ( engine.value.registrationChainDebug.arSessionLocalization.available ) {
		return '当前会话空间校正完成';
	}

	switch ( engine.value.arSessionPhase ) {
		case 'scanning':
			return '正在扫描平面';
		case 'ready-to-place':
			return '已检测到地面，请完成控制标志四角点校正';
		case 'placing':
			return '正在按工程坐标放置模型';
		case 'placed':
			return '模型已按工程坐标显示';
		default:
			return engine.value.runtimeStatus;
	}
} );

const overviewCards = computed( () => [
	{ label: 'siteId', value: engine.value.selectedModelId || '-' },
	{ label: 'siteName', value: currentModelName.value },
	{ label: 'siteOrigin', value: configStatus.value.hasSiteOrigin ? configStatus.value.siteOriginText : '缺失', wide: true },
	{ label: '配置 JSON', value: currentConfigUrl.value, wide: true },
	{ label: '数据来源', value: formatEngineeringDataSource() },
	{ label: '是否示例数据', value: configStatus.value.hasMockEngineeringData ? '是' : '否' }
] );

const configCards = computed( () => [
	{ label: 'siteOrigin', value: configStatus.value.hasSiteOrigin ? configStatus.value.siteOriginText : '未配置', wide: true },
	{ label: 'modelLocalToEnu', value: configStatus.value.modelLocalToEnuText },
	{ label: 'rtkSurveyDataset', value: formatRtkDatasetStatus() },
	{ label: 'controlTargets', value: configStatus.value.hasControlTargets ? `${configStatus.value.controlTargetCount} 个` : '未配置' },
	{ label: '当前 Marker', value: formatActiveMarkerText(), wide: true },
	{ label: 'cornersEnu', value: configStatus.value.activeControlTargetHasCornersEnu ? '已配置' : '缺失' },
	{ label: 'placementAnchorEnu', value: configStatus.value.hasPlacementAnchor ? configStatus.value.placementAnchorText : '未配置', wide: true },
	{ label: '数据来源', value: configStatus.value.hasMockEngineeringData ? 'mock' : configStatus.value.engineeringDataSourceText },
	{ label: 'undergroundObjects', value: `${configStatus.value.undergroundObjectCount} 个` },
	{ label: 'sensors', value: `${configStatus.value.sensorCount} 个` },
	{ label: 'riskPoints', value: `${configStatus.value.riskPointCount} 个` }
] );

const modelToEnuCards = computed( () => [
	{ label: 'modelLocalToEnu 状态', value: configStatus.value.modelLocalToEnuText, wide: true },
	{ label: '模型控制点', value: `${engine.value.registrationChainDebug.engineeringControlRegistration.controlPointCount} 个` },
	{ label: 'registration mode', value: configStatus.value.registrationModeText },
	{ label: 'unitScale', value: engine.value.modelScaleSummary.unitScaleText },
	{ label: 'upAxis', value: primaryAsset.value?.assetTransform?.upAxis ?? 'y' },
	{ label: 'scale 是否固定 1', value: configStatus.value.modelToSiteScaleText === '1.000000' ? '是' : `否：${configStatus.value.modelToSiteScaleText}` },
	{ label: '模型单位', value: '按米解释' }
] );

const rtkCards = computed( () => [
	{ label: 'rtkSurveyDataset', value: configStatus.value.hasRtkSurveyDataset ? '存在' : '缺失' },
	{ label: '点数量', value: `${configStatus.value.rtkPointCount}` },
	{ label: 'coordinateSystem', value: configStatus.value.rtkCoordinateSystemText },
	{ label: 'mock/demo 点', value: configStatus.value.mockRtkPointIds.length > 0 ? configStatus.value.mockRtkPointIds.join( '、' ) : '未标记' , wide: true },
	{ label: '需替换字段', value: 'siteOrigin、rtkSurveyDataset.points、controlTargets.centerEnu、controlTargets.cornersEnu、controlPoints[].enu、placementAnchorEnu', wide: true }
] );

const saveCards = computed( () => [
	{ label: '保存内容', value: '工程配置确认 / 校验备注', wide: true },
	{ label: '不会保存', value: '当前 AR 会话矩阵、XR anchor、ENU -> AR local', wide: true },
	{ label: 'AR 巡查要求', value: '仍需在当前会话中完成控制标志校正', wide: true }
] );

const configWarnings = computed( () => {
	const warnings: string[] = [];
	if ( configStatus.value.hasRtkSurveyDataset === false ) {
		warnings.push( '当前模型未配置 RTK 测量数据，请补充工程真值配置。' );
	}
	if ( configStatus.value.hasControlTargets === false ) {
		warnings.push( '当前模型未配置控制标志，无法进行正式 AR 空间校正。' );
	}
	if ( configStatus.value.hasPlacementAnchor === false ) {
		warnings.push( '当前模型未配置 placementAnchorEnu。' );
	}
	if ( configStatus.value.activeControlTargetHasCornersEnu === false ) {
		warnings.push( '当前控制标志未配置 cornersEnu，正式巡查前请补充 RTK 实测四角点。' );
	}
	for ( const hint of configStatus.value.recommendedFieldHints ) {
		warnings.push( hint );
	}
	if ( configStatus.value.hasMockEngineeringData ) {
		warnings.push( configStatus.value.mockWarningText );
	}
	if ( configStatus.value.baselineMismatch ) {
		warnings.push( '已保存现场基准与模型配置可能不一致，请确认是否更新基准配置。' );
	}
	return warnings;
} );

function formatRtkDatasetStatus(): string {
	if ( configStatus.value.hasRtkSurveyDataset === false ) {
		return '未加载';
	}

	return configStatus.value.hasMockEngineeringData
		? `示例数据 ${configStatus.value.rtkPointCount} 点`
		: `已加载 ${configStatus.value.rtkPointCount} 点`;
}

function formatActiveMarkerText(): string {
	const id = configStatus.value.activeControlTargetId ?? '-';
	const name = configStatus.value.activeControlTargetName ?? '-';
	return `${id} / ${name}`;
}

function formatEngineeringDataSource(): string {
	if ( configStatus.value.hasMockEngineeringData ) {
		return 'mock';
	}

	if ( configStatus.value.engineeringDataSourceText === 'json' ) {
		return 'JSON';
	}

	if ( configStatus.value.engineeringDataSourceText === 'backend' ) {
		return '后端预留';
	}

	return configStatus.value.engineeringDataSourceText;
}

const markerCards = computed( () => {
	if ( configStatus.value.controlTargetSummaries.length === 0 ) {
		return [ { label: '控制标志', value: '未配置', wide: true } ];
	}

	return configStatus.value.controlTargetSummaries.flatMap( ( target, index ) => [
		{ label: `Marker ${index + 1}`, value: `${target.name} / ${target.id}`, wide: true },
		{ label: 'centerEnu', value: target.centerEnuText, wide: true },
		{ label: 'cornersEnu', value: target.cornersEnuText, wide: true },
		{ label: 'cornerOrder', value: target.cornerOrderText, wide: true },
		{ label: 'yawDeg', value: target.yawDegText },
		{ label: 'sizeMeters', value: target.sizeMetersText },
		{ label: 'plane', value: target.planeText }
	] );
} );

const markerCalibrationCards = computed( () => [
	{ label: '目标 Marker', value: configStatus.value.controlTargetSummaries[ 0 ]?.name ?? engine.value.markerCalibration.markerId ?? '-' },
	{ label: 'Marker id', value: engine.value.markerCalibration.markerId ?? configStatus.value.activeControlTargetId ?? '-' },
	{ label: '当前要采集', value: engine.value.markerCalibration.nextCornerLabel || '-' },
	{ label: '已采集数量', value: `${engine.value.markerCalibration.capturedCornerCount}` },
	{ label: '角点总数', value: `${engine.value.markerCalibration.expectedCornerCount}` },
	{ label: '错误原因', value: engine.value.runtimeStatus || '-', wide: true }
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
const showMarkerCalibrationOverlay = computed(
	() => hasArSession.value && markerCalibrationOverlayOpen.value && engine.value.markerCalibration.active
);
const canUseMarkerCorners = computed( () => configStatus.value.activeControlTargetHasCornersEnu );
const canStartMarkerCalibration = computed(
	() => hasArSession.value && hitTestReady.value && canUseMarkerCorners.value
);
const canCaptureMarkerCorner = computed(
	() => showMarkerCalibrationOverlay.value && hitTestReady.value && canUseMarkerCorners.value
);
const canApplyMarkerCalibration = computed(
	() => canCaptureMarkerCorner.value
		&& configStatus.value.hasMockEngineeringData === false
		&& engine.value.markerCalibration.capturedCornerCount >= engine.value.markerCalibration.expectedCornerCount
);
const markerApplyBlockedText = computed( () => (
	configStatus.value.hasMockEngineeringData
		? configStatus.value.mockWarningText || '当前为示例工程坐标，请替换为 RTK 实测数据。'
		: ''
) );
const markerCornerPrompt = computed( () => {
	if ( canUseMarkerCorners.value === false ) {
		return '当前控制标志缺少四角点工程坐标，无法进行 Marker 四角点校正。';
	}
	if ( hasArSession.value && hitTestReady.value === false ) {
		return '请缓慢移动设备，扫描地面。';
	}

	const label = engine.value.markerCalibration.nextCornerLabel;
	if ( label.includes( '左上' ) || label.includes( 'leftTop' ) ) {
		return '请将准星对准控制标志左上角 LT，并点击采集。';
	}
	if ( label.includes( '右上' ) || label.includes( 'rightTop' ) ) {
		return '请将准星对准控制标志右上角 RT，并点击采集。';
	}
	if ( label.includes( '右下' ) || label.includes( 'rightBottom' ) ) {
		return '请将准星对准控制标志右下角 RB，并点击采集。';
	}
	if ( label.includes( '左下' ) || label.includes( 'leftBottom' ) ) {
		return '请将准星对准控制标志左下角 LB，并点击采集。';
	}
	return '请按左上角、右上角、右下角、左下角顺序采集控制标志四角。';
} );

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

function closeDrawerIfOpen(): void {
	if ( ui.value.drawerOpen ) {
		store.actions.toggleDrawer();
	}
}

async function handleStartPrecisionCalibration(): Promise<void> {
	activePanelView.value = 'ar-check';
	store.actions.startCurrentSessionMarkerCalibration();
	await nextTick();
	if ( engine.value.markerCalibration.active ) {
		markerCalibrationOverlayOpen.value = true;
		closeDrawerIfOpen();
	}
}

function handleCapturePrecisionCalibrationCorner(): void {
	store.actions.captureCurrentSessionMarkerCorner();
}

async function handleResetPrecisionCalibration(): Promise<void> {
	activePanelView.value = 'ar-check';
	if ( engine.value.markerCalibration.active ) {
		store.actions.cancelCurrentSessionMarkerCalibration();
		await nextTick();
	}
	store.actions.startCurrentSessionMarkerCalibration();
	await nextTick();
	markerCalibrationOverlayOpen.value = engine.value.markerCalibration.active;
	closeDrawerIfOpen();
}

async function handleSolvePrecisionCalibration(): Promise<void> {
	activePanelView.value = 'ar-check';
	store.actions.solveAndApplyCurrentSessionMarkerCalibration();
	await nextTick();
	markerCalibrationOverlayOpen.value = engine.value.markerCalibration.active;
	closeDrawerIfOpen();
}

async function handleExitPrecisionCalibration(): Promise<void> {
	if ( engine.value.markerCalibration.active ) {
		store.actions.cancelCurrentSessionMarkerCalibration();
	}
	markerCalibrationOverlayOpen.value = false;
	await nextTick();
	closeDrawerIfOpen();
}

const cpuDepthButtonLabel = computed( () => {
	if ( cpuDepthDebugState.enabled ) {
		return '隐藏 CPU Depth 深度图';
	}
	if ( cpuDepthDebugState.supported === false ) {
		return '当前设备不支持 CPU Depth';
	}
	if ( cpuDepthDebugState.errorMessage ) {
		return 'CPU Depth 不可用';
	}
	return '显示 CPU Depth 深度图';
} );

function handleToggleCpuDepthDebug(): void {
	store.actions.toggleCpuDepthDebug();
}

function handleSaveBaseline(): void {
	console.info( '[EngineeringCalibrationSaveValidated]', {
		mode: engine.value.workflowMode,
		siteId: engine.value.selectedModelId || null,
		modelId: engine.value.selectedModelId || null,
		sessionId: engine.value.markerCalibration.currentSessionId,
		currentStep: 'save-engineering-calibration',
		localizationSource: engine.value.registrationChainDebug.arSessionLocalization.source,
		targetId: configStatus.value.activeControlTargetId ?? null,
		message: '保存工程配置确认状态；不保存 ENU -> AR local、XR anchor 或 modelRoot transform。'
	} );
	store.actions.saveSiteCalibrationBaseline();
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
			<header
				v-if="showMarkerCalibrationOverlay === false"
				class="page-header"
				@pointerdown.stop="store.actions.handleArUiInteraction()"
				@click.stop
			>
				<div>
					<div class="page-title">工程配准数据配置 / 校验</div>
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
					<div class="launch-badge">RTK</div>
					<div class="launch-title">工程配置校验</div>
					<p class="launch-subtitle">
						本页面用于校验工程配准数据、RTK 数据和控制标志。不会保存当前 AR 会话矩阵。
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
						进入 AR 校验
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
				v-if="hasArSession && ui.drawerOpen && showMarkerCalibrationOverlay === false"
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

				<template v-if="activePanelView === 'overview'">
					<ArPanelSection title="工程配准总览" first>
						<ArInfoGrid :items="overviewCards" />
						<div class="runtime-banner">
							长期工程数据来自 JSON 或后端配置；当前 AR 会话的 ENU -> AR local 解只在本次 session 内有效。
						</div>
						<div class="runtime-banner">
							CPU Depth 仅用于实时深度可视化调试，不参与工程配准和模型定位。
						</div>
						<div class="action-row">
							<button type="button" class="action-button primary" @click="handleSaveBaseline()">
								保存工程配置确认
							</button>
						</div>
					</ArPanelSection>
				</template>

				<template v-else-if="activePanelView === 'config'">
					<ArPanelSection title="工程配置完整性" first>
						<ArInfoGrid :items="configCards" />
						<div v-for="warning in configWarnings" :key="warning" class="runtime-banner warning">
							{{ warning }}
						</div>
					</ArPanelSection>
				</template>

				<template v-else-if="activePanelView === 'model'">
					<ArPanelSection title="模型到工程坐标" first>
						<ArInfoGrid :items="modelToEnuCards" />
						<div v-if="configStatus.modelLocalToEnuSource === 'control-points'" class="runtime-banner">
							当前 modelLocalToEnu 由 controlPoints 求解；每个控制点需要同时配置 modelLocal 和 enu。
						</div>
					</ArPanelSection>
				</template>

				<template v-else-if="activePanelView === 'marker'">
					<ArPanelSection title="控制标志工程坐标" first>
						<ArInfoGrid :items="markerCards" />
						<div class="runtime-banner">
							当前 ENU 数组顺序为 [east, north, up]。
						</div>
						<div class="runtime-banner">
							请将控制标志固定在地面，四角清晰可见，并按 LT / RT / RB / LB 顺序采集。
						</div>
						<div class="runtime-banner">
							Marker 四角点用于当前 AR 会话空间校正；模型控制点用于模型到工程坐标配准，二者不要混用。
						</div>
						<div class="runtime-banner">
							真实 RTK 导入顺序：cornersEnu[0]=leftTop/LT，cornersEnu[1]=rightTop/RT，cornersEnu[2]=rightBottom/RB，cornersEnu[3]=leftBottom/LB。
						</div>
						<div v-if="configStatus.activeControlTargetHasCornersEnu === false" class="runtime-banner warning">
							当前控制标志缺少四角点工程坐标，无法进行四角点校正。
						</div>
					</ArPanelSection>
				</template>

				<template v-else-if="activePanelView === 'rtk'">
					<ArPanelSection title="RTK 测量数据" first>
						<ArInfoGrid :items="rtkCards" />
						<div v-if="configStatus.hasMockEngineeringData" class="runtime-banner warning">
							{{ configStatus.mockWarningText }}
						</div>
					</ArPanelSection>
				</template>

				<template v-else-if="activePanelView === 'ar-check'">
					<ArPlacementStatusSection :state="engine" title="AR 校验状态" first />
					<ArPanelSection title="地底预览">
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
						<div class="runtime-banner">
							仅移动当前显示模型，不修改 RTK 配准和保存数据。
						</div>
					</ArPanelSection>
					<ArPanelSection title="手动 Marker 四角点校验">
						<ArInfoGrid :items="markerCalibrationCards" />
						<div class="runtime-banner">
							请按 leftTop、rightTop、rightBottom、leftBottom 的顺序采集控制标志四角。
						</div>
						<div class="chip-grid">
							<button
								type="button"
								class="chip-button"
								:disabled="canStartMarkerCalibration === false"
								@click="handleStartPrecisionCalibration()"
							>
								开始四角点采集
							</button>
						</div>
					</ArPanelSection>
				</template>

				<template v-else-if="activePanelView === 'save'">
					<ArPanelSection title="保存配置确认" first>
						<ArInfoGrid :items="saveCards" />
						<div class="runtime-banner">
							本页面不会保存当前 AR 会话矩阵；AR 巡查仍需在当前会话中完成控制标志校正。
						</div>
						<div class="action-row">
							<button type="button" class="action-button primary" @click="handleSaveBaseline()">
								保存工程配置确认
							</button>
						</div>
					</ArPanelSection>
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
			<div v-if="markerApplyBlockedText" class="marker-calibration-warning">
				{{ markerApplyBlockedText }}
			</div>
			<div class="marker-calibration-actions">
				<button
					type="button"
					class="marker-action primary"
					:disabled="canCaptureMarkerCorner === false"
					@click="handleCapturePrecisionCalibrationCorner()"
				>
					采集当前角点
				</button>
				<button
					type="button"
					class="marker-action success"
					:disabled="canApplyMarkerCalibration === false"
					@click="handleSolvePrecisionCalibration()"
				>
					完成校正
				</button>
				<button type="button" class="marker-action" @click="handleResetPrecisionCalibration()">
					重置采集
				</button>
				<button type="button" class="marker-action" @click="handleExitPrecisionCalibration()">
					退出
				</button>
			</div>
		</section>

		<CpuDepthDebugOverlay />

		<nav
			v-if="hasArSession && showMarkerCalibrationOverlay === false"
			class="action-dock action-dock-compact"
			aria-label="AR 校验操作"
			@pointerdown.stop="store.actions.handleArUiInteraction()"
			@click.stop
		>
			<button type="button" class="dock-item dock-item-primary" @click.stop="toggleWorkspacePanel">
				<span class="dock-icon">板</span>
				<span class="dock-label">校验面板</span>
			</button>
			<button
				type="button"
				class="dock-item"
				:class="{ 'dock-item-active': cpuDepthDebugState.enabled }"
				@click.stop="handleToggleCpuDepthDebug"
			>
				<span class="dock-icon">深</span>
				<span class="dock-label">{{ cpuDepthButtonLabel }}</span>
			</button>
			<button type="button" class="dock-item" @click.stop="store.actions.exitAr()">
				<span class="dock-icon">退</span>
				<span class="dock-label">退出 AR</span>
			</button>
		</nav>

		<ArModelInfoPanel
			v-if="hasArSession && ui.drawerOpen === false && showMarkerCalibrationOverlay === false"
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
.sheet-close {
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

.dock-item-active {
	background: rgba(0, 255, 168, 0.18);
	border-color: rgba(0, 255, 168, 0.42);
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

.marker-calibration-warning {
	padding: 7px 9px;
	border-radius: 11px;
	background: rgba(245, 158, 11, 0.14);
	border: 1px solid rgba(245, 158, 11, 0.3);
	color: #ffe8b6;
	font-size: 11px;
	line-height: 1.4;
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

.action-row {
	margin-top: 12px;
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

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ArInfoGrid from '@/components/ar/ArInfoGrid.vue';
import ArModelInfoPanel from '@/components/ar/ArModelInfoPanel.vue';
import ArPanelSection from '@/components/ar/ArPanelSection.vue';
import {
	DISPLAY_MODE_OPTIONS,
	SECTION_CUT_PLANE_MODE_OPTIONS
} from '@/features/ar/types/display-modes.js';
import { useArShellStore } from '@/features/ar/stores/ar-shell.js';

type InspectPanelView = 'display' | 'localization' | 'record';

const TEXT = {
	title: '堤防 AR 巡查',
	enterArTitle: '进入 AR 巡查',
	enterArSub: '读取工程真值配置后进入 AR。hit-test 只用于确认平面就绪；请手动采集现场 Marker 四角点，校正成功后模型才会按工程坐标正式显示。',
	enterAr: '进入 AR',
	selectModel: '选择站点',
	status: '状态',
	waiting: '待进入 AR',
	scanning: '正在扫描平面',
	ready: '平面已识别，等待空间校正',
	placing: '正在应用空间校正',
	placed: '巡查中',
	panelTool: '控制面板',
	exit: '退出 AR',
	takeSnapshot: '截图',
	closePanel: '收起',
	display: '显示控制',
	localization: '巡查流程',
	record: '巡查记录',
	configStatus: '工程配置状态',
	localizationStatus: '当前会话空间校正',
	displayMode: '模型显示',
	sectionPlane: '剖切方向',
	placementSource: '校正方式',
	calibrationPanel: '手动 Marker 四角点校正',
	cornerProgress: '角点进度',
	nextCorner: '当前要采集',
	targetMarker: '目标 Marker',
	startCalibration: '手动 Marker 四角点校正',
	captureCorner: '采集当前角点',
	applyCalibration: '完成校正',
	resetCalibration: '重置角点',
	inspectionResult: '结果',
	inspectionType: '类型',
	inspectionSeverity: '等级',
	inspectionNote: '备注',
	saveInspection: '保存巡查记录',
	exportRecords: '导出巡查记录',
	unknownModel: '未选择站点'
} as const;

const PANEL_OPTIONS: Array<{ value: InspectPanelView; label: string }> = [
	{ value: 'display', label: TEXT.display },
	{ value: 'localization', label: TEXT.localization },
	{ value: 'record', label: TEXT.record }
];

const route = useRoute();
const router = useRouter();
const store = useArShellStore();

const canvasHost = ref<HTMLElement | null>( null );
const xrButtonHost = ref<HTMLElement | null>( null );
const activePanelView = ref<InspectPanelView>( 'localization' );
const markerCalibrationOverlayOpen = ref( false );

const engine = computed( () => store.engine );
const ui = computed( () => store.ui );
const hasArSession = computed( () => engine.value.appMode === 'ar-session' );
const currentModelName = computed(
	() => engine.value.availableModels.find( ( item ) => item.id === engine.value.selectedModelId )?.name ?? TEXT.unknownModel
);
const currentConfigUrl = computed(
	() => engine.value.availableModels.find( ( item ) => item.id === engine.value.selectedModelId )?.configUrl ?? '-'
);
const configStatus = computed( () => engine.value.engineeringConfigStatus );
const activeTarget = computed( () => configStatus.value.controlTargetSummaries[ 0 ] );
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
		return '请进入 AR 巡查';
	}

	if ( engine.value.markerCalibration.active ) {
		return `手动四角点：${engine.value.markerCalibration.capturedCornerCount}/${engine.value.markerCalibration.expectedCornerCount}，请采集 ${engine.value.markerCalibration.nextCornerLabel || '下一个角点'}`;
	}

	if ( modelPlaced.value ) {
		return '模型已按工程坐标显示';
	}

	if ( localizationReady.value ) {
		return hitTestReady.value
			? '当前会话空间校正完成，等待模型自动放置'
			: '当前会话空间校正完成，等待地面检测';
	}

	if ( hitTestReady.value ) {
		return '已检测到地面，请完成控制标志四角点校正';
	}

	return engine.value.runtimeStatus || TEXT.scanning;
} );

const configCards = computed( () => [
	{ label: '当前站点 / 模型', value: currentModelName.value, wide: true },
	{ label: '配置 JSON', value: currentConfigUrl.value, wide: true },
	{ label: '数据来源', value: configStatus.value.hasMockEngineeringData ? 'mock' : configStatus.value.engineeringDataSourceText },
	{ label: '数据状态', value: configStatus.value.hasMockEngineeringData ? '示例数据' : configStatus.value.hasRtkSurveyDataset ? 'RTK 实测数据' : '未知' },
	{ label: 'RTK 数据', value: formatRtkDatasetStatus() },
	{ label: 'siteOrigin', value: configStatus.value.hasSiteOrigin ? configStatus.value.siteOriginText : '未配置', wide: true },
	{ label: 'modelLocalToEnu', value: configStatus.value.modelLocalToEnuText },
	{ label: '模型控制点', value: `${engine.value.registrationChainDebug.engineeringControlRegistration.controlPointCount} 个` },
	{ label: 'controlTargets', value: configStatus.value.hasControlTargets ? `已配置 ${configStatus.value.controlTargetCount} 个` : '未配置' },
	{ label: '控制标志来源', value: configStatus.value.controlTargetSourceText },
	{ label: '当前 Marker', value: formatActiveMarkerText(), wide: true },
	{ label: 'cornersEnu', value: configStatus.value.activeControlTargetHasCornersEnu ? '已配置' : '缺失' },
	{ label: 'placementAnchorEnu', value: configStatus.value.hasPlacementAnchor ? configStatus.value.placementAnchorText : '未配置', wide: true },
	{ label: 'undergroundObjects', value: `${configStatus.value.undergroundObjectCount} 个` },
	{ label: 'sensors', value: `${configStatus.value.sensorCount} 个` },
	{ label: 'riskPoints', value: `${configStatus.value.riskPointCount} 个` }
] );

const arGroundCards = computed( () => [
	{ label: 'AR 会话', value: hasArSession.value ? '已进入 AR 巡查' : '请进入 AR 巡查' },
	{ label: '地面检测', value: hitTestReady.value ? '地面检测完成' : hasArSession.value ? '请缓慢移动设备，扫描地面' : '未进入 AR' },
	{ label: '当前会话空间校正', value: localizationReady.value ? '当前会话空间校正完成' : '尚未完成' },
	{ label: '模型自动放置', value: modelPlaced.value ? '模型已按工程坐标显示' : '等待当前会话空间校正' }
] );

const configWarnings = computed( () => {
	const warnings: string[] = [];
	if ( configStatus.value.hasControlTargets === false ) {
		warnings.push( '当前模型未配置控制标志，无法进行正式 AR 空间校正。' );
	}
	if ( configStatus.value.hasRtkSurveyDataset === false ) {
		warnings.push( '当前模型未配置 RTK 测量数据，请先补充工程真值配置。' );
	}
	if ( configStatus.value.hasModelLocalToEnu === false || configStatus.value.activeControlTargetHasCornersEnu === false ) {
		warnings.push( '工程配准数据不完整，请先完善模型到工程坐标和控制标志工程坐标。' );
	}
	for ( const hint of configStatus.value.recommendedFieldHints ) {
		warnings.push( hint );
	}
	if ( configStatus.value.hasPlacementAnchor === false ) {
		warnings.push( '当前模型未配置地面参考点，手动场景定位可能不可用。' );
	}
	if ( configStatus.value.baselineMismatch ) {
		warnings.push( '当前已保存现场基准与模型配置可能不一致，请确认是否更新基准配置。' );
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

const localizationCards = computed( () => [
	{ label: '地面检测', value: hitTestReady.value ? '地面检测完成' : '等待地面检测' },
	{ label: '当前会话空间校正', value: localizationReady.value ? '已完成' : '未完成' },
	{ label: '模型自动放置', value: modelPlaced.value ? '模型已按工程坐标显示' : '未显示' },
	{ label: '校正 source', value: engine.value.registrationChainDebug.arSessionLocalization.source || 'unknown' },
	{ label: '校正误差', value: engine.value.markerCalibration.rmsErrorMeters === undefined ? '-' : `${engine.value.markerCalibration.rmsErrorMeters.toFixed( 3 )}m` },
	{ label: '航向', value: engine.value.markerCalibration.headingDeg === undefined ? '-' : `${engine.value.markerCalibration.headingDeg.toFixed( 2 )}deg` }
] );

const calibrationStatusCards = computed( () => [
	{ label: TEXT.targetMarker, value: formatActiveMarkerText(), wide: true },
	{ label: 'Marker id', value: engine.value.markerCalibration.markerId ?? configStatus.value.activeControlTargetId ?? '-' },
	{ label: TEXT.cornerProgress, value: `${engine.value.markerCalibration.capturedCornerCount}/${engine.value.markerCalibration.expectedCornerCount}` },
	{ label: TEXT.nextCorner, value: engine.value.markerCalibration.nextCornerLabel || '-' },
	{ label: 'cornersEnu', value: canUseMarkerCorners.value ? '已配置' : '缺失' },
	{ label: '失败原因', value: engine.value.runtimeStatus || '-' , wide: true }
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
const workflowHint = computed( () => {
	if ( localizationReady.value && modelPlaced.value ) {
		return '空间校正完成，模型已按工程坐标自动放置。';
	}
	if ( localizationReady.value && hitTestReady.value === false ) {
		return '空间校正完成，等待地面检测后自动放置模型。';
	}
	if ( hitTestReady.value ) {
		return '已检测到地面，请完成控制标志四角点校正。';
	}
	if ( hasArSession.value ) {
		return '请缓慢移动设备，扫描地面。';
	}
	return '请进入 AR 巡查。';
} );

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
	const target = event.target as HTMLSelectElement;
	store.actions.selectModel( target.value );
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
	store.actions.startCurrentSessionMarkerCalibration();
	await nextTick();
	if ( engine.value.markerCalibration.active ) {
		markerCalibrationOverlayOpen.value = true;
		closeDrawerIfOpen();
	}
}

function handleCaptureMarkerCorner(): void {
	store.actions.captureCurrentSessionMarkerCorner();
}

async function handleResetMarkerCalibration(): Promise<void> {
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
	store.actions.solveAndApplyCurrentSessionMarkerCalibration();
	await nextTick();
	markerCalibrationOverlayOpen.value = engine.value.markerCalibration.active;
	closeDrawerIfOpen();
}

async function handleExitMarkerCalibration(): Promise<void> {
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

		<nav
			v-if="hasArSession && showMarkerCalibrationOverlay === false"
			class="action-dock action-dock-compact"
			aria-label="AR 操作"
			@pointerdown.stop="store.actions.handleArUiInteraction()"
			@click.stop
		>
			<button type="button" class="dock-item dock-item-primary" @click.stop="openWorkspacePanel">
				<span class="dock-icon">板</span>
				<span class="dock-label">{{ TEXT.panelTool }}</span>
			</button>
			<button type="button" class="dock-item" @click.stop="store.actions.takeSnapshot()">
				<span class="dock-icon">图</span>
				<span class="dock-label">{{ TEXT.takeSnapshot }}</span>
			</button>
			<button type="button" class="dock-item" @click.stop="exitPage">
				<span class="dock-icon">退</span>
				<span class="dock-label">{{ TEXT.exit }}</span>
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
						{{ TEXT.closePanel }}
					</button>
				</div>

				<template v-if="activePanelView === 'display'">
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
						<div class="runtime-banner">
							仅移动当前显示模型，不修改 RTK 配准和保存数据。
						</div>
					</div>
				</template>

				<template v-else-if="activePanelView === 'localization'">
					<ArPanelSection title="阶段 1：工程配置加载" first>
						<ArInfoGrid :items="configCards" />
						<div v-for="warning in configWarnings" :key="warning" class="runtime-banner warning">
							{{ warning }}
						</div>
						<div v-if="configStatus.hasMockEngineeringData" class="runtime-banner warning">
							{{ configStatus.mockWarningText }}
						</div>
					</ArPanelSection>

					<ArPanelSection title="阶段 2：进入 AR 与地面检测">
						<ArInfoGrid :items="arGroundCards" />
						<div class="runtime-banner" :class="{ warning: localizationReady === false }">
							{{ workflowHint }}
						</div>
					</ArPanelSection>

					<ArPanelSection title="阶段 3：手动 Marker 四角点校正">
						<ArInfoGrid :items="calibrationStatusCards" class="compact-info-grid" />
						<div class="runtime-banner" :class="{ warning: canUseMarkerCorners === false }">
							{{ markerCornerPrompt }}
						</div>
						<div class="runtime-banner">
							角点顺序：1. 左上角；2. 右上角；3. 右下角；4. 左下角。
						</div>
						<div class="runtime-banner">
							Marker 四角点用于当前 AR 会话空间校正；模型控制点用于模型到工程坐标配准，二者不要混用。
						</div>
						<div class="action-row">
							<button
								type="button"
								class="action-button"
								:disabled="canStartMarkerCalibration === false"
								@click="handleStartMarkerCalibration()"
							>
								{{ TEXT.startCalibration }}
							</button>
						</div>
					</ArPanelSection>

					<ArPanelSection title="阶段 4：模型自动放置与巡查">
						<ArInfoGrid :items="localizationCards" />
						<div class="runtime-banner">{{ workflowHint }}</div>
					</ArPanelSection>

				</template>

				<template v-else>
					<div class="sheet-section">
						<div class="section-label">{{ TEXT.record }}</div>
						<div class="form-grid">
							<label class="field">
								<span>{{ TEXT.inspectionResult }}</span>
								<input
									:value="ui.inspectionDraft.result"
									type="text"
									@input="store.actions.updateInspectionDraft({ result: ($event.target as HTMLInputElement).value })"
								>
							</label>
							<label class="field">
								<span>{{ TEXT.inspectionType }}</span>
								<input
									:value="ui.inspectionDraft.type"
									type="text"
									@input="store.actions.updateInspectionDraft({ type: ($event.target as HTMLInputElement).value })"
								>
							</label>
							<label class="field">
								<span>{{ TEXT.inspectionSeverity }}</span>
								<input
									:value="ui.inspectionDraft.severity"
									type="text"
									@input="store.actions.updateInspectionDraft({ severity: ($event.target as HTMLInputElement).value })"
								>
							</label>
							<label class="field full">
								<span>{{ TEXT.inspectionNote }}</span>
								<textarea
									rows="4"
									:value="ui.inspectionDraft.note"
									@input="store.actions.updateInspectionDraft({ note: ($event.target as HTMLTextAreaElement).value })"
								></textarea>
							</label>
						</div>
						<div class="action-row">
							<button type="button" class="action-button primary" @click="store.actions.saveInspectionRecord()">
								{{ TEXT.saveInspection }}
							</button>
							<button type="button" class="action-button" @click="store.actions.exportInspectionRecords()">
								{{ TEXT.exportRecords }}
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
			<div class="marker-calibration-title">{{ TEXT.calibrationPanel }}</div>
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
					@click="handleCaptureMarkerCorner()"
				>
					{{ TEXT.captureCorner }}
				</button>
				<button
					type="button"
					class="marker-action success"
					:disabled="canApplyMarkerCalibration === false"
					@click="handleApplyMarkerCalibration()"
				>
					{{ TEXT.applyCalibration }}
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

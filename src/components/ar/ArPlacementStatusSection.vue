<script setup lang="ts">
import { computed, watch } from 'vue';
import ArInfoGrid from './ArInfoGrid.vue';
import ArPanelSection from './ArPanelSection.vue';
import type {
	ArPlacementMode,
	ArSessionPhase,
	InspectionPlacementSource,
	RegistrationStoreState
} from '@/localization/core/registration-store.js';

const props = withDefaults( defineProps<{
	state: RegistrationStoreState;
	title?: string;
	first?: boolean;
}>(), {
	title: '定位与放置状态',
	first: false
} );

const placementCards = computed( () => [
	{ label: '工程配置', value: formatConfigStatus( props.state ) },
	{ label: '控制标志来源', value: props.state.engineeringConfigStatus.controlTargetSourceText },
	{ label: 'AR 跟踪状态', value: formatSessionPhase( props.state.arSessionPhase ) },
	{ label: 'Marker 校正状态', value: formatMarkerCalibrationStatus( props.state ) },
	{ label: '当前定位 source', value: formatLocalizationSource( props.state.registrationChainDebug.arSessionLocalization.source ) },
	{ label: '模型放置状态', value: formatModelPlacementStatus( props.state ) },
	{ label: '放置模式', value: formatPlacementMode( props.state.placementMode ) },
	{ label: '巡查放置方式', value: formatInspectionPlacementSource( props.state.inspectionPlacementSource ) },
	{ label: '状态说明', value: props.state.registrationStatusDetail || '-', wide: true },
	{ label: '模型位置', value: props.state.placementSummary.positionText, wide: true },
	{ label: '模型姿态', value: props.state.placementSummary.quaternionText, wide: true },
	{ label: '模型缩放', value: props.state.placementSummary.scaleText }
] );

const placementHint = computed( () => resolvePlacementHint( props.state ) );

watch(
	() => [
		props.state.arSessionPhase,
		props.state.registrationChainDebug.arSessionLocalization.source,
		props.state.markerCalibration.active,
		props.state.markerCalibration.applied,
		props.state.placementMode,
		props.state.placementSummary.positionText
	].join( '|' ),
	() => {
		console.info( '[ArUiLocalizationStepChanged]', createUiLogPayload( props.state, resolveCurrentStep( props.state ), placementHint.value ) );
	},
	{ immediate: true }
);

function formatConfigStatus(state: RegistrationStoreState): string {

	const config = state.engineeringConfigStatus;
	if ( config.hasSiteOrigin && config.hasModelLocalToEnu && config.hasRtkSurveyDataset && config.hasControlTargets ) {
		return '工程真值配置已加载';
	}

	return '工程真值配置不完整';

}

function formatPlacementMode(mode: ArPlacementMode): string {

	return mode === 'localized' ? '正式工程定位' : '临时演示放置';

}

function formatSessionPhase(phase: ArSessionPhase): string {

	switch ( phase ) {
		case 'scanning':
			return '跟踪中，等待平面';
		case 'ready-to-place':
			return '平面已检测，仍需完成空间校正';
		case 'placing':
			return '正在根据空间校正放置模型';
		case 'placed':
			return '模型已放置';
		default:
			return phase;
	}

}

function formatInspectionPlacementSource(source: InspectionPlacementSource): string {

	switch ( source ) {
		case 'marker-auto':
			return '隐藏式 Marker 自动识别';
		case 'plane-hit-test':
			return '临时演示放置';
		default:
			return source;
	}

}

function formatLocalizationSource(source: string): string {

	switch ( source ) {
		case 'marker':
			return '当前定位来源：控制标志校正';
		case 'marker-auto-image':
			return '当前定位来源：自动控制标志识别';
		case 'manual-site-pose':
			return '当前定位来源：手动场景定位';
		case 'rtk':
			return 'RTK 预留来源，未接入实时设备定位';
		case 'fallback':
			return 'fallback';
		case 'unknown':
		case '':
			return '尚未建立当前会话定位解';
		default:
			return source;
	}

}

function formatMarkerCalibrationStatus(state: RegistrationStoreState): string {

	if ( state.markerCalibration.applied ) {
		return '控制标志校正完成';
	}

	if ( state.markerCalibration.solved ) {
		return '已求解，等待应用到模型';
	}

	if ( state.markerCalibration.active ) {
		return `手动采集中：${state.markerCalibration.capturedCornerCount}/${state.markerCalibration.expectedCornerCount}`;
	}

	if ( state.inspectionPlacementSource === 'marker-auto' ) {
		return '自动识别中或等待控制标志进入视野';
	}

	return '未校正';

}

function formatModelPlacementStatus(state: RegistrationStoreState): string {

	if ( state.placementMode === 'hit-test-temporary' && state.placementSummary.positionText !== '-' ) {
		return '当前为临时演示放置';
	}

	if ( state.placementSummary.positionText !== '-' && state.registrationChainDebug.arSessionLocalization.available ) {
		return '模型已按工程坐标显示';
	}

	return '模型未正式放置';

}

function resolvePlacementHint(state: RegistrationStoreState): string {

	if ( state.placementMode === 'hit-test-temporary' ) {
		return '当前为临时演示放置，不代表正式定位。仅用于调试展示，不代表工程真实位置。';
	}

	if ( state.engineeringConfigStatus.hasControlTargets === false ) {
		return '当前模型未配置控制标志，无法进行正式 AR 空间校正。';
	}

	if ( state.engineeringConfigStatus.hasRtkSurveyDataset === false ) {
		return '当前模型未配置 RTK 测量数据，请先补充工程真值配置。';
	}

	if ( state.engineeringConfigStatus.hasPlacementAnchor === false ) {
		return '当前模型未配置地面参考点，手动场景定位可能不可用。';
	}

	if ( state.engineeringConfigStatus.baselineMismatch ) {
		return '当前已保存现场基准与模型配置可能不一致，请确认是否更新基准配置。';
	}

	switch ( state.registrationChainDebug.arSessionLocalization.source ) {
		case 'marker':
		case 'marker-auto-image':
		case 'manual-site-pose':
			return '模型已按工程坐标显示，可用于正式巡查查看。';
		default:
			return state.arSessionPhase === 'ready-to-place'
				? '已检测到平面，请继续对准现场控制标志完成空间校正。'
				: '当前未完成空间校正，不能作为正式巡查定位结果。';
	}

}

function resolveCurrentStep(state: RegistrationStoreState): string {

	if ( state.placementMode === 'hit-test-temporary' ) {
		return 'debug-temporary-placement';
	}

	if ( state.appMode !== 'ar-session' ) {
		return 'enter-ar';
	}

	if ( state.arSessionPhase === 'scanning' ) {
		return 'scan-plane';
	}

	if ( state.markerCalibration.active ) {
		return 'capture-marker-corner';
	}

	if ( state.registrationChainDebug.arSessionLocalization.available === false ) {
		return 'align-marker';
	}

	if ( state.placementSummary.positionText === '-' ) {
		return 'place-model';
	}

	return 'inspect';

}

function createUiLogPayload(
	state: RegistrationStoreState,
	currentStep: string,
	message: string
): Record<string, unknown> {

	return {
		mode: state.workflowMode,
		siteId: state.selectedModelId || null,
		modelId: state.selectedModelId || null,
		sessionId: state.markerCalibration.currentSessionId,
		currentStep,
		localizationSource: state.registrationChainDebug.arSessionLocalization.source,
		targetId: state.engineeringConfigStatus.activeControlTargetId ?? state.markerCalibration.markerId,
		message
	};

}
</script>

<template>
	<ArPanelSection :title="title" :first="first">
		<ArInfoGrid :items="placementCards" />
		<div
			class="runtime-banner"
			:class="{ warning: state.placementMode === 'hit-test-temporary' || state.registrationChainDebug.arSessionLocalization.available === false }"
		>
			{{ placementHint }}
		</div>
	</ArPanelSection>
</template>

<style scoped>
.runtime-banner {
	margin-top: 10px;
	padding: 10px 12px;
	border-radius: 14px;
	background: rgba(0, 212, 255, 0.08);
	border: 1px solid rgba(0, 212, 255, 0.18);
	font-size: 12px;
	color: #d5f7ff;
}

.runtime-banner.warning {
	background: rgba(245, 158, 11, 0.12);
	border-color: rgba(245, 158, 11, 0.28);
	color: #ffe8b6;
}
</style>

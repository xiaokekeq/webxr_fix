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
	{ label: '地面检测', value: formatSessionPhase( props.state.arSessionPhase ) },
	{ label: '当前会话空间校正', value: formatMarkerCalibrationStatus( props.state ) },
	{ label: '校正 source', value: formatLocalizationSource( props.state.registrationChainDebug.arSessionLocalization.source ) },
	{ label: '模型自动放置', value: formatModelPlacementStatus( props.state ) },
	{ label: '工程显示模式', value: formatPlacementMode( props.state.placementMode ) },
	{ label: '巡查校正方式', value: formatInspectionPlacementSource( props.state.inspectionPlacementSource ) },
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
		return '工程配置已加载';
	}

	return '工程配置不完整';

}

function formatPlacementMode(mode: ArPlacementMode): string {

	return mode === 'localized' ? '按工程坐标显示' : 'debug-only';

}

function formatSessionPhase(phase: ArSessionPhase): string {

	switch ( phase ) {
		case 'scanning':
			return '请缓慢移动设备，扫描地面';
		case 'ready-to-place':
			return '地面检测完成，等待当前会话空间校正';
		case 'placing':
			return '正在等待模型自动放置';
		case 'placed':
			return '模型已按工程坐标显示';
		default:
			return phase;
	}

}

function formatInspectionPlacementSource(source: InspectionPlacementSource): string {

	switch ( source ) {
		case 'manual-marker':
			return '手动 Marker 四角点校正';
		default:
			return source;
	}

}

function formatLocalizationSource(source: string): string {

	switch ( source ) {
		case 'marker':
			return 'Marker 四角点';
		case 'rtk':
			return 'RTK 预留来源，未接入实时设备定位';
		case 'fallback':
			return 'fallback';
		case 'unknown':
		case '':
			return '尚未建立当前会话空间校正';
		default:
			return source;
	}

}

function formatMarkerCalibrationStatus(state: RegistrationStoreState): string {

	if ( state.markerCalibration.applied ) {
		return '当前会话空间校正完成';
	}

	if ( state.markerCalibration.solved ) {
		return '已求解，等待模型自动放置';
	}

	if ( state.markerCalibration.active ) {
		return `手动采集中：${state.markerCalibration.capturedCornerCount}/${state.markerCalibration.expectedCornerCount}`;
	}

	return '尚未完成';

}

function formatModelPlacementStatus(state: RegistrationStoreState): string {

	if ( state.placementSummary.positionText !== '-' && state.registrationChainDebug.arSessionLocalization.available ) {
		return '模型已按工程坐标显示';
	}

	return '模型尚未按工程坐标显示';

}

function resolvePlacementHint(state: RegistrationStoreState): string {

	if ( state.engineeringConfigStatus.hasControlTargets === false ) {
		return '当前模型未配置控制标志，无法进行当前会话空间校正。';
	}

	if ( state.engineeringConfigStatus.hasRtkSurveyDataset === false ) {
		return '当前模型未配置 RTK 测量数据，请先补充工程真值配置。';
	}

	if ( state.engineeringConfigStatus.hasPlacementAnchor === false ) {
		return '当前模型未配置 placementAnchorEnu，建议补充工程参考点。';
	}

	if ( state.engineeringConfigStatus.baselineMismatch ) {
		return '当前已保存现场基准与模型配置可能不一致，请确认是否更新基准配置。';
	}

	switch ( state.registrationChainDebug.arSessionLocalization.source ) {
		case 'marker':
			return '模型已按工程坐标显示。';
		default:
			return state.arSessionPhase === 'ready-to-place'
				? '已检测到地面，但尚未完成空间校正，不能自动放置工程模型。'
				: '当前未完成空间校正，不能作为正式巡查结果。';
	}

}

function resolveCurrentStep(state: RegistrationStoreState): string {

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
		message,
		hasSiteOrigin: state.engineeringConfigStatus.hasSiteOrigin,
		hasModelLocalToEnu: state.engineeringConfigStatus.hasModelLocalToEnu,
		modelLocalToEnuSource: state.engineeringConfigStatus.modelLocalToEnuSource,
		hasCornersEnu: state.engineeringConfigStatus.activeControlTargetHasCornersEnu,
		hasRtkSurveyDataset: state.engineeringConfigStatus.hasRtkSurveyDataset,
		hitTestReady: state.arSessionPhase !== 'scanning',
		localizationReady: state.registrationChainDebug.arSessionLocalization.available,
		modelPlaced: state.placementSummary.positionText !== '-'
	};

}
</script>

<template>
	<ArPanelSection :title="title" :first="first">
		<ArInfoGrid :items="placementCards" />
		<div
			class="runtime-banner"
			:class="{ warning: state.registrationChainDebug.arSessionLocalization.available === false }"
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

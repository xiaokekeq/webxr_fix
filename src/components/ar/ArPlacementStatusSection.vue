<script setup lang="ts">
import { computed, watch } from 'vue';
import ArInfoGrid from './ArInfoGrid.vue';
import ArPanelSection from './ArPanelSection.vue';
import type {
	ArSessionPhase,
	RegistrationStoreState
} from '@/localization/core/registration-store.js';

const props = withDefaults( defineProps<{
	state: RegistrationStoreState;
	title?: string;
	first?: boolean;
}>(), {
	title: '定位状态',
	first: false
} );

const placementCards = computed( () => [
	{ label: '工程配置', value: formatConfigStatus( props.state ) },
	{ label: '控制标志', value: props.state.engineeringConfigStatus.activeControlTargetName ?? props.state.engineeringConfigStatus.activeControlTargetId ?? '-' },
	{ label: '四角坐标', value: props.state.engineeringConfigStatus.activeControlTargetHasCornersEnu ? '已配置' : '缺失' },
	{ label: '地面检测', value: formatSessionPhase( props.state.arSessionPhase ) },
	{ label: '空间校正', value: formatMarkerCalibrationStatus( props.state ) },
	{ label: '模型放置', value: formatModelPlacementStatus( props.state ) }
] );

const placementHint = computed( () => resolvePlacementHint( props.state ) );

watch(
	() => [
		props.state.arSessionPhase,
		props.state.registrationChainDebug.arSessionLocalization.source,
		props.state.markerCalibration.active,
		props.state.markerCalibration.applied,
		props.state.placementSummary.positionText
	].join( '|' ),
	() => {
		console.info( '[ArUiLocalizationStepChanged]', createUiLogPayload( props.state, resolveCurrentStep( props.state ), placementHint.value ) );
	},
	{ immediate: true }
);

function formatConfigStatus(state: RegistrationStoreState): string {

	const config = state.engineeringConfigStatus;
	return config.hasSiteOrigin && config.hasModelLocalToEnu && config.hasRtkSurveyDataset && config.hasControlTargets
		? '已加载'
		: '不完整';

}

function formatSessionPhase(phase: ArSessionPhase): string {

	switch ( phase ) {
		case 'scanning':
			return '扫描中';
		case 'ready-to-place':
			return '已检测';
		case 'placing':
			return '放置中';
		case 'placed':
			return '已放置';
		default:
			return phase;
	}

}

function formatMarkerCalibrationStatus(state: RegistrationStoreState): string {

	if ( state.markerCalibration.applied ) {
		return '已完成';
	}

	if ( state.markerCalibration.active ) {
		return `${state.markerCalibration.capturedCornerCount}/${state.markerCalibration.expectedCornerCount}`;
	}

	return state.registrationChainDebug.arSessionLocalization.available ? '已求解' : '未完成';

}

function formatModelPlacementStatus(state: RegistrationStoreState): string {

	return state.placementSummary.positionText !== '-' && state.registrationChainDebug.arSessionLocalization.available
		? '已显示'
		: '未显示';

}

function resolvePlacementHint(state: RegistrationStoreState): string {

	if ( state.engineeringConfigStatus.hasControlTargets === false ) {
		return '当前模型没有控制标志。';
	}

	if ( state.engineeringConfigStatus.activeControlTargetHasCornersEnu === false ) {
		return '当前控制标志缺少四角 ENU 坐标。';
	}

	if ( state.engineeringConfigStatus.baselineMismatch ) {
		return '已保存 baseline 与当前 JSON 不一致，本次使用当前 JSON。';
	}

	if ( state.registrationChainDebug.arSessionLocalization.source === 'marker' ) {
		return '四角点校正已应用。';
	}

	return state.arSessionPhase === 'ready-to-place'
		? '请采集控制标志四角点。'
		: '请先扫描地面。';

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
		message
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

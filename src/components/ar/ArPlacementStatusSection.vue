<script setup lang="ts">
import { computed } from 'vue';
import ArInfoGrid from './ArInfoGrid.vue';
import ArPanelSection from './ArPanelSection.vue';
import type {
	InspectionPlacementSource,
	ArPlacementMode,
	ArSessionPhase,
	RegistrationStoreState
} from '@/localization/core/registration-store.js';

const props = withDefaults( defineProps<{
	state: RegistrationStoreState;
	title?: string;
	first?: boolean;
}>(), {
	title: '放置方式',
	first: false
} );

const placementCards = computed( () => {
	const cards = [
		{ label: '放置模式', value: formatPlacementMode( props.state.placementMode ) },
		{ label: '当前方式', value: resolvePlacementMethod( props.state ) },
		{ label: '定位来源', value: formatLocalizationSource( props.state.registrationChainDebug.arSessionLocalization.source ) },
		{ label: '放置阶段', value: formatSessionPhase( props.state.arSessionPhase ) },
		{ label: '放置状态', value: props.state.registrationStatusDetail || '-', wide: true },
		{ label: '模型位置', value: props.state.placementSummary.positionText, wide: true },
		{ label: '模型姿态', value: props.state.placementSummary.quaternionText, wide: true },
		{ label: '模型缩放', value: props.state.placementSummary.scaleText }
	];

	if ( shouldShowCoarseDebug( props.state ) ) {
		cards.push( {
			label: '粗配准诊断',
			value: props.state.coarseLocationDebugText,
			wide: true
		} );
	}

	if ( props.state.workflowMode === 'ar-inspection' ) {
		cards.splice( 1, 0, {
			label: '巡查来源',
			value: formatInspectionPlacementSource( props.state.inspectionPlacementSource )
		} );
	}

	return cards;
} );

const placementHint = computed( () => resolvePlacementHint( props.state ) );

function formatPlacementMode(mode: ArPlacementMode): string {

	return mode === 'localized' ? '现场固定放置' : '平面临时放置';

}

function formatSessionPhase(phase: ArSessionPhase): string {

	switch ( phase ) {
		case 'scanning':
			return '扫描平面中';
		case 'ready-to-place':
			return '可开始放置';
		case 'placing':
			return '放置处理中';
		case 'placed':
			return '已完成放置';
		default:
			return phase;
	}

}

function formatInspectionPlacementSource(source: InspectionPlacementSource): string {

	switch ( source ) {
		case 'marker-auto':
			return '隐藏式 Marker 自动识别';
		case 'gps-bias':
			return 'GPS / 粗配准';
		case 'plane-hit-test':
			return '当前平面临放';
		default:
			return source;
	}

}

function formatLocalizationSource(source: string): string {

	switch ( source ) {
		case 'marker':
			return 'Marker 控制标志';
		case 'marker-auto-image':
			return '自动图片识别 Marker';
		case 'manual-site-pose':
			return '手动空间校准';
		case 'gps-bias':
			return 'GPS 偏差补偿';
		case 'gps-imu':
			return '粗配准 / GPS-IMU';
		case 'rtk':
			return 'RTK';
		case 'unknown':
		case '':
			return '未建立定位解';
		default:
			return source;
	}

}

function resolvePlacementMethod(state: RegistrationStoreState): string {

	if ( state.placementMode === 'hit-test-temporary' ) {
		return '按当前平面临时放置';
	}

	switch ( state.registrationChainDebug.arSessionLocalization.source ) {
		case 'marker':
			return 'Marker 固定放置';
		case 'marker-auto-image':
			return '自动识别 Marker 固定放置';
		case 'manual-site-pose':
			return '手动校准固定放置';
		case 'gps-bias':
			return 'GPS 补偿固定放置';
		case 'gps-imu':
			return '粗配准固定放置';
		case 'rtk':
			return 'RTK 固定放置';
		default:
			return state.arSessionPhase === 'scanning'
				? '等待可用定位解'
				: '按可用定位解固定放置';
	}

}

function resolvePlacementHint(state: RegistrationStoreState): string {

	if ( state.placementMode === 'hit-test-temporary' ) {
		return '当前模型只会跟随你识别到的平面做临时放置，不会按现场坐标固定。';
	}

	switch ( state.registrationChainDebug.arSessionLocalization.source ) {
		case 'marker':
			return '当前模型会优先按 Marker 控制标志结果固定到现场位置。';
		case 'marker-auto-image':
			return '当前模型会优先按自动识别到的 Marker 图片结果固定到现场位置。';
		case 'manual-site-pose':
			return '当前模型会按手动空间校准结果固定到现场位置。';
		case 'gps-bias':
			return '当前模型会按 GPS 偏差补偿结果固定到现场位置。';
		case 'gps-imu':
			return '当前模型会按粗配准结果固定到现场位置，精度通常低于 Marker。';
		case 'rtk':
			return '当前模型会按 RTK 定位结果固定到现场位置。';
		default:
			return state.arSessionPhase === 'scanning'
				? '当前仍在等待可用定位解，请先扫描平面并完成定位。'
				: '当前处于现场固定放置模式，但还没有明确的高优先级定位来源。';
	}

}

function shouldShowCoarseDebug(state: RegistrationStoreState): boolean {

	if ( state.placementMode !== 'localized' ) {
		return false;
	}

	const source = state.registrationChainDebug.arSessionLocalization.source;
	return source === 'gps-bias' || source === 'gps-imu' || source === 'unknown' || source.length === 0;

}
</script>

<template>
	<ArPanelSection :title="title" :first="first">
		<ArInfoGrid :items="placementCards" />
		<div class="runtime-banner">{{ placementHint }}</div>
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
</style>

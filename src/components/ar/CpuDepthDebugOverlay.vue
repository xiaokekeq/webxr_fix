<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import {
	cpuDepthDebugState,
	getHeatmapCanvas
} from '@/engine/visualization/cpu-depth-visualization.js';

const heatmapHost = ref<HTMLElement | null>( null );

function formatDepth( v: number | undefined ): string {
	if ( v === undefined ) return '-';
	return `${v.toFixed( 2 )}m`;
}

function formatTime( v: number | undefined ): string {
	if ( v === undefined ) return '-';
	return new Date( v ).toLocaleTimeString();
}

onMounted( () => {
	if ( heatmapHost.value !== null ) {
		const canvas = getHeatmapCanvas();
		canvas.style.width = '100%';
		canvas.style.height = '100%';
		canvas.style.imageRendering = 'pixelated';
		canvas.style.borderRadius = '6px';
		heatmapHost.value.appendChild( canvas );
	}
} );

onUnmounted( () => {
	if ( heatmapHost.value !== null ) {
		heatmapHost.value.replaceChildren();
	}
} );
</script>

<template>
	<div
		v-if="cpuDepthDebugState.enabled && cpuDepthDebugState.depthSensingSessionEnabled"
		class="cpu-depth-overlay"
		data-ar-ui="true"
		@pointerdown.stop
		@click.stop
	>
		<div class="depth-title">CPU Depth</div>

		<div ref="heatmapHost" class="depth-heatmap"></div>

		<div class="depth-stats">
			<div class="stat-row">
				<span>状态</span>
				<span :class="{ ok: cpuDepthDebugState.active, fail: !cpuDepthDebugState.active }">
					{{ cpuDepthDebugState.active ? '正常' : '等待' }}
				</span>
			</div>
			<div class="stat-row">
				<span>尺寸</span>
				<span>{{ cpuDepthDebugState.width ?? '-' }} × {{ cpuDepthDebugState.height ?? '-' }}</span>
			</div>
			<div class="stat-row">
				<span>中心深度</span>
				<span class="highlight">{{ formatDepth( cpuDepthDebugState.centerDepth ) }}</span>
			</div>
			<div class="stat-row">
				<span>最近</span>
				<span>{{ formatDepth( cpuDepthDebugState.minDepth ) }}</span>
			</div>
			<div class="stat-row">
				<span>最远</span>
				<span>{{ formatDepth( cpuDepthDebugState.maxDepth ) }}</span>
			</div>
			<div class="stat-row">
				<span>有效采样</span>
				<span>{{ cpuDepthDebugState.validSampleCount ?? '-' }}</span>
			</div>
			<div class="stat-row">
				<span>更新时间</span>
				<span>{{ formatTime( cpuDepthDebugState.lastUpdatedAt ) }}</span>
			</div>
		</div>

		<div v-if="cpuDepthDebugState.errorMessage" class="depth-error">
			{{ cpuDepthDebugState.errorMessage }}
		</div>
	</div>

	<!-- Unsupported state: shown when user toggles on but session has no depth -->
	<div
		v-else-if="cpuDepthDebugState.enabled && !cpuDepthDebugState.depthSensingSessionEnabled"
		class="cpu-depth-overlay cpu-depth-unsupported"
		data-ar-ui="true"
		@pointerdown.stop
		@click.stop
	>
		<div class="depth-title">CPU Depth</div>
		<div class="depth-error">
			当前设备或浏览器不支持 WebXR CPU Depth。
		</div>
	</div>
</template>

<style scoped>
.cpu-depth-overlay {
	position: fixed;
	z-index: 12;
	top: max( 60px, calc( env(safe-area-inset-top) + 52px ) );
	right: 12px;
	width: 164px;
	padding: 8px;
	border-radius: 14px;
	background: rgba( 8, 15, 27, 0.82 );
	border: 1px solid rgba( 0, 212, 255, 0.36 );
	box-shadow: 0 14px 44px rgba( 0, 0, 0, 0.45 );
	backdrop-filter: blur( 18px );
	color: #eff6ff;
	font-size: 11px;
	pointer-events: auto;
}

.depth-title {
	font-size: 11px;
	font-weight: 900;
	color: #00d4ff;
	margin-bottom: 6px;
}

.depth-heatmap {
	width: 148px;
	height: 111px;
	border-radius: 6px;
	background: rgba( 0, 0, 0, 0.5 );
	overflow: hidden;
	margin-bottom: 6px;
}

.depth-stats {
	display: grid;
	gap: 2px;
}

.stat-row {
	display: flex;
	justify-content: space-between;
	gap: 4px;
	line-height: 1.5;
}

.stat-row span:first-child {
	color: rgba( 226, 232, 240, 0.7 );
	font-size: 10px;
}

.stat-row span:last-child {
	color: #dffaff;
	font-size: 10px;
	font-weight: 700;
	text-align: right;
}

.stat-row .highlight {
	color: #00ffa8;
}

.stat-row .ok {
	color: #00ffa8;
}

.stat-row .fail {
	color: #ffa07a;
}

.depth-error {
	margin-top: 6px;
	padding: 5px 7px;
	border-radius: 8px;
	background: rgba( 245, 158, 11, 0.16 );
	border: 1px solid rgba( 245, 158, 11, 0.32 );
	color: #ffe8b6;
	font-size: 10px;
	line-height: 1.4;
}

.cpu-depth-unsupported {
	border-color: rgba( 245, 158, 11, 0.42 );
}
</style>

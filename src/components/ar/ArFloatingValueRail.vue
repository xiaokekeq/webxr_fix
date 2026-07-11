<script setup lang="ts">
import { ref } from 'vue';

const props = withDefaults( defineProps<{ modelValue: number; min?: number; max?: number; step?: number; ariaLabel: string }>(), { min: 0, max: 100, step: 1 } );
const emit = defineEmits<{ 'update:modelValue': [value: number]; 'change-start': []; 'change-end': [] }>();
const railRef = ref<HTMLElement | null>( null );
const activePointerId = ref<number | null>( null );

function valueFromClientY(clientY: number): number {
	const rect = railRef.value!.getBoundingClientRect();
	const ratio = 1 - Math.min( 1, Math.max( 0, ( clientY - rect.top ) / rect.height ) );
	return Math.min( props.max, Math.max( props.min, Math.round( ( props.min + ratio * ( props.max - props.min ) ) / props.step ) * props.step ) );
}

function update(event: PointerEvent): void {
	emit( 'update:modelValue', valueFromClientY( event.clientY ) );
}

function onPointerDown(event: PointerEvent): void {
	event.stopPropagation();
	event.preventDefault();
	railRef.value!.setPointerCapture( event.pointerId );
	activePointerId.value = event.pointerId;
	emit( 'change-start' );
	update( event );
}

function onPointerMove(event: PointerEvent): void {
	if ( activePointerId.value !== event.pointerId ) return;
	event.stopPropagation();
	event.preventDefault();
	update( event );
}

function finish(event: PointerEvent): void {
	if ( activePointerId.value !== event.pointerId ) return;
	event.stopPropagation();
	if ( railRef.value!.hasPointerCapture( event.pointerId ) ) railRef.value!.releasePointerCapture( event.pointerId );
	activePointerId.value = null;
	emit( 'change-end' );
}

function onKeydown(event: KeyboardEvent): void {
	const changes: Record<string, number> = { ArrowUp: props.step, ArrowRight: props.step, ArrowDown: -props.step, ArrowLeft: -props.step, Home: props.min - props.modelValue, End: props.max - props.modelValue };
	if ( changes[ event.key ] === undefined ) return;
	event.preventDefault();
	event.stopPropagation();
	emit( 'update:modelValue', Math.min( props.max, Math.max( props.min, props.modelValue + changes[ event.key ] ) ) );
}
</script>

<template>
	<div
		ref="railRef"
		class="floating-value-rail"
		role="slider"
		tabindex="0"
		:aria-label="ariaLabel"
		:aria-valuemin="min"
		:aria-valuemax="max"
		:aria-valuenow="modelValue"
		@pointerdown="onPointerDown"
		@pointermove="onPointerMove"
		@pointerup="finish"
		@pointercancel="finish"
		@keydown="onKeydown"
		@click.stop
	>
		<div class="rail-track"><div class="rail-fill" :style="{ height: `${(modelValue - min) / (max - min) * 100}%` }"></div></div>
		<div class="rail-thumb" :style="{ bottom: `calc(${(modelValue - min) / (max - min) * 100}% - 11px)` }"></div>
	</div>
</template>

<style scoped>
.floating-value-rail {
	position: fixed;
	z-index: 9;
	right: max(10px, env(safe-area-inset-right));
	top: 50%;
	transform: translateY(-42%);
	width: clamp(34px, 9vw, 42px);
	height: clamp(132px, 22vh, 184px);
	border: 1px solid rgba(255, 255, 255, 0.14);
	border-radius: 999px;
	background: rgba(8, 18, 31, 0.4);
	box-shadow: 0 10px 24px rgba(0, 0, 0, 0.2);
	backdrop-filter: blur(11px) saturate(130%);
	-webkit-backdrop-filter: blur(11px) saturate(130%);
	touch-action: none;
	user-select: none;
	-webkit-user-select: none;
}
.rail-track { position: absolute; top: 14px; bottom: 14px; left: 50%; width: 5px; transform: translateX(-50%); overflow: hidden; border-radius: 999px; background: rgba(255,255,255,.16); }
.rail-fill { position: absolute; right: 0; bottom: 0; left: 0; border-radius: inherit; background: #22d3ee; }
.rail-thumb { position: absolute; left: 50%; width: 22px; height: 22px; transform: translateX(-50%); border: 2px solid rgba(255,255,255,.85); border-radius: 50%; background: #0891b2; box-shadow: 0 3px 9px rgba(0,0,0,.35); }
</style>

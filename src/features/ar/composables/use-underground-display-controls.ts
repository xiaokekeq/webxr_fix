import { computed, ref, type ComputedRef } from 'vue';
import type { ThreeEngineSnapshot } from '@/engine/core/three-engine.js';
import type { UndergroundInspectionTool, UndergroundMaterialMode } from '@/engine/visualization/underground-display-state.js';

export type ActiveAdjustment = 'xray-opacity' | 'layer-peeling' | 'section-cut' | null;

export function useUndergroundDisplayControls(state: ComputedRef<ThreeEngineSnapshot>) {
	const activeAdjustment = ref<ActiveAdjustment>( null );
	const floatingAdjustment = computed( () => {
		if ( activeAdjustment.value === 'xray-opacity' && state.value.undergroundMaterialMode === 'xray' ) return { value: state.value.transparentXrayValue, label: '透明度' };
		if ( activeAdjustment.value === 'layer-peeling' && state.value.undergroundInspectionTool === 'layer-peeling' ) return { value: state.value.layerPeelingValue, label: '分层进度' };
		if ( activeAdjustment.value === 'section-cut' && state.value.undergroundInspectionTool === 'section-cut' ) return { value: state.value.sectionCutValue, label: '剖切位置' };
		return null;
	} );
	function selectMaterial(mode: UndergroundMaterialMode): void {
		activeAdjustment.value = state.value.undergroundInspectionTool === 'layer-peeling' ? 'layer-peeling' : state.value.undergroundInspectionTool === 'section-cut' ? 'section-cut' : mode === 'xray' ? 'xray-opacity' : null;
	}
	function selectTool(tool: UndergroundInspectionTool): void {
		activeAdjustment.value = tool === 'layer-peeling' ? 'layer-peeling' : tool === 'section-cut' ? 'section-cut' : state.value.undergroundMaterialMode === 'xray' ? 'xray-opacity' : null;
	}
	return { activeAdjustment, floatingAdjustment, selectMaterial, selectTool };
}

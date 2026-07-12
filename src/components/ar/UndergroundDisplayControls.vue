<script setup lang="ts">
import { SECTION_CUT_PLANE_MODE_OPTIONS } from '@/features/ar/types/display-modes.js';
import type { SectionCutPlaneMode } from '@/localization/core/registration-store.js';
import type { UndergroundInspectionTool, UndergroundMaterialMode } from '@/engine/visualization/underground-display-state.js';

defineProps<{ materialMode: UndergroundMaterialMode; inspectionTool: UndergroundInspectionTool; sectionMode: SectionCutPlaneMode }>();
defineEmits<{ material: [mode: UndergroundMaterialMode]; tool: [tool: UndergroundInspectionTool]; section: [mode: SectionCutPlaneMode] }>();
const materialOptions = [ { value: 'solid', label: '实体显示' }, { value: 'xray', label: '透明显示' } ] as const;
const toolOptions = [ { value: 'complete', label: '完整显示' }, { value: 'layer-peeling', label: '分层显示' }, { value: 'section-cut', label: '剖切查看' } ] as const;
</script>

<template>
	<div class="display-controls">
		<section><div class="section-label">显示样式</div><div class="option-grid two"><button v-for="item in materialOptions" :key="item.value" type="button" class="chip-button" :class="{ active: materialMode === item.value }" @click.stop="$emit('material', item.value)">{{ item.label }}</button></div></section>
		<section><div class="section-label">查看工具</div><div class="option-grid three"><button v-for="item in toolOptions" :key="item.value" type="button" class="chip-button" :class="{ active: inspectionTool === item.value }" @click.stop="$emit('tool', item.value)">{{ item.label }}</button></div></section>
		<section v-if="inspectionTool === 'section-cut'"><div class="section-label">剖切方向</div><div class="option-grid three"><button v-for="item in SECTION_CUT_PLANE_MODE_OPTIONS" :key="item.value" type="button" class="chip-button" :class="{ active: sectionMode === item.value }" @click.stop="$emit('section', item.value)">{{ item.label }}</button></div></section>
	</div>
</template>

<style scoped>
.display-controls { display: grid; gap: 9px; }
section { min-width: 0; }
.section-label { margin-bottom: 6px; font-size: 12px; font-weight: 900; color: #e0f2fe; }
.option-grid { display: grid; gap: 8px; }
.option-grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.option-grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.chip-button { min-width: 0; padding: 8px 6px; color: #eff6ff; background: rgba(15,23,42,.82); border: 1px solid rgba(148,163,184,.22); border-radius: 12px; font-size: 12px; font-weight: 800; }
.chip-button.active { background: linear-gradient(135deg,rgba(0,212,255,.34),rgba(20,184,166,.24)); border-color: rgba(0,212,255,.44); }
@media (max-width: 360px) { .option-grid.three { grid-template-columns: 1fr; } }
</style>

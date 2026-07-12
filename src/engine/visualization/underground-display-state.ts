import type { SectionCutPlaneMode } from '@/localization/core/registration-store.js';

export type LegacyArDisplayMode = 'solid-overlay' | 'transparent-xray' | 'layer-peeling' | 'section-cut';
export type UndergroundMaterialMode = 'solid' | 'xray';
export type UndergroundInspectionTool = 'complete' | 'layer-peeling' | 'section-cut';

export const DEFAULT_UNDERGROUND_DISPLAY_STATE = {
	undergroundMaterialMode: 'solid',
	undergroundInspectionTool: 'complete'
} as const;

export function mapLegacyDisplayMode(mode: LegacyArDisplayMode): Partial<{
	undergroundMaterialMode: UndergroundMaterialMode;
	undergroundInspectionTool: UndergroundInspectionTool;
}> {
	if ( mode === 'transparent-xray' ) return { undergroundMaterialMode: 'xray' };
	if ( mode === 'solid-overlay' ) return { undergroundMaterialMode: 'solid' };
	if ( mode === 'layer-peeling' || mode === 'section-cut' ) return { undergroundInspectionTool: mode };
	return {};
}

export interface UndergroundDisplayState {
	undergroundMaterialMode: UndergroundMaterialMode;
	undergroundInspectionTool: UndergroundInspectionTool;
	layerPeelingValue: number;
	sectionCutValue: number;
	sectionCutPlaneMode: SectionCutPlaneMode;
}

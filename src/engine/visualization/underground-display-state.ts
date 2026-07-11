import type { SectionCutPlaneMode } from '@/localization/core/registration-store.js';

export type LegacyArDisplayMode = 'solid-overlay' | 'transparent-xray' | 'underground-portal' | 'layer-peeling' | 'section-cut';

export type UndergroundViewMode = 'portal' | 'real-space';
export type UndergroundMaterialMode = 'solid' | 'xray';
export type UndergroundInspectionTool = 'complete' | 'layer-peeling' | 'section-cut';

export const DEFAULT_UNDERGROUND_DISPLAY_STATE = {
	undergroundViewMode: 'portal',
	undergroundMaterialMode: 'solid',
	undergroundInspectionTool: 'complete'
} as const;

export function mapLegacyDisplayMode(mode: LegacyArDisplayMode): Partial<{
	undergroundViewMode: UndergroundViewMode;
	undergroundMaterialMode: UndergroundMaterialMode;
	undergroundInspectionTool: UndergroundInspectionTool;
}> {
	if ( mode === 'underground-portal' ) return { undergroundViewMode: 'portal' };
	if ( mode === 'transparent-xray' ) return { undergroundViewMode: 'real-space', undergroundMaterialMode: 'xray' };
	if ( mode === 'solid-overlay' ) return { undergroundMaterialMode: 'solid' };
	if ( mode === 'layer-peeling' || mode === 'section-cut' ) return { undergroundInspectionTool: mode };
	return {};
}

export interface UndergroundDisplayState {
	undergroundViewMode: UndergroundViewMode;
	undergroundMaterialMode: UndergroundMaterialMode;
	undergroundInspectionTool: UndergroundInspectionTool;
	layerPeelingValue: number;
	sectionCutValue: number;
	sectionCutPlaneMode: SectionCutPlaneMode;
}

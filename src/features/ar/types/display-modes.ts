import type { SectionCutPlaneMode } from '@/localization/core/registration-store.js';

export const SECTION_CUT_PLANE_MODE_OPTIONS: Array<{ value: SectionCutPlaneMode; label: string }> = [
	{ value: 'horizontal-section', label: '水平剖切' },
	{ value: 'cross-section', label: '横断面' },
	{ value: 'longitudinal-section', label: '纵断面' }
];

export function getSectionCutPlaneModeLabel(mode: SectionCutPlaneMode): string {

	return SECTION_CUT_PLANE_MODE_OPTIONS.find( ( item ) => item.value === mode )?.label ?? '水平剖切';

}

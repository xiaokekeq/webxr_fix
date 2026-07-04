import type {
	SiteCalibrationBaseline,
	VisualControlTarget,
	VisualControlTargetPlane
} from '@/localization/baseline/site-calibration-baseline.js';

export type ArWorkflowMode =
	| 'site-baseline-config'
	| 'ar-inspection';

export type { VisualControlTargetPlane, VisualControlTarget, SiteCalibrationBaseline };

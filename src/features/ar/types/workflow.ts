import type { GeodeticPosition } from '@/localization/geodesy/wgs84-enu.js';

export type ArWorkflowMode =
	| 'site-baseline-config'
	| 'ar-inspection';

export type VisualControlTargetPlane = 'horizontal' | 'vertical';

export interface VisualControlTarget {
	id: string;
	name?: string;
	imageUrl?: string;
	centerEnu: [ number, number, number ];
	yawDeg: number;
	sizeMeters: number;
	trackingWidthMeters?: number;
	plane: VisualControlTargetPlane;
	cornerOrder?: string[];
}

export interface GpsBiasCorrection {
	deltaEnu: [ number, number, number ];
	yawCorrectionDeg?: number;
	createdAt: number;
	source: 'admin-marker' | 'manual-site-pose' | 'debug';
}

export interface SiteCalibrationBaseline {
	siteId: string;
	siteOrigin?: GeodeticPosition;
	modelLocalToEnuVersion?: string;
	controlTargets: VisualControlTarget[];
	gpsBiasCorrection?: GpsBiasCorrection;
	createdAt: number;
	updatedAt?: number;
	source: 'site-baseline-config';
}

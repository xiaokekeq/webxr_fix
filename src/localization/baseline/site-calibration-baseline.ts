export type VisualControlTargetPlane = 'horizontal' | 'vertical';

export interface VisualControlTarget {
	id: string;
	name?: string;
	markerId?: string;
	centerEnu: [ number, number, number ];
	cornersEnu?: [
		[ number, number, number ],
		[ number, number, number ],
		[ number, number, number ],
		[ number, number, number ]
	];
	yawDeg?: number;
	sizeMeters?: number;
	plane: VisualControlTargetPlane;
	cornerOrder?: string[];
}

export interface SiteCalibrationBaseline {
	siteId: string;
	siteOrigin?: {
		lat: number;
		lon: number;
		alt: number;
	};
	modelLocalToEnuVersion?: string;
	controlTargets: VisualControlTarget[];
	rtkSurveyDataset?: import('@/localization/rtk/rtk-survey-dataset.js').RtkSurveyDataset;
	placementAnchorEnu?: [ number, number, number ];
	placementAnchorMeaning?: string;
	undergroundObjects?: unknown[];
	sensors?: unknown[];
	riskPoints?: unknown[];
	createdAt: number;
	updatedAt?: number;
	source: 'site-baseline-config';
}


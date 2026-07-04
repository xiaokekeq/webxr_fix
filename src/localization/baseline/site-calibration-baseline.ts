export type VisualControlTargetPlane = 'horizontal' | 'vertical';

export interface VisualControlTarget {
	id: string;
	name?: string;
	markerId?: string;
	imageUrl?: string;
	patternUrl?: string;
	centerEnu: [ number, number, number ];
	cornersEnu?: [
		[ number, number, number ],
		[ number, number, number ],
		[ number, number, number ],
		[ number, number, number ]
	];
	yawDeg?: number;
	sizeMeters?: number;
	trackingWidthMeters?: number;
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

export function getControlTargetImageUrl(target: Pick<VisualControlTarget, 'imageUrl' | 'patternUrl'>): string | null {

	const candidate = normalizeImageCandidate( target.imageUrl ) ?? normalizeImageCandidate( target.patternUrl );
	if ( candidate === null ) {
		return null;
	}

	return isSupportedImageTrackingUrl( candidate ) ? candidate : null;

}

export function isPattFileUrl(url: string): boolean {

	return /\.patt(?:$|\?)/i.test( url );

}

export function isSupportedImageTrackingUrl(url: string): boolean {

	return isPattFileUrl( url ) === false && /\.(?:png|jpe?g|webp)(?:$|\?)/i.test( url );

}

function normalizeImageCandidate(value: string | undefined): string | null {

	if ( typeof value !== 'string' ) {
		return null;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;

}

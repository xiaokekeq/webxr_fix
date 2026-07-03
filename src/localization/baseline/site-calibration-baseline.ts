export type VisualControlTargetPlane = 'horizontal' | 'vertical';

export interface VisualControlTarget {
	id: string;
	name?: string;
	markerId?: string;
	imageUrl?: string;
	patternUrl?: string;
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
	source: 'marker' | 'manual-site-pose' | 'debug';
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
	gpsBiasCorrection?: GpsBiasCorrection;
	createdAt: number;
	updatedAt?: number;
	source: 'site-baseline-config';
}

export function getControlTargetImageUrl(target: Pick<VisualControlTarget, 'imageUrl' | 'patternUrl'>): string | null {

	const candidate = normalizeImageCandidate( target.imageUrl ) ?? normalizeImageCandidate( target.patternUrl );
	if ( candidate === null ) {
		return null;
	}

	return isPattFileUrl( candidate ) ? null : candidate;

}

export function isPattFileUrl(url: string): boolean {

	return /\.patt(?:$|\?)/i.test( url );

}

function normalizeImageCandidate(value: string | undefined): string | null {

	if ( typeof value !== 'string' ) {
		return null;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;

}

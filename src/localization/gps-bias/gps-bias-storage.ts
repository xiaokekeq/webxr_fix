import type { GeodeticPosition } from '@/localization/geodesy/wgs84-enu.js';

export type GpsBiasCorrectionSource =
	| 'calibration-marker'
	| 'calibration-manual-site-pose'
	| 'debug';

export interface GpsBiasCorrection {
	siteId: string;
	origin: GeodeticPosition;
	deltaEnu: [ number, number, number ];
	yawCorrectionDeg?: number;
	accuracyMeters?: number;
	createdAt: number;
	updatedAt?: number;
	source: GpsBiasCorrectionSource;
	note?: string;
}

const GPS_BIAS_STORAGE_KEY_PREFIX = 'H5Dike.gpsBiasCorrection.';

export function buildGpsBiasStorageKey(siteId: string): string {

	return `${GPS_BIAS_STORAGE_KEY_PREFIX}${siteId}`;

}

export function loadGpsBiasCorrection(siteId: string): GpsBiasCorrection | null {

	if ( typeof window === 'undefined' || typeof window.localStorage === 'undefined' ) {
		return null;
	}

	const raw = window.localStorage.getItem( buildGpsBiasStorageKey( siteId ) );
	if ( raw === null ) {
		return null;
	}

	try {
		const parsed = JSON.parse( raw ) as unknown;
		if ( isGpsBiasCorrection( parsed ) === false ) {
			return null;
		}

		return {
			...parsed,
			source: normalizeGpsBiasCorrectionSource( parsed.source )
		};
	} catch {
		return null;
	}

}

export function saveGpsBiasCorrection(correction: GpsBiasCorrection): boolean {

	if ( typeof window === 'undefined' || typeof window.localStorage === 'undefined' ) {
		return false;
	}

	try {
		window.localStorage.setItem(
			buildGpsBiasStorageKey( correction.siteId ),
			JSON.stringify( correction )
		);
		return true;
	} catch {
		return false;
	}

}

export function clearGpsBiasCorrection(siteId: string): boolean {

	if ( typeof window === 'undefined' || typeof window.localStorage === 'undefined' ) {
		return false;
	}

	try {
		window.localStorage.removeItem( buildGpsBiasStorageKey( siteId ) );
		return true;
	} catch {
		return false;
	}

}

function isGpsBiasCorrection(candidate: unknown): candidate is GpsBiasCorrection {

	if ( typeof candidate !== 'object' || candidate === null ) {
		return false;
	}

	const value = candidate as Record<string, unknown>;
	return typeof value.siteId === 'string'
		&& isGeodeticPosition( value.origin )
		&& isDeltaEnuTuple( value.deltaEnu )
		&& typeof value.createdAt === 'number'
		&& typeof value.source === 'string';

}

function isGeodeticPosition(candidate: unknown): candidate is GeodeticPosition {

	if ( typeof candidate !== 'object' || candidate === null ) {
		return false;
	}

	const value = candidate as Record<string, unknown>;
	return typeof value.lat === 'number'
		&& typeof value.lon === 'number'
		&& typeof value.alt === 'number';

}

function isDeltaEnuTuple(candidate: unknown): candidate is [ number, number, number ] {

	return Array.isArray( candidate )
		&& candidate.length === 3
		&& candidate.every( ( item ) => typeof item === 'number' && Number.isFinite( item ) );

}

function normalizeGpsBiasCorrectionSource(source: string): GpsBiasCorrectionSource {

	switch ( source ) {
		case 'admin-marker':
		case 'calibration-marker':
			return 'calibration-marker';
		case 'admin-manual-site-pose':
		case 'calibration-manual-site-pose':
			return 'calibration-manual-site-pose';
		case 'debug':
			return 'debug';
		default:
			return 'calibration-marker';
	}

}

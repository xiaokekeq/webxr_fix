import type { SiteCalibrationBaseline } from '@/features/ar/types/workflow.js';

const STORAGE_KEY_PREFIX = 'H5Dike.siteCalibrationBaseline.';
const FORBIDDEN_KEY_PATTERN = /(?:^|\.)(?:arFromEnu|enuToArLocal|arLocalMatrix|xrAnchorMatrix|modelRootMatrixWorld)$/i;

export function buildSiteCalibrationBaselineStorageKey(siteId: string): string {

	return `${STORAGE_KEY_PREFIX}${siteId}`;

}

export function loadSiteCalibrationBaseline(siteId: string): SiteCalibrationBaseline | null {

	if ( typeof window === 'undefined' || typeof window.localStorage === 'undefined' ) {
		return null;
	}

	const raw = window.localStorage.getItem( buildSiteCalibrationBaselineStorageKey( siteId ) );
	if ( raw === null ) {
		return null;
	}

	try {
		const parsed = JSON.parse( raw ) as unknown;
		return isSiteCalibrationBaseline( parsed ) ? parsed : null;
	} catch {
		return null;
	}

}

export function saveSiteCalibrationBaseline(
	baseline: SiteCalibrationBaseline
): { ok: true } | { ok: false; reason: 'forbidden-keys' | 'storage-unavailable'; forbiddenPath?: string } {

	if ( typeof window === 'undefined' || typeof window.localStorage === 'undefined' ) {
		return { ok: false, reason: 'storage-unavailable' };
	}

	const forbiddenPath = findForbiddenPath( baseline );
	if ( forbiddenPath !== null ) {
		return {
			ok: false,
			reason: 'forbidden-keys',
			forbiddenPath
		};
	}

	try {
		window.localStorage.setItem(
			buildSiteCalibrationBaselineStorageKey( baseline.siteId ),
			JSON.stringify( baseline )
		);
		return { ok: true };
	} catch {
		return { ok: false, reason: 'storage-unavailable' };
	}

}

function findForbiddenPath(value: unknown, path = ''): string | null {

	if ( Array.isArray( value ) ) {
		for ( let index = 0; index < value.length; index += 1 ) {
			const childPath = `${path}[${index}]`;
			const result = findForbiddenPath( value[ index ], childPath );
			if ( result !== null ) {
				return result;
			}
		}

		return null;
	}

	if ( typeof value !== 'object' || value === null ) {
		return null;
	}

	for ( const [ key, child ] of Object.entries( value ) ) {
		const nextPath = path.length > 0 ? `${path}.${key}` : key;
		if ( FORBIDDEN_KEY_PATTERN.test( nextPath ) ) {
			return nextPath;
		}

		const result = findForbiddenPath( child, nextPath );
		if ( result !== null ) {
			return result;
		}
	}

	return null;

}

function isSiteCalibrationBaseline(value: unknown): value is SiteCalibrationBaseline {

	if ( typeof value !== 'object' || value === null ) {
		return false;
	}

	const candidate = value as Partial<SiteCalibrationBaseline>;
	return typeof candidate.siteId === 'string'
		&& Array.isArray( candidate.controlTargets )
		&& typeof candidate.createdAt === 'number'
		&& candidate.source === 'site-baseline-config';

}

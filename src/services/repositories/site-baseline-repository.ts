import type { SiteCalibrationBaseline } from '@/localization/baseline/site-calibration-baseline.js';
import type { HttpClient } from '@/services/api/http-client.js';

const STORAGE_KEY_PREFIX = 'H5Dike.siteCalibrationBaseline.';
const FORBIDDEN_KEY_PATTERN = /(?:^|\.)(?:arFromEnu|enuToArLocal|arLocalMatrix|xrAnchorMatrix|modelRootMatrixWorld)$/i;

export interface SiteBaselineRepository {
	load(siteId: string): Promise<SiteCalibrationBaseline | null>;
	save(baseline: SiteCalibrationBaseline): Promise<void>;
	remove(siteId: string): Promise<void>;
}

export class LocalStorageSiteBaselineRepository implements SiteBaselineRepository {

	async load(siteId: string): Promise<SiteCalibrationBaseline | null> {

		return readSiteCalibrationBaselineSnapshot( siteId );

	}

	async save(baseline: SiteCalibrationBaseline): Promise<void> {

		const validation = validateSiteCalibrationBaselineForStorage( baseline );
		if ( validation.ok === false ) {
			throw new Error( validation.reason === 'forbidden-keys'
				? `forbidden-keys:${validation.forbiddenPath ?? 'unknown'}`
				: 'storage-unavailable' );
		}

		if ( typeof window === 'undefined' || typeof window.localStorage === 'undefined' ) {
			throw new Error( 'storage-unavailable' );
		}

		window.localStorage.setItem(
			buildSiteCalibrationBaselineStorageKey( baseline.siteId ),
			JSON.stringify( baseline )
		);

	}

	async remove(siteId: string): Promise<void> {

		if ( typeof window === 'undefined' || typeof window.localStorage === 'undefined' ) {
			return;
		}

		window.localStorage.removeItem( buildSiteCalibrationBaselineStorageKey( siteId ) );

	}

}

export class ApiSiteBaselineRepository implements SiteBaselineRepository {

	constructor(private readonly http: HttpClient) {}

	async load(siteId: string): Promise<SiteCalibrationBaseline | null> {

		return this.http.get<SiteCalibrationBaseline | null>( `/api/sites/${siteId}/calibration-baseline` );

	}

	async save(baseline: SiteCalibrationBaseline): Promise<void> {

		await this.http.put<void>( `/api/sites/${baseline.siteId}/calibration-baseline`, baseline );

	}

	async remove(siteId: string): Promise<void> {

		await this.http.delete<void>( `/api/sites/${siteId}/calibration-baseline` );

	}

}

export function buildSiteCalibrationBaselineStorageKey(siteId: string): string {

	return `${STORAGE_KEY_PREFIX}${siteId}`;

}

export function readSiteCalibrationBaselineSnapshot(siteId: string): SiteCalibrationBaseline | null {

	if ( typeof window === 'undefined' || typeof window.localStorage === 'undefined' ) {
		return null;
	}

	const raw = window.localStorage.getItem( buildSiteCalibrationBaselineStorageKey( siteId ) );
	if ( raw === null ) {
		return null;
	}

	try {
		const parsed = JSON.parse( raw ) as unknown;
		return normalizeSiteCalibrationBaseline( parsed );
	} catch {
		return null;
	}

}

export function validateSiteCalibrationBaselineForStorage(
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

	return { ok: true };

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

function normalizeSiteCalibrationBaseline(value: unknown): SiteCalibrationBaseline | null {

	if ( typeof value !== 'object' || value === null ) {
		return null;
	}

	const candidate = value as Partial<SiteCalibrationBaseline>;
	if (
		typeof candidate.siteId !== 'string'
		|| Array.isArray( candidate.controlTargets ) === false
		|| typeof candidate.createdAt !== 'number'
		|| candidate.source !== 'site-baseline-config'
	) {
		return null;
	}

	return { ...candidate } as SiteCalibrationBaseline;

}

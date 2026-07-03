import type { SiteCalibrationBaseline } from '@/localization/baseline/site-calibration-baseline.js';
import {
	buildSiteCalibrationBaselineStorageKey,
	readSiteCalibrationBaselineSnapshot,
	validateSiteCalibrationBaselineForStorage
} from '@/localization/baseline/site-baseline-repository.js';

export { buildSiteCalibrationBaselineStorageKey };

export function loadSiteCalibrationBaseline(siteId: string): SiteCalibrationBaseline | null {

	return readSiteCalibrationBaselineSnapshot( siteId );

}

export function saveSiteCalibrationBaseline(
	baseline: SiteCalibrationBaseline
): { ok: true } | { ok: false; reason: 'forbidden-keys' | 'storage-unavailable'; forbiddenPath?: string } {

	const validation = validateSiteCalibrationBaselineForStorage( baseline );
	if ( validation.ok === false ) {
		return validation;
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

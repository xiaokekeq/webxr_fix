import * as THREE from 'three';
import {
	createArFromEnuSolution,
	type ArFromEnuSolution,
	type ArLocalizationSource
} from '@/localization/core/ar-from-enu-solution.js';
import { getEnuToArQuaternion } from '@/localization/coarse/coarse-registration.js';
import {
	geodeticToEnu,
	type GeodeticPosition
} from '@/localization/geodesy/wgs84-enu.js';
import type {
	GpsBiasCorrection,
	GpsBiasCorrectionSource
} from './gps-bias-storage.js';

export const GPS_BIAS_MAX_ACCEPTED_ACCURACY_METERS = 10;

const tempCorrectedDeviceEnu = new THREE.Vector3();
const tempRotatedDeviceEnu = new THREE.Vector3();
const tempInverseMatrix = new THREE.Matrix4();

export interface GpsBiasGeolocationSample {
	latitude: number;
	longitude: number;
	altitude?: number;
	accuracyMeters?: number;
	timestamp?: number;
}

export interface GpsBiasCorrectionCreationResult {
	correction: GpsBiasCorrection;
	rawGpsEnu: THREE.Vector3;
	deviceTrueEnu: THREE.Vector3;
	deltaEnu: THREE.Vector3;
}

export interface GpsBiasSessionSolutionResult {
	solution: ArFromEnuSolution;
	rawGpsEnu: THREE.Vector3;
	correctedDeviceEnu: THREE.Vector3;
	translation: THREE.Vector3;
	headingDeg: number;
}

export function createGpsBiasCorrectionFromKnownDeviceEnu(options: {
	siteId: string;
	origin: GeodeticPosition;
	rawGpsSample: GpsBiasGeolocationSample;
	deviceTrueEnu: THREE.Vector3;
	source: GpsBiasCorrectionSource;
	yawCorrectionDeg?: number;
	note?: string;
	now?: number;
}): GpsBiasCorrectionCreationResult {

	const {
		siteId,
		origin,
		rawGpsSample,
		deviceTrueEnu,
		source,
		yawCorrectionDeg,
		note,
		now = Date.now()
	} = options;
	const rawGpsEnu = geodeticToEnu( geolocationSampleToGeodeticPosition( rawGpsSample ), origin );
	const deltaEnu = deviceTrueEnu.clone().sub( rawGpsEnu );

	return {
		correction: {
			siteId,
			origin,
			deltaEnu: [ deltaEnu.x, deltaEnu.y, deltaEnu.z ],
			yawCorrectionDeg,
			accuracyMeters: rawGpsSample.accuracyMeters,
			createdAt: now,
			updatedAt: now,
			source,
			note
		},
		rawGpsEnu,
		deviceTrueEnu: deviceTrueEnu.clone(),
		deltaEnu
	};

}

export function computeCorrectedDeviceEnu(
	correction: GpsBiasCorrection,
	rawGpsSample: GpsBiasGeolocationSample,
	target = new THREE.Vector3()
): THREE.Vector3 {

	const rawGpsEnu = geodeticToEnu(
		geolocationSampleToGeodeticPosition( rawGpsSample ),
		correction.origin
	);

	return target.set(
		rawGpsEnu.x + correction.deltaEnu[ 0 ],
		rawGpsEnu.y + correction.deltaEnu[ 1 ],
		rawGpsEnu.z + correction.deltaEnu[ 2 ]
	);

}

export function createGpsBiasArFromEnuSolution(options: {
	correction: GpsBiasCorrection;
	rawGpsSample: GpsBiasGeolocationSample;
	viewerPositionAr: THREE.Vector3;
	headingDeg: number;
	sessionId: string;
	timestamp?: number;
}): GpsBiasSessionSolutionResult {

	const {
		correction,
		rawGpsSample,
		viewerPositionAr,
		headingDeg,
		sessionId,
		timestamp = Date.now()
	} = options;
	const adjustedHeadingDeg = normalizeDegrees(
		headingDeg + ( correction.yawCorrectionDeg ?? 0 )
	);
	const orientation = getEnuToArQuaternion( adjustedHeadingDeg );
	const rawGpsEnu = geodeticToEnu(
		geolocationSampleToGeodeticPosition( rawGpsSample ),
		correction.origin
	);
	const correctedDeviceEnu = tempCorrectedDeviceEnu.set(
		rawGpsEnu.x + correction.deltaEnu[ 0 ],
		rawGpsEnu.y + correction.deltaEnu[ 1 ],
		rawGpsEnu.z + correction.deltaEnu[ 2 ]
	);
	const translation = viewerPositionAr.clone().sub(
		tempRotatedDeviceEnu.copy( correctedDeviceEnu ).applyQuaternion( orientation )
	);

	return {
		solution: createArFromEnuSolution( {
			position: translation,
			orientation,
			headingDeg: adjustedHeadingDeg,
			source: 'gps-bias',
			sessionId,
			accuracyMeters: rawGpsSample.accuracyMeters,
			timestamp
		} ),
		rawGpsEnu: rawGpsEnu.clone(),
		correctedDeviceEnu: correctedDeviceEnu.clone(),
		translation,
		headingDeg: adjustedHeadingDeg
	};

}

export function deriveDeviceTrueEnuFromArSolution(options: {
	arFromEnuSolution: ArFromEnuSolution;
	viewerPositionAr: THREE.Vector3;
}): THREE.Vector3 {

	return options.viewerPositionAr.clone().applyMatrix4(
		tempInverseMatrix.copy( options.arFromEnuSolution.matrix ).invert()
	);

}

export function shouldAcceptGpsAccuracy(accuracyMeters: number | null | undefined): boolean {

	return typeof accuracyMeters === 'number'
		&& Number.isFinite( accuracyMeters )
		&& accuracyMeters <= GPS_BIAS_MAX_ACCEPTED_ACCURACY_METERS;

}

export function geolocationSampleToGeodeticPosition(
	sample: GpsBiasGeolocationSample
): GeodeticPosition {

	return {
		lat: sample.latitude,
		lon: sample.longitude,
		alt: sample.altitude ?? 0
	};

}

export function canUseGpsBiasForLocalization(source: ArLocalizationSource | null | undefined): boolean {

	return source !== 'marker'
		&& source !== 'marker-auto-image'
		&& source !== 'manual-site-pose'
		&& source !== 'rtk';

}

function normalizeDegrees(value: number): number {

	return ( ( value % 360 ) + 360 ) % 360;

}

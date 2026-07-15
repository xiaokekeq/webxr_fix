import * as THREE from 'three';

export type ArLocalizationSource =
	| 'marker'
	| 'rtk'
	| 'fallback'
	| 'vps'
	| 'unknown';

export interface ArFromEnuSolution {
	matrix: THREE.Matrix4;
	siteOriginArPosition: THREE.Vector3;
	orientation: THREE.Quaternion;
	headingDeg: number;
	source: ArLocalizationSource;
	sessionId?: string | null;
	accuracyMeters?: number;
	yawAccuracyDegrees?: number;
	timestamp: number;
}

export function createArFromEnuSolution(args: {
	position: THREE.Vector3;
	orientation: THREE.Quaternion;
	headingDeg: number;
	source?: ArLocalizationSource;
	sessionId?: string | null;
	accuracyMeters?: number;
	yawAccuracyDegrees?: number;
	timestamp?: number;
}): ArFromEnuSolution {

	const position = args.position.clone();
	const orientation = args.orientation.clone();
	const matrix = new THREE.Matrix4().compose(
		position.clone(),
		orientation.clone(),
		new THREE.Vector3( 1, 1, 1 )
	);

	return {
		matrix,
		siteOriginArPosition: position,
		orientation,
		headingDeg: args.headingDeg,
		source: args.source ?? 'unknown',
		sessionId: args.sessionId ?? null,
		accuracyMeters: args.accuracyMeters,
		yawAccuracyDegrees: args.yawAccuracyDegrees,
		timestamp: args.timestamp ?? Date.now()
	};

}


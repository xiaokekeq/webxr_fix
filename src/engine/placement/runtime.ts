import * as THREE from 'three';
import type {
	EngineeringRegistrationSolution
} from '@/localization/coarse/engineering-registration.js';
import type { ArFromEnuSolution } from '@/localization/core/ar-from-enu-solution.js';
import type { ManualPlacementBase } from '@/localization/manual/manual-registration.js';
import { placeModelAt, placeModelWithMatrix } from '@/engine/core/model.js';

const tempModelRawLocalToArMatrix = new THREE.Matrix4();
const tempMatrixPosition = new THREE.Vector3();
const tempMatrixQuaternion = new THREE.Quaternion();
const tempMatrixScale = new THREE.Vector3();

export function composeModelRawLocalToArMatrix(options: {
	arFromEnuSolution: ArFromEnuSolution;
	registrationSolution: EngineeringRegistrationSolution;
	target?: THREE.Matrix4;
}): THREE.Matrix4 {

	const target = options.target ?? new THREE.Matrix4();
	return target.multiplyMatrices(
		options.arFromEnuSolution.matrix,
		options.registrationSolution.modelToSite.matrix
	);

}

export function createPlacementBaseFromArLocalizationSolution(options: {
	arFromEnuSolution: ArFromEnuSolution;
	modelTemplate: THREE.Group;
	registrationSolution: EngineeringRegistrationSolution;
	modelOrientationTarget: THREE.Quaternion;
}): ManualPlacementBase {

	const {
		arFromEnuSolution,
		modelTemplate,
		registrationSolution,
		modelOrientationTarget
	} = options;
	void modelTemplate;
	composeModelRawLocalToArMatrix( {
		arFromEnuSolution,
		registrationSolution,
		target: tempModelRawLocalToArMatrix
	} ).decompose( tempMatrixPosition, tempMatrixQuaternion, tempMatrixScale );
	modelOrientationTarget.copy( tempMatrixQuaternion );
	const baseScale = ( tempMatrixScale.x + tempMatrixScale.y + tempMatrixScale.z ) / 3;
	const position = tempMatrixPosition.clone();

	return {
		position,
		orientation: tempMatrixQuaternion.clone(),
		scale: baseScale,
		matrix: tempModelRawLocalToArMatrix.clone(),
		scaleAnchor: position.clone(),
		siteContext: {
			siteOriginArPosition: arFromEnuSolution.siteOriginArPosition.clone(),
			headingDeg: arFromEnuSolution.headingDeg,
			baseScale,
			source: arFromEnuSolution.source,
			timestamp: arFromEnuSolution.timestamp,
			accuracyMeters: arFromEnuSolution.accuracyMeters
		}
	};

}

export function placeAdjustedModel(options: {
	modelTemplate: THREE.Group;
	placedModel: THREE.Group | null;
	modelAnchor: THREE.Group;
	adjustedPlacement: {
		position: THREE.Vector3;
		orientation: THREE.Quaternion;
		scale: number;
		matrix?: THREE.Matrix4;
	};
}): THREE.Group {

	const { modelTemplate, placedModel, modelAnchor, adjustedPlacement } = options;

	if ( adjustedPlacement.matrix !== undefined ) {
		return placeModelWithMatrix(
			modelTemplate,
			placedModel,
			modelAnchor,
			adjustedPlacement.matrix
		);
	}

	return placeModelAt(
		modelTemplate,
		placedModel,
		modelAnchor,
		adjustedPlacement.position,
		adjustedPlacement.orientation,
		adjustedPlacement.scale
	);

}

function serializeVector3(vector: THREE.Vector3): { x: number; y: number; z: number } {

	return {
		x: Number( vector.x.toFixed( 6 ) ),
		y: Number( vector.y.toFixed( 6 ) ),
		z: Number( vector.z.toFixed( 6 ) )
	};

}

function quaternionToObject(quaternion: THREE.Quaternion): { x: number; y: number; z: number; w: number } {

	return {
		x: Number( quaternion.x.toFixed( 6 ) ),
		y: Number( quaternion.y.toFixed( 6 ) ),
		z: Number( quaternion.z.toFixed( 6 ) ),
		w: Number( quaternion.w.toFixed( 6 ) )
	};

}









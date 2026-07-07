import * as THREE from 'three';
import type {
	EngineeringRegistrationSolution
} from '@/localization/coarse/engineering-registration.js';
import type { ArFromEnuSolution } from '@/localization/core/ar-from-enu-solution.js';
import { composeModelQuaternionInAr } from '@/localization/coarse/engineering-registration.js';
import type { ManualPlacementBase } from '@/localization/manual/manual-registration.js';
import { placeModelAt } from '@/engine/core/model.js';
import { getPlacementResidualScale } from './camera-fit.js';

const tempEuler = new THREE.Euler();
const tempSiteOffset = new THREE.Vector3();

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
	const baseScale = getPlacementResidualScale( modelTemplate, registrationSolution.modelToSite.scale );
	const position = composeAnchoredPlacementPosition(
		arFromEnuSolution.siteOriginArPosition,
		arFromEnuSolution.orientation,
		registrationSolution.modelToSite.translation,
		tempSiteOffset
	).clone();
	console.info( '[FormalPlacementUsesModelLocalToEnu]', {
		source: arFromEnuSolution.source,
		modelId: registrationSolution.modelId,
		modelToSiteTranslation: serializeVector3( registrationSolution.modelToSite.translation ),
		modelToSiteScale: registrationSolution.modelToSite.scale,
		siteOriginArPosition: serializeVector3( arFromEnuSolution.siteOriginArPosition ),
		placementPosition: serializeVector3( position ),
		createdAt: Date.now()
	} );
	console.info( '[FormalPlacementGroundSnapSkipped]', {
		source: arFromEnuSolution.source,
		modelId: registrationSolution.modelId,
		reason: 'formal placement uses modelLocal -> ENU -> AR local',
		createdAt: Date.now()
	} );

	return {
		position,
		orientation: flattenQuaternionToYaw(
			composeModelQuaternionInAr(
				arFromEnuSolution.orientation,
				registrationSolution,
				modelOrientationTarget
			),
			modelOrientationTarget
		).clone(),
		scale: baseScale,
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

function composeAnchoredPlacementPosition(
	placementAnchor: THREE.Vector3,
	siteToArQuaternion: THREE.Quaternion,
	modelSiteOffset: THREE.Vector3,
	target: THREE.Vector3
): THREE.Vector3 {

	return target
		.copy( modelSiteOffset )
		.applyQuaternion( siteToArQuaternion )
		.add( placementAnchor );

}

export function placeAdjustedModel(options: {
	modelTemplate: THREE.Group;
	placedModel: THREE.Group | null;
	modelAnchor: THREE.Group;
	adjustedPlacement: {
		position: THREE.Vector3;
		orientation: THREE.Quaternion;
		scale: number;
	};
}): THREE.Group {

	const { modelTemplate, placedModel, modelAnchor, adjustedPlacement } = options;

	return placeModelAt(
		modelTemplate,
		placedModel,
		modelAnchor,
		adjustedPlacement.position,
		adjustedPlacement.orientation,
		adjustedPlacement.scale
	);

}

function flattenQuaternionToYaw(
	source: THREE.Quaternion,
	target: THREE.Quaternion
): THREE.Quaternion {

	tempEuler.setFromQuaternion( source, 'YXZ' );
	target.setFromEuler( new THREE.Euler( 0, tempEuler.y, 0, 'YXZ' ) );
	return target;

}

function serializeVector3(vector: THREE.Vector3): { x: number; y: number; z: number } {

	return {
		x: Number( vector.x.toFixed( 6 ) ),
		y: Number( vector.y.toFixed( 6 ) ),
		z: Number( vector.z.toFixed( 6 ) )
	};

}









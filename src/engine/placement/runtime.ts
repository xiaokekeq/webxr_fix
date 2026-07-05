import * as THREE from 'three';
import type {
	EngineeringRegistrationSolution
} from '@/localization/coarse/engineering-registration.js';
import type { ArFromEnuSolution } from '@/localization/core/ar-from-enu-solution.js';
import { composeModelQuaternionInAr } from '@/localization/coarse/engineering-registration.js';
import type { ManualPlacementBase } from '@/localization/manual/manual-registration.js';
import { computeModelBusinessLocalBounds, placeModelAt } from '@/engine/core/model.js';
import { getPlacementResidualScale } from './camera-fit.js';

const tempEuler = new THREE.Euler();
const tempSiteOffset = new THREE.Vector3();
const tempHitTestPlacementQuaternion = new THREE.Quaternion();
const tempHitTestPlacementNorth = new THREE.Vector3();
const tempHitTestBusinessBounds = new THREE.Box3();
const tempHitTestSupportPoint = new THREE.Vector3();
const tempHitTestSupportOffset = new THREE.Vector3();
const tempHitTestPlacementPosition = new THREE.Vector3();
const tempHitTestBoundsCenter = new THREE.Vector3();
const tempHitTestBoundsSize = new THREE.Vector3();
const tempHitTestFinalScale = new THREE.Vector3();

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

export function createHitTestPlacementBase(options: {
	camera: THREE.Camera;
	groundPosition: THREE.Vector3;
	modelTemplate: THREE.Group;
	registrationSolution: EngineeringRegistrationSolution;
}): ManualPlacementBase {

	const {
		camera,
		groundPosition,
		modelTemplate,
		registrationSolution
	} = options;
	const baseScale = getPlacementResidualScale( modelTemplate, registrationSolution.modelToSite.scale );
	const orientation = flattenQuaternionToYaw(
		camera.getWorldQuaternion( tempHitTestPlacementQuaternion ),
		new THREE.Quaternion()
	).clone();
	const headingDeg = extractHeadingDegFromHitTestOrientation( orientation );
	const position = resolveHitTestPlacementPosition(
		{
			modelTemplate,
			groundPosition,
			orientation,
			baseScale,
			placementAnchorModelLocal: registrationSolution.placementAnchorModelLocal,
			placementAnchorMeaning: registrationSolution.placementAnchorMeaning,
			visualGroundOffsetMeters: registrationSolution.visualGroundOffsetMeters,
			target: tempHitTestPlacementPosition
		}
	).clone();

	return {
		position,
		orientation,
		scale: baseScale,
		scaleAnchor: position.clone(),
		siteContext: {
			siteOriginArPosition: position.clone(),
			headingDeg,
			baseScale,
			source: 'unknown',
			timestamp: Date.now()
		}
	};

}

function resolveHitTestPlacementPosition(options: {
	modelTemplate: THREE.Group;
	groundPosition: THREE.Vector3;
	orientation: THREE.Quaternion;
	baseScale: number;
	placementAnchorModelLocal?: THREE.Vector3;
	placementAnchorMeaning?: string;
	visualGroundOffsetMeters: number;
	target: THREE.Vector3;
}): THREE.Vector3 {

	const {
		modelTemplate,
		groundPosition,
		orientation,
		baseScale,
		placementAnchorModelLocal,
		placementAnchorMeaning,
		visualGroundOffsetMeters,
		target
	} = options;

	const bounds = computeModelBusinessLocalBounds( modelTemplate, tempHitTestBusinessBounds );
	logModelBounds( modelTemplate, bounds, baseScale );
	if ( bounds.isEmpty() ) {
		console.warn( '[ModelPlacementAnchorResolved]', {
			anchorSource: 'hit-test-point',
			anchorMeaning: 'empty-model-bounds',
			groundPosition: serializeVector3( groundPosition ),
			visualGroundOffsetMeters,
			createdAt: Date.now()
		} );
		return target.copy( groundPosition ).add( tempHitTestSupportOffset.set( 0, visualGroundOffsetMeters, 0 ) );
	}

	const usedConfiguredAnchor = placementAnchorModelLocal !== undefined;
	if ( usedConfiguredAnchor ) {
		tempHitTestSupportPoint.copy( placementAnchorModelLocal );
	} else {
		tempHitTestSupportPoint.set(
			bounds.min.x <= 0 && bounds.max.x >= 0 ? 0 : ( bounds.min.x + bounds.max.x ) * 0.5,
			bounds.min.y,
			bounds.min.z <= 0 && bounds.max.z >= 0 ? 0 : ( bounds.min.z + bounds.max.z ) * 0.5
		);
	}
	console.info( '[ModelPlacementAnchorResolved]', {
		anchorSource: usedConfiguredAnchor ? 'config.placementAnchorModelLocal' : 'model-business-bounds-bottom-center',
		anchorMeaning: placementAnchorMeaning ?? ( usedConfiguredAnchor ? 'configured-model-local-anchor' : 'model_bottom_center' ),
		anchorModelLocal: serializeVector3( tempHitTestSupportPoint ),
		visualGroundOffsetMeters,
		createdAt: Date.now()
	} );
	tempHitTestSupportOffset
		.copy( tempHitTestSupportPoint )
		.multiply( modelTemplate.scale )
		.multiplyScalar( baseScale )
		.applyQuaternion( orientation );

	target.copy( groundPosition ).sub( tempHitTestSupportOffset );
	target.y += visualGroundOffsetMeters;

	console.info(
		usedConfiguredAnchor ? '[TemporaryPlacementAnchorSnapApplied]' : '[TemporaryPlacementBottomSnapApplied]',
		{
			groundPosition: serializeVector3( groundPosition ),
			anchorModelLocal: serializeVector3( tempHitTestSupportPoint ),
			supportOffsetAr: serializeVector3( tempHitTestSupportOffset ),
			resultPosition: serializeVector3( target ),
			visualGroundOffsetMeters,
			createdAt: Date.now()
		}
	);

	return target;

}

function logModelBounds(
	modelTemplate: THREE.Group,
	bounds: THREE.Box3,
	baseScale: number
): void {

	if ( bounds.isEmpty() ) {
		console.warn( '[ModelBoundsComputed]', {
			empty: true,
			baseScale,
			modelTemplateScale: serializeVector3( modelTemplate.scale ),
			createdAt: Date.now()
		} );
		return;
	}

	bounds.getCenter( tempHitTestBoundsCenter );
	bounds.getSize( tempHitTestBoundsSize );
	tempHitTestFinalScale.copy( modelTemplate.scale ).multiplyScalar( baseScale );
	const scaledSize = tempHitTestBoundsSize.clone().multiply( tempHitTestFinalScale );
	console.info( '[ModelBoundsComputed]', {
		empty: false,
		min: serializeVector3( bounds.min ),
		max: serializeVector3( bounds.max ),
		center: serializeVector3( tempHitTestBoundsCenter ),
		size: serializeVector3( tempHitTestBoundsSize ),
		modelTemplateScale: serializeVector3( modelTemplate.scale ),
		baseScale,
		finalScale: serializeVector3( tempHitTestFinalScale ),
		scaledSize: serializeVector3( scaledSize ),
		createdAt: Date.now()
	} );

	const bottomToleranceMeters = Math.max( tempHitTestBoundsSize.y * 0.02, 0.05 );
	if ( Math.abs( bounds.min.y ) > bottomToleranceMeters ) {
		console.warn( '[ModelRootOriginWarning]', {
			reason: 'model root is not near the business bounds bottom',
			minY: bounds.min.y,
			toleranceMeters: bottomToleranceMeters,
			createdAt: Date.now()
		} );
	}

	const longestScaledEdge = Math.max( Math.abs( scaledSize.x ), Math.abs( scaledSize.y ), Math.abs( scaledSize.z ) );
	if ( longestScaledEdge > 1000 || ( longestScaledEdge > 0 && longestScaledEdge < 0.05 ) ) {
		console.warn( '[ModelScaleUnitWarning]', {
			reason: 'scaled model bounds look unusually large or small for meter-based AR placement',
			longestScaledEdgeMeters: longestScaledEdge,
			baseScale,
			modelTemplateScale: serializeVector3( modelTemplate.scale ),
			createdAt: Date.now()
		} );
	}

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

function extractHeadingDegFromHitTestOrientation(orientation: THREE.Quaternion): number {

	tempHitTestPlacementNorth.set( 0, 1, 0 ).applyQuaternion( orientation );
	return normalizeDegrees(
		THREE.MathUtils.radToDeg( Math.atan2( - tempHitTestPlacementNorth.x, - tempHitTestPlacementNorth.z ) )
	);

}

function normalizeDegrees(value: number): number {

	return ( ( value % 360 ) + 360 ) % 360;

}

function serializeVector3(vector: THREE.Vector3): { x: number; y: number; z: number } {

	return {
		x: Number( vector.x.toFixed( 6 ) ),
		y: Number( vector.y.toFixed( 6 ) ),
		z: Number( vector.z.toFixed( 6 ) )
	};

}









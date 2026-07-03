import * as THREE from 'three';
import {
	createArFromEnuSolution,
	type ArFromEnuSolution
} from '@/localization/core/ar-from-enu-solution.js';
import type { EngineeringRegistrationSolution } from '@/localization/coarse/engineering-registration.js';
import type { PlacementSession } from '@/engine/placement/session.js';

interface ArLocalizationRuntimeOptions {
	placementSession: PlacementSession;
	isPresenting(): boolean;
	getCurrentSessionId(): string | null;
	getRegistrationSolution(): EngineeringRegistrationSolution | null;
	hasManualAdjustments(): boolean;
	hasActiveManualSitePose(): boolean;
	getActiveMarkerArFromEnuSolution(): ArFromEnuSolution | null;
	getMarkerCorrectionFallbackArFromEnuSolution(): ArFromEnuSolution | null;
	getGpsBiasArFromEnuSolution(): ArFromEnuSolution | null;
	getCoarseArFromEnuSolution(): ArFromEnuSolution | null;
}

const tempDerivedArPosition = new THREE.Vector3();
const tempDerivedArOrientation = new THREE.Quaternion();
const tempDerivedArScale = new THREE.Vector3();
const tempInverseModelToSiteRotation = new THREE.Quaternion();
const tempSiteTranslationInAr = new THREE.Vector3();
const tempNorthVectorInAr = new THREE.Vector3();

export class ArLocalizationRuntime {

	constructor(private readonly options: ArLocalizationRuntimeOptions) {}

	getActiveArFromEnuSolution(): ArFromEnuSolution | null {

		const activeMarkerSolution = this.getActiveMarkerArFromEnuSolutionForCurrentSession();
		if ( activeMarkerSolution !== null ) {
			return activeMarkerSolution;
		}

		const placedModelSolution = this.deriveCurrentPlacedModelArFromEnuSolution();
		if ( placedModelSolution !== null ) {
			return placedModelSolution;
		}

		const gpsBiasSolution = this.options.getGpsBiasArFromEnuSolution();
		if ( gpsBiasSolution !== null ) {
			return cloneArFromEnuSolution( gpsBiasSolution );
		}

		const coarseSolution = this.options.getCoarseArFromEnuSolution();
		return coarseSolution === null ? null : cloneArFromEnuSolution( coarseSolution );

	}

	getCurrentNonMarkerArFromEnuSolution(): ArFromEnuSolution | null {

		const placedModelSolution = this.deriveCurrentPlacedModelArFromEnuSolution();
		if ( placedModelSolution !== null ) {
			return placedModelSolution;
		}

		const gpsBiasSolution = this.options.getGpsBiasArFromEnuSolution();
		if ( gpsBiasSolution !== null ) {
			return cloneArFromEnuSolution( gpsBiasSolution );
		}

		const coarseSolution = this.options.getCoarseArFromEnuSolution();
		return coarseSolution === null ? null : cloneArFromEnuSolution( coarseSolution );

	}

	getMarkerCorrectionFallbackSolution(): ArFromEnuSolution | null {

		const markerFallbackSolution = this.options.getMarkerCorrectionFallbackArFromEnuSolution();
		if ( markerFallbackSolution !== null ) {
			return cloneArFromEnuSolution( markerFallbackSolution );
		}

		const gpsBiasSolution = this.options.getGpsBiasArFromEnuSolution();
		if ( gpsBiasSolution !== null ) {
			return cloneArFromEnuSolution( gpsBiasSolution );
		}

		const coarseSolution = this.options.getCoarseArFromEnuSolution();
		return coarseSolution === null ? null : cloneArFromEnuSolution( coarseSolution );

	}

	getActiveMarkerArFromEnuSolutionForCurrentSession(): ArFromEnuSolution | null {

		const activeMarkerSolution = this.options.getActiveMarkerArFromEnuSolution();
		if (
			activeMarkerSolution === null
			|| activeMarkerSolution.sessionId !== this.options.getCurrentSessionId()
		) {
			return null;
		}

		return cloneArFromEnuSolution( activeMarkerSolution );

	}

	deriveCurrentPlacedModelArFromEnuSolution(): ArFromEnuSolution | null {

		const placedModel = this.options.placementSession.getArPlacedModel();
		const placementBase = this.options.placementSession.getPlacementBase();
		const registrationSolution = this.options.getRegistrationSolution();
		if (
			this.options.isPresenting() === false
			|| placedModel === null
			|| placementBase?.siteContext === undefined
			|| registrationSolution === null
		) {
			return null;
		}

		placedModel.updateMatrixWorld( true );
		placedModel.getWorldPosition( tempDerivedArPosition );
		placedModel.getWorldQuaternion( tempDerivedArOrientation );
		placedModel.getWorldScale( tempDerivedArScale );

		tempDerivedArOrientation.multiply(
			tempInverseModelToSiteRotation.copy( registrationSolution.modelToSite.rotation ).invert()
		);

		const siteOriginArPosition = tempDerivedArPosition.clone().sub(
			tempSiteTranslationInAr
				.copy( registrationSolution.modelToSite.translation )
				.applyQuaternion( tempDerivedArOrientation )
		);
		const hasManualSitePose = this.options.hasManualAdjustments()
			|| this.options.hasActiveManualSitePose();
		const fallbackSource = placementBase.siteContext.source
			?? this.options.getCoarseArFromEnuSolution()?.source
			?? 'gps-imu';

		return createArFromEnuSolution( {
			position: siteOriginArPosition,
			orientation: tempDerivedArOrientation.clone(),
			headingDeg: extractHeadingDegFromEnuOrientation( tempDerivedArOrientation ),
			source: hasManualSitePose ? 'manual-site-pose' : fallbackSource,
			sessionId: this.options.getCurrentSessionId(),
			accuracyMeters: placementBase.siteContext.accuracyMeters,
			timestamp: placementBase.siteContext.timestamp ?? Date.now()
		} );

	}

}

function extractHeadingDegFromEnuOrientation(orientation: THREE.Quaternion): number {

	tempNorthVectorInAr.set( 0, 1, 0 ).applyQuaternion( orientation );
	return normalizeDegrees(
		THREE.MathUtils.radToDeg( Math.atan2( - tempNorthVectorInAr.x, - tempNorthVectorInAr.z ) )
	);

}

function cloneArFromEnuSolution(solution: ArFromEnuSolution): ArFromEnuSolution {

	return {
		matrix: solution.matrix.clone(),
		siteOriginArPosition: solution.siteOriginArPosition.clone(),
		orientation: solution.orientation.clone(),
		headingDeg: solution.headingDeg,
		source: solution.source,
		sessionId: solution.sessionId ?? null,
		accuracyMeters: solution.accuracyMeters,
		yawAccuracyDegrees: solution.yawAccuracyDegrees,
		timestamp: solution.timestamp
	};

}

function normalizeDegrees(value: number): number {

	return ( ( value % 360 ) + 360 ) % 360;

}

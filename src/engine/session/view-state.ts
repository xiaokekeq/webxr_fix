import type * as THREE from 'three';
import type { DemoModelConfig } from '@/models/config/demo-model-config.js';
import {
	createDefaultPlacementSummaryState,
	type PlacementSummaryState,
	type RegistrationMetricsState
} from '@/localization/core/registration-store.js';
import type { EngineeringRegistrationSolution } from '@/localization/coarse/engineering-registration.js';
import {
	formatGeodetic,
	formatQuaternion,
	formatVector3,
	quaternionToPlainObject,
	vectorToPlainObject
} from '@/features/ar/utils/formatters.js';

export function createRegistrationMetricsState(
	demoModelConfig: DemoModelConfig,
	registrationSolution: EngineeringRegistrationSolution
): RegistrationMetricsState {

	return {
		gpsText: formatGeodetic( demoModelConfig.anchor.lat, demoModelConfig.anchor.lon, demoModelConfig.anchor.alt ),
		enuText: formatGeodetic(
			registrationSolution.siteOrigin.lat,
			registrationSolution.siteOrigin.lon,
			registrationSolution.siteOrigin.alt
		),
		rmsText: `${registrationSolution.modelToSite.rmsErrorMeters.toFixed( 3 )} m`,
		rmsErrorMeters: registrationSolution.modelToSite.rmsErrorMeters,
		rmsSource: 'engineering'
	};

}

export function createPlacementSummaryState(
	placedModel: THREE.Object3D | null
): PlacementSummaryState {

	return placedModel === null
		? createDefaultPlacementSummaryState()
		: {
			positionText: formatVector3( placedModel.position ),
			quaternionText: formatQuaternion( placedModel.quaternion ),
			scaleText: formatVector3( placedModel.scale )
		};

}

export function createRegistrationSnapshot(options: {
	demoModelConfig: DemoModelConfig;
	registrationSolution: EngineeringRegistrationSolution;
	currentStage: string;
	manualReadout: unknown;
	placedModel: THREE.Group | null;
}) {

	const {
		demoModelConfig,
		registrationSolution,
		currentStage,
		manualReadout,
		placedModel
	} = options;

	return {
		modelId: demoModelConfig.modelId,
		stage: currentStage,
		siteOrigin: registrationSolution.siteOrigin,
		rootWorldGeodetic: registrationSolution.rootWorldGeodetic,
		modelToSite: {
			translation: vectorToPlainObject( registrationSolution.modelToSite.translation ),
			rotation: quaternionToPlainObject( registrationSolution.modelToSite.rotation ),
			scale: registrationSolution.modelToSite.scale,
			rmsErrorMeters: registrationSolution.modelToSite.rmsErrorMeters
		},
		manualRegistration: manualReadout,
		currentPlacement: placedModel === null ? null : {
			position: vectorToPlainObject( placedModel.position ),
			quaternion: quaternionToPlainObject( placedModel.quaternion ),
			scale: vectorToPlainObject( placedModel.scale )
		}
	};

}












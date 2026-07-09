import * as THREE from 'three';
import type { ARSceneBundle } from '@/features/ar/types/runtime-types.js';
import { clearPlacedModel, placeModelWithMatrix } from '@/engine/core/model.js';
import type { ArFromEnuSolution } from '@/localization/core/ar-from-enu-solution.js';
import type { EngineeringRegistrationSolution } from '@/localization/coarse/engineering-registration.js';
import type { ManualPlacementBase } from '@/localization/manual/manual-registration.js';
import { createDefaultTargetGuidanceState } from '@/localization/core/registration-store.js';
import { createPlacementSummaryState } from '@/engine/session/view-state.js';
import {
	composeModelRawLocalToArMatrix,
	createPlacementBaseFromArLocalizationSolution,
	placeAdjustedModel
} from './runtime.js';
import type { PropertySelectionController } from '@/engine/interaction/property-selection.js';

type ArPlacementSource = 'marker' | 'unknown';

interface TrackedArPlacementTransform {
	source: ArPlacementSource;
	position: THREE.Vector3;
	quaternion: THREE.Quaternion;
	scale: THREE.Vector3;
}

interface CreatePlacementSessionOptions {
	store: {
		patch(partialState: {
			placementSummary?: ReturnType<typeof createPlacementSummaryState>;
			targetGuidance?: ReturnType<typeof createDefaultTargetGuidanceState>;
		}): void;
	};
	sceneBundle: ARSceneBundle;
	propertySelection: PropertySelectionController;
	setStatus(message: string): void;
	updateRegistrationStatusDetail(message: string): void;
}

export interface PlacementSession {
	getPlacedModel(): THREE.Group | null;
	getArPlacedModel(): THREE.Group | null;
	getPlacementBase(): ManualPlacementBase | null;
	getAutoPlacementPending(): boolean;
	markAutoPlacementPending(): void;
	cancelAutoPlacement(): void;
	resetPlacement(): void;
	requestAutoPlacement(modelTemplate: THREE.Group | null): void;
	attemptLocalizedPlacement(args: {
		modelTemplate: THREE.Group | null;
		registrationSolution: EngineeringRegistrationSolution | null;
		arFromEnuSolutionOverride?: ArFromEnuSolution | null;
		modelOrientationTarget: THREE.Quaternion;
		onPlacementBaseResolved?(base: ManualPlacementBase): void;
	}): void;
	applyArLocalizationSolution(args: {
		modelTemplate: THREE.Group | null;
		registrationSolution: EngineeringRegistrationSolution | null;
		arFromEnuSolution: ArFromEnuSolution;
		currentSessionId?: string | null;
	}): boolean;
	placeEngineeringModelFromCurrentArFromEnu(args: {
		modelTemplate: THREE.Group | null;
		registrationSolution: EngineeringRegistrationSolution | null;
		arFromEnuSolution: ArFromEnuSolution | null;
		currentSessionId?: string | null;
	}): boolean;
	updateArPlacementAnchor(frame: XRFrame): void;
	verifyWorldLockedPlacement(caller: string): void;
}

export function createPlacementSession(options: CreatePlacementSessionOptions): PlacementSession {

	const {
		store,
		sceneBundle,
		propertySelection,
		setStatus,
		updateRegistrationStatusDetail
	} = options;

	let arPlacedModel: THREE.Group | null = null;
	let arPlacementBase: ManualPlacementBase | null = null;
	let autoPlacementPending = false;
	let trackedArPlacementTransform: TrackedArPlacementTransform | null = null;
	const visualOffsetMatrix = new THREE.Matrix4();

	function updatePlacementSummary(): void {

		store.patch( { placementSummary: createPlacementSummaryState( arPlacedModel ) } );

	}

	function resetArPlacementAnchorTransform(): void {

		sceneBundle.arPlacementAnchor.position.set( 0, 0, 0 );
		sceneBundle.arPlacementAnchor.quaternion.identity();
		sceneBundle.arPlacementAnchor.scale.set( 1, 1, 1 );
		sceneBundle.arPlacementAnchor.updateMatrixWorld( true );

	}

	function clearArPlacementTracking(): void {

		trackedArPlacementTransform = null;

	}

	function resolvePlacementSourceFromArLocalization(
		source: ArFromEnuSolution['source'] | undefined
	): ArPlacementSource {

		return source === 'marker' ? 'marker' : 'unknown';

	}

	function trackArPlacement(source: ArPlacementSource): void {

		if ( arPlacedModel === null ) {
			clearArPlacementTracking();
			return;
		}

		arPlacedModel.updateMatrixWorld( true );
		trackedArPlacementTransform = {
			source,
			position: arPlacedModel.getWorldPosition( new THREE.Vector3() ),
			quaternion: arPlacedModel.getWorldQuaternion( new THREE.Quaternion() ),
			scale: arPlacedModel.getWorldScale( new THREE.Vector3() )
		};

	}

	function createAdjustedPlacementFromBase(base: ManualPlacementBase): {
		position: THREE.Vector3;
		orientation: THREE.Quaternion;
		scale: number;
		matrix?: THREE.Matrix4;
	} {

		return {
			position: base.position.clone(),
			orientation: base.orientation.clone(),
			scale: base.scale,
			matrix: base.matrix?.clone()
		};

	}

	function placeFromPlacementBase(
		modelTemplate: THREE.Group,
		source: ArPlacementSource
	): void {

		if ( arPlacementBase === null ) {
			return;
		}

		const adjustedPlacement = createAdjustedPlacementFromBase( arPlacementBase );
		resetArPlacementAnchorTransform();
		arPlacedModel = placeAdjustedModel( {
			modelTemplate,
			placedModel: arPlacedModel,
			modelAnchor: sceneBundle.arModelAnchor,
			adjustedPlacement
		} );
		trackArPlacement( source );
		updateRegistrationStatusDetail( '状态：模型已按工程坐标显示' );
		updatePlacementSummary();
		console.info( '[EngineeringPlacementTransformApplied]', {
			source,
			usedHitTestForFinalPlacement: false,
			position: vector3ToObject( adjustedPlacement.position ),
			quaternion: quaternionToObject( adjustedPlacement.orientation ),
			scale: adjustedPlacement.scale,
			createdAt: Date.now()
		} );

	}

	return {
		getPlacedModel() {

			return arPlacedModel;

		},

		getArPlacedModel() {

			return arPlacedModel;

		},

		getPlacementBase() {

			return arPlacementBase;

		},

		getAutoPlacementPending() {

			return autoPlacementPending;

		},

		markAutoPlacementPending() {

			autoPlacementPending = true;

		},

		cancelAutoPlacement() {

			autoPlacementPending = false;

		},

		resetPlacement() {

			arPlacedModel = clearPlacedModel( sceneBundle.arModelAnchor, arPlacedModel );
			autoPlacementPending = false;
			arPlacementBase = null;
			resetArPlacementAnchorTransform();
			clearArPlacementTracking();
			propertySelection.clearSelection();
			updatePlacementSummary();
			store.patch( { targetGuidance: createDefaultTargetGuidanceState() } );

		},

		requestAutoPlacement(modelTemplate) {

			if ( modelTemplate === null || sceneBundle.renderer.xr.isPresenting === false ) {
				return;
			}

			autoPlacementPending = true;
			updateRegistrationStatusDetail( '状态：等待 Marker 四角点校正' );

		},

		attemptLocalizedPlacement(args) {

			const {
				modelTemplate,
				registrationSolution,
				arFromEnuSolutionOverride,
				modelOrientationTarget,
				onPlacementBaseResolved
			} = args;

			if (
				autoPlacementPending === false
				|| modelTemplate === null
				|| registrationSolution === null
			) {
				return;
			}

			if ( arFromEnuSolutionOverride === null || arFromEnuSolutionOverride === undefined ) {
				console.info( '[FormalLocalizationRequired]', {
					reason: 'localized placement skipped without marker ENU-to-AR transform',
					createdAt: Date.now()
				} );
				updateRegistrationStatusDetail( '状态：等待 Marker 四角点定位' );
				setStatus( '请先完成 Marker 四角点校正后再进行工程放置。' );
				autoPlacementPending = false;
				return;
			}

			arPlacementBase = createPlacementBaseFromArLocalizationSolution( {
				arFromEnuSolution: arFromEnuSolutionOverride,
				modelTemplate,
				registrationSolution,
				modelOrientationTarget
			} );
			onPlacementBaseResolved?.( arPlacementBase );
			placeFromPlacementBase(
				modelTemplate,
				resolvePlacementSourceFromArLocalization( arFromEnuSolutionOverride.source )
			);
			autoPlacementPending = false;
			setStatus( '模型已按工程坐标显示，未使用 hit-test 决定最终位置。' );

		},

		applyArLocalizationSolution(args) {

			const {
				arFromEnuSolution,
				currentSessionId
			} = args;

			if (
				requiresCurrentSession( arFromEnuSolution.source )
				&& currentSessionId !== undefined
				&& arFromEnuSolution.sessionId !== currentSessionId
			) {
				console.warn( '[CrossSessionSolutionRejected]', {
					source: arFromEnuSolution.source,
					solutionSessionId: arFromEnuSolution.sessionId ?? null,
					currentSessionId: currentSessionId ?? null
				} );
				return false;
			}

			console.warn( '[ApplyArLocalizationSolutionPlacementSkipped]', {
				source: arFromEnuSolution.source,
				sessionId: arFromEnuSolution.sessionId ?? null,
				currentSessionId: currentSessionId ?? null,
				reason: 'applyArLocalizationSolution only validates/caches localization; formal placement must use placeEngineeringModelFromCurrentArFromEnu',
				createdAt: Date.now()
			} );
			return false;

		},

		placeEngineeringModelFromCurrentArFromEnu(args) {

			const {
				modelTemplate,
				registrationSolution,
				arFromEnuSolution,
				currentSessionId
			} = args;

			if ( modelTemplate === null || registrationSolution === null || arFromEnuSolution === null ) {
				console.info( '[FormalLocalizationRequired]', {
					reason: 'formal matrix placement requires model template, modelLocal-to-ENU registration, and marker ENU-to-AR transform',
					hasModelTemplate: modelTemplate !== null,
					hasRegistrationSolution: registrationSolution !== null,
					hasArFromEnuSolution: arFromEnuSolution !== null,
					createdAt: Date.now()
				} );
				return false;
			}

			if (
				requiresCurrentSession( arFromEnuSolution.source )
				&& currentSessionId !== undefined
				&& arFromEnuSolution.sessionId !== currentSessionId
			) {
				console.warn( '[CrossSessionSolutionRejected]', {
					source: arFromEnuSolution.source,
					solutionSessionId: arFromEnuSolution.sessionId ?? null,
					currentSessionId: currentSessionId ?? null
				} );
				return false;
			}

			const modelRawLocalToArMatrix = composeModelRawLocalToArMatrix( {
				arFromEnuSolution,
				registrationSolution
			} );
			const visualOffsetMeters = resolveConfiguredVisualYOffsetMeters( modelTemplate, registrationSolution, modelRawLocalToArMatrix );
			if ( visualOffsetMeters !== 0 ) {
				modelRawLocalToArMatrix.premultiply( visualOffsetMatrix.makeTranslation( 0, visualOffsetMeters, 0 ) );
			}
			resetArPlacementAnchorTransform();
			arPlacementBase = null;
			arPlacedModel = placeModelWithMatrix(
				modelTemplate,
				arPlacedModel,
				sceneBundle.arModelAnchor,
				modelRawLocalToArMatrix
			);
			trackArPlacement( resolvePlacementSourceFromArLocalization( arFromEnuSolution.source ) );
			updateRegistrationStatusDetail( '状态：模型已按工程矩阵显示' );
			updatePlacementSummary();
			console.info( '[EngineeringModelPlacedFromMatrix]', {
				source: arFromEnuSolution.source,
				modelId: registrationSolution.modelId,
				matrixChain: 'modelLocal -> modelToSite -> arFromEnu',
				usedHitTestForFinalPlacement: false,
				usedPlacementBase: false,
				modelToSiteMatrix: registrationSolution.modelToSite.matrix.toArray(),
				arFromEnuMatrix: arFromEnuSolution.matrix.toArray(),
				modelRawLocalToArMatrix: modelRawLocalToArMatrix.toArray(),
				visualPlacementMode: registrationSolution.visualPlacementMode,
				visualYOffsetMeters: visualOffsetMeters,
				createdAt: Date.now()
			} );
			setStatus( '模型已按工程矩阵显示，未使用 hit-test 决定最终位置。' );
			autoPlacementPending = false;
			return true;

		},

		updateArPlacementAnchor(frame) {

			void frame;

		},

		verifyWorldLockedPlacement(_caller) {

			if (
				sceneBundle.renderer.xr.isPresenting === false
				|| arPlacedModel === null
				|| trackedArPlacementTransform === null
			) {
				return;
			}

			arPlacedModel.updateMatrixWorld( true );
			trackedArPlacementTransform = {
				source: trackedArPlacementTransform.source,
				position: arPlacedModel.getWorldPosition( new THREE.Vector3() ),
				quaternion: arPlacedModel.getWorldQuaternion( new THREE.Quaternion() ),
				scale: arPlacedModel.getWorldScale( new THREE.Vector3() )
			};

		}
	};

}

function requiresCurrentSession(source: ArFromEnuSolution['source'] | undefined): boolean {

	return source === 'marker';

}

function resolveConfiguredVisualYOffsetMeters(
	modelTemplate: THREE.Group,
	registrationSolution: EngineeringRegistrationSolution,
	modelRawLocalToArMatrix: THREE.Matrix4
): number {

	const explicitOffset = registrationSolution.visualGroundOffsetMeters;
	if ( registrationSolution.visualPlacementMode !== 'underground' ) {
		return explicitOffset;
	}

	const bounds = new THREE.Box3().setFromObject( modelTemplate );
	if ( bounds.isEmpty() ) {
		return explicitOffset;
	}

	const localHeight = bounds.max.y - bounds.min.y;
	const arHeight = new THREE.Vector3( 0, localHeight, 0 )
		.applyMatrix3( new THREE.Matrix3().setFromMatrix4( modelRawLocalToArMatrix ) )
		.length();
	return explicitOffset - arHeight;

}

function vector3ToObject(vector: THREE.Vector3): { x: number; y: number; z: number } {

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

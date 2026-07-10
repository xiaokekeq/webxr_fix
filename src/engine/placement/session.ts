import * as THREE from 'three';
import type { ARSceneBundle } from '@/features/ar/types/runtime-types.js';
import { clearPlacedModel, placeModelWithMatrix, readPlaceableTemplateReport } from '@/engine/core/model.js';
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

interface WorldLockSnapshot {
	placedModelWorldPosition: THREE.Vector3;
	arModelAnchorWorldPosition: THREE.Vector3;
	arPlacementAnchorWorldPosition: THREE.Vector3;
	cameraWorldPosition: THREE.Vector3;
	cameraToModelDistance: number;
	timestamp: number;
	placedModelMatrixWorld: THREE.Matrix4;
	arModelAnchorMatrixWorld: THREE.Matrix4;
	arPlacementAnchorMatrixWorld: THREE.Matrix4;
	engineeringMatrix?: THREE.Matrix4;
	visualMatrix?: THREE.Matrix4;
	arFromEnuMatrix?: THREE.Matrix4;
}

export interface PlacementWorldLockDiagnostics {
	initialSnapshot: WorldLockSnapshot | null;
	currentSnapshot: WorldLockSnapshot | null;
	updateCount: number;
	lastUpdateReason: string;
	lastUpdateTimestamp: number | null;
	updatedInFrameLoop: boolean;
	placementAnchorUpdateCount: number;
	lastPlacementAnchorUpdateReason: string;
	lastPlacementAnchorUpdateTimestamp: number | null;
	placementAnchorUpdatedFromFrameLoop: boolean;
	placementAnchorUpdatedFromHitTest: boolean;
	placementAnchorUpdatedFromReticle: boolean;
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
	getWorldLockDiagnostics(): PlacementWorldLockDiagnostics;
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
	let worldLockInitialSnapshot: WorldLockSnapshot | null = null;
	let worldLockCurrentSnapshot: WorldLockSnapshot | null = null;
	let worldLockUpdateCount = 0;
	let lastWorldLockUpdateReason = 'none';
	let lastWorldLockUpdateTimestamp: number | null = null;
	let worldLockUpdatedInFrameLoop = false;
	let lastWorldLockVerificationAt = 0;
	let placementAnchorUpdateCount = 0;
	let lastPlacementAnchorUpdateReason = 'none';
	let lastPlacementAnchorUpdateTimestamp: number | null = null;
	const visualOffsetMatrix = new THREE.Matrix4();

	function updatePlacementSummary(): void {

		store.patch( { placementSummary: createPlacementSummaryState( arPlacedModel ) } );

	}

	function resetArPlacementAnchorTransform(reason = 'placement-reset'): void {

		sceneBundle.arPlacementAnchor.position.set( 0, 0, 0 );
		sceneBundle.arPlacementAnchor.quaternion.identity();
		sceneBundle.arPlacementAnchor.scale.set( 1, 1, 1 );
		sceneBundle.arPlacementAnchor.updateMatrixWorld( true );
		placementAnchorUpdateCount += 1;
		lastPlacementAnchorUpdateReason = reason;
		lastPlacementAnchorUpdateTimestamp = Date.now();

	}

	function clearArPlacementTracking(): void {

		trackedArPlacementTransform = null;
		worldLockInitialSnapshot = null;
		worldLockCurrentSnapshot = null;
		worldLockUpdateCount = 0;
		lastWorldLockUpdateReason = 'none';
		lastWorldLockUpdateTimestamp = null;
		worldLockUpdatedInFrameLoop = false;
		lastWorldLockVerificationAt = 0;
		placementAnchorUpdateCount = 0;
		lastPlacementAnchorUpdateReason = 'none';
		lastPlacementAnchorUpdateTimestamp = null;

	}

	function getCurrentCameraWorldPosition(): THREE.Vector3 {

		const camera = sceneBundle.renderer.xr.isPresenting
			? sceneBundle.renderer.xr.getCamera()
			: sceneBundle.camera;
		camera.updateMatrixWorld( true );
		return camera.getWorldPosition( new THREE.Vector3() );

	}

	function captureWorldLockSnapshot(args?: {
		engineeringMatrix?: THREE.Matrix4;
		visualMatrix?: THREE.Matrix4;
		arFromEnuMatrix?: THREE.Matrix4;
	}): WorldLockSnapshot | null {

		if ( arPlacedModel === null ) {
			return null;
		}

		sceneBundle.scene.updateMatrixWorld( true );
		sceneBundle.camera.updateMatrixWorld( true );
		sceneBundle.arModelAnchor.updateMatrixWorld( true );
		sceneBundle.arPlacementAnchor.updateMatrixWorld( true );
		arPlacedModel.updateMatrixWorld( true );

		const placedModelWorldPosition = arPlacedModel.getWorldPosition( new THREE.Vector3() );
		const cameraWorldPosition = getCurrentCameraWorldPosition();

		return {
			placedModelWorldPosition,
			arModelAnchorWorldPosition: sceneBundle.arModelAnchor.getWorldPosition( new THREE.Vector3() ),
			arPlacementAnchorWorldPosition: sceneBundle.arPlacementAnchor.getWorldPosition( new THREE.Vector3() ),
			cameraWorldPosition,
			cameraToModelDistance: cameraWorldPosition.distanceTo( placedModelWorldPosition ),
			timestamp: Date.now(),
			placedModelMatrixWorld: arPlacedModel.matrixWorld.clone(),
			arModelAnchorMatrixWorld: sceneBundle.arModelAnchor.matrixWorld.clone(),
			arPlacementAnchorMatrixWorld: sceneBundle.arPlacementAnchor.matrixWorld.clone(),
			engineeringMatrix: args?.engineeringMatrix?.clone(),
			visualMatrix: args?.visualMatrix?.clone(),
			arFromEnuMatrix: args?.arFromEnuMatrix?.clone()
		};

	}

	function initializeWorldLockSnapshot(args: {
		engineeringMatrix: THREE.Matrix4;
		visualMatrix: THREE.Matrix4;
		arFromEnuMatrix: THREE.Matrix4;
		reason: string;
	}): void {

		const snapshot = captureWorldLockSnapshot( args );
		worldLockInitialSnapshot = snapshot;
		worldLockCurrentSnapshot = snapshot === null ? null : {
			...snapshot,
			placedModelWorldPosition: snapshot.placedModelWorldPosition.clone(),
			arModelAnchorWorldPosition: snapshot.arModelAnchorWorldPosition.clone(),
			arPlacementAnchorWorldPosition: snapshot.arPlacementAnchorWorldPosition.clone(),
			cameraWorldPosition: snapshot.cameraWorldPosition.clone(),
			placedModelMatrixWorld: snapshot.placedModelMatrixWorld.clone(),
			arModelAnchorMatrixWorld: snapshot.arModelAnchorMatrixWorld.clone(),
			arPlacementAnchorMatrixWorld: snapshot.arPlacementAnchorMatrixWorld.clone(),
			engineeringMatrix: snapshot.engineeringMatrix?.clone(),
			visualMatrix: snapshot.visualMatrix?.clone(),
			arFromEnuMatrix: snapshot.arFromEnuMatrix?.clone()
		};
		worldLockUpdateCount = snapshot === null ? 0 : 1;
		lastWorldLockUpdateReason = args.reason;
		lastWorldLockUpdateTimestamp = snapshot?.timestamp ?? null;
		worldLockUpdatedInFrameLoop = args.reason === 'xr-frame';
		lastWorldLockVerificationAt = snapshot?.timestamp ?? 0;
		if ( snapshot !== null ) {
			console.info( '[WorldLockSnapshotInitialized]', {
				reason: args.reason,
				timestamp: snapshot.timestamp,
				placedModelWorldPosition: vector3ToObject( snapshot.placedModelWorldPosition ),
				arModelAnchorWorldPosition: vector3ToObject( snapshot.arModelAnchorWorldPosition ),
				arPlacementAnchorWorldPosition: vector3ToObject( snapshot.arPlacementAnchorWorldPosition ),
				cameraWorldPosition: vector3ToObject( snapshot.cameraWorldPosition ),
				cameraToModelDistance: snapshot.cameraToModelDistance,
				engineeringMatrix: snapshot.engineeringMatrix?.toArray() ?? null,
				visualMatrix: snapshot.visualMatrix?.toArray() ?? null,
				arFromEnuMatrix: snapshot.arFromEnuMatrix?.toArray() ?? null
			} );
		}

	}

	function updateWorldLockSnapshot(reason: string): void {

		if ( worldLockInitialSnapshot === null ) {
			return;
		}

		const snapshot = captureWorldLockSnapshot();
		if ( snapshot === null ) {
			return;
		}

		worldLockCurrentSnapshot = snapshot;
		worldLockUpdateCount += 1;
		lastWorldLockUpdateReason = reason;
		lastWorldLockUpdateTimestamp = snapshot.timestamp;
		worldLockUpdatedInFrameLoop = reason === 'xr-frame';
		console.info( '[WorldLockSnapshotUpdated]', {
			reason,
			updateCount: worldLockUpdateCount,
			timestamp: snapshot.timestamp,
			placedModelWorldPosition: vector3ToObject( snapshot.placedModelWorldPosition ),
			arModelAnchorWorldPosition: vector3ToObject( snapshot.arModelAnchorWorldPosition ),
			arPlacementAnchorWorldPosition: vector3ToObject( snapshot.arPlacementAnchorWorldPosition ),
			cameraWorldPosition: vector3ToObject( snapshot.cameraWorldPosition ),
			cameraToModelDistance: snapshot.cameraToModelDistance
		} );

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
		resetArPlacementAnchorTransform( 'placement-base' );
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
			resetArPlacementAnchorTransform( 'engineering-place-button' );
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

			const engineeringMatrix = composeModelRawLocalToArMatrix( {
				arFromEnuSolution,
				registrationSolution
			} );
			const visualMatrix = engineeringMatrix.clone();
			const buriedDepth = resolveBuriedDepthMeters( {
				undergroundDisplay: registrationSolution.undergroundDisplay,
				modelTemplate
			} );
			const visualOffsetMeters = registrationSolution.visualPlacementMode === 'underground'
				? - buriedDepth.depthMeters + registrationSolution.visualGroundOffsetMeters
				: registrationSolution.visualGroundOffsetMeters;
			if ( visualOffsetMeters !== 0 ) {
				visualMatrix.premultiply( visualOffsetMatrix.makeTranslation( 0, visualOffsetMeters, 0 ) );
			}
			resetArPlacementAnchorTransform( 'engineering-place-button' );
			arPlacementBase = null;
			arPlacedModel = placeModelWithMatrix(
				modelTemplate,
				arPlacedModel,
				sceneBundle.arModelAnchor,
				visualMatrix
			);
			initializeWorldLockSnapshot( {
				engineeringMatrix,
				visualMatrix,
				arFromEnuMatrix: arFromEnuSolution.matrix,
				reason: 'engineering-place-button'
			} );
			logUndergroundPlacementDiagnostic( {
				registrationSolution,
				arFromEnuSolution,
				engineeringMatrix,
				visualMatrix,
				visualOffsetMeters,
				buriedDepth
			} );
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
				engineeringMatrix: engineeringMatrix.toArray(),
				visualMatrix: visualMatrix.toArray(),
				modelRawLocalToArMatrix: visualMatrix.toArray(),
				visualPlacementMode: registrationSolution.visualPlacementMode,
				undergroundDefaultMode: registrationSolution.undergroundDisplay?.defaultMode ?? null,
		buriedDepthMeters: registrationSolution.undergroundDisplay?.buriedDepthMeters ?? null,
		buriedDepthSource: buriedDepth.source,
		modelHeight: buriedDepth.modelHeight ?? null,
		modelHeightAxis: buriedDepth.modelHeightAxis ?? null,
		modelHeightX: buriedDepth.modelHeightX ?? null,
		modelHeightY: buriedDepth.modelHeightY ?? null,
		modelHeightZ: buriedDepth.modelHeightZ ?? null,
		chosenModelHeight: buriedDepth.chosenModelHeight ?? null,
		depthMeters: buriedDepth.depthMeters,
				visualGroundOffsetMeters: registrationSolution.visualGroundOffsetMeters,
				visualYOffsetMeters: visualOffsetMeters,
				warning: buriedDepth.warning ?? null,
				createdAt: Date.now()
			} );
			setStatus( '模型已按工程矩阵显示，未使用 hit-test 决定最终位置。' );
			autoPlacementPending = false;
			return true;

		},

		updateArPlacementAnchor(frame) {

			void frame;

		},

		verifyWorldLockedPlacement(caller) {

			if (
				sceneBundle.renderer.xr.isPresenting === false
				|| arPlacedModel === null
				|| worldLockInitialSnapshot === null
			) {
				return;
			}

			const now = Date.now();
			if ( now - lastWorldLockVerificationAt < 1000 ) {
				return;
			}
			lastWorldLockVerificationAt = now;
			updateWorldLockSnapshot( caller );

		},

		getWorldLockDiagnostics() {

			return {
				initialSnapshot: worldLockInitialSnapshot,
				currentSnapshot: worldLockCurrentSnapshot,
				updateCount: worldLockUpdateCount,
				lastUpdateReason: lastWorldLockUpdateReason,
				lastUpdateTimestamp: lastWorldLockUpdateTimestamp,
				updatedInFrameLoop: worldLockUpdatedInFrameLoop,
				placementAnchorUpdateCount,
				lastPlacementAnchorUpdateReason,
				lastPlacementAnchorUpdateTimestamp,
				placementAnchorUpdatedFromFrameLoop: false,
				placementAnchorUpdatedFromHitTest: false,
				placementAnchorUpdatedFromReticle: false
			};

		}
	};

}

function requiresCurrentSession(source: ArFromEnuSolution['source'] | undefined): boolean {

	return source === 'marker';

}

export function resolveBuriedDepthMeters(args: {
	undergroundDisplay: EngineeringRegistrationSolution['undergroundDisplay'];
	modelTemplate: THREE.Group;
}): {
	depthMeters: number;
	source: 'model-height' | 'configured-number' | 'none';
	modelHeight?: number;
	modelHeightAxis?: 'y' | 'shortest-edge' | 'bbox-y';
	modelHeightX?: number;
	modelHeightY?: number;
	modelHeightZ?: number;
	chosenModelHeight?: number;
	warning?: string;
} {

	const buriedDepthMeters = args.undergroundDisplay?.buriedDepthMeters;
	if ( buriedDepthMeters === 'model-height' ) {
		const modelHeight = resolveTemplateHeightMeters(
			args.modelTemplate,
			args.undergroundDisplay?.modelHeightAxis ?? 'y'
		);
		if ( Number.isFinite( modelHeight.chosenModelHeight ) === false || modelHeight.chosenModelHeight < 0 ) {
			return {
				depthMeters: 0,
				source: 'model-height',
				modelHeightAxis: modelHeight.axis,
				modelHeightX: modelHeight.x,
				modelHeightY: modelHeight.y,
				modelHeightZ: modelHeight.z,
				warning: 'model bbox height is invalid; underground depth fell back to 0'
			};
		}

		return {
			depthMeters: modelHeight.chosenModelHeight,
			source: 'model-height',
			modelHeight: modelHeight.chosenModelHeight,
			modelHeightAxis: modelHeight.axis,
			modelHeightX: modelHeight.x,
			modelHeightY: modelHeight.y,
			modelHeightZ: modelHeight.z,
			chosenModelHeight: modelHeight.chosenModelHeight
		};
	}

	if ( buriedDepthMeters !== undefined ) {
		if ( typeof buriedDepthMeters === 'number' && Number.isFinite( buriedDepthMeters ) && buriedDepthMeters >= 0 ) {
			return {
				depthMeters: buriedDepthMeters,
				source: 'configured-number'
			};
		}

		return {
			depthMeters: 0,
			source: 'configured-number',
			warning: 'configured buriedDepthMeters is invalid; underground depth fell back to 0'
		};
	}

	return {
		depthMeters: 0,
		source: 'none'
	};

}

function resolveTemplateHeightMeters(
	modelTemplate: THREE.Group,
	axis: 'y' | 'shortest-edge' | 'bbox-y'
): {
	axis: 'y' | 'shortest-edge' | 'bbox-y';
	x: number;
	y: number;
	z: number;
	chosenModelHeight: number;
} {

	const report = readPlaceableTemplateReport( modelTemplate );
	if ( report !== null ) {
		const x = report.finalSize.x;
		const y = report.finalSize.y;
		const z = report.finalSize.z;
		return {
			axis,
			x,
			y,
			z,
			chosenModelHeight: axis === 'shortest-edge'
				? Math.min( x, y, z )
				: axis === 'bbox-y'
					? new THREE.Box3().setFromObject( modelTemplate ).getSize( new THREE.Vector3() ).y
					: y
		};
	}

	const bounds = new THREE.Box3().setFromObject( modelTemplate );
	const size = bounds.getSize( new THREE.Vector3() );
	if ( bounds.isEmpty() ) {
		return {
			axis,
			x: Number.NaN,
			y: Number.NaN,
			z: Number.NaN,
			chosenModelHeight: Number.NaN
		};
	}
	return {
		axis,
		x: size.x,
		y: size.y,
		z: size.z,
		chosenModelHeight: axis === 'shortest-edge' ? Math.min( size.x, size.y, size.z ) : size.y
	};

}

function logUndergroundPlacementDiagnostic(args: {
	registrationSolution: EngineeringRegistrationSolution;
	arFromEnuSolution: ArFromEnuSolution;
	engineeringMatrix: THREE.Matrix4;
	visualMatrix: THREE.Matrix4;
	visualOffsetMeters: number;
	buriedDepth: ReturnType<typeof resolveBuriedDepthMeters>;
}): void {

	const {
		registrationSolution,
		arFromEnuSolution,
		engineeringMatrix,
		visualMatrix,
		visualOffsetMeters,
		buriedDepth
	} = args;
	const engineeringHorizontalErrors: number[] = [];
	const engineeringVerticalErrors: number[] = [];
	const visualHorizontalErrors: number[] = [];
	const visualVerticalErrors: number[] = [];
	const points = registrationSolution.controlPoints.slice( 0, 4 ).map( ( point ) => {
		const expectedAr = point.worldEnu.clone().applyMatrix4( arFromEnuSolution.matrix );
		const engineeringActualAr = point.modelLocal.clone().applyMatrix4( engineeringMatrix );
		const visualActualAr = point.modelLocal.clone().applyMatrix4( visualMatrix );
		const horizontalErrorXZEngineering = horizontalErrorXZ( expectedAr, engineeringActualAr );
		const verticalErrorYEngineering = Math.abs( expectedAr.y - engineeringActualAr.y );
		const horizontalErrorXZVisual = horizontalErrorXZ( expectedAr, visualActualAr );
		const verticalErrorYVisual = Math.abs( expectedAr.y - visualActualAr.y );
		engineeringHorizontalErrors.push( horizontalErrorXZEngineering );
		engineeringVerticalErrors.push( verticalErrorYEngineering );
		visualHorizontalErrors.push( horizontalErrorXZVisual );
		visualVerticalErrors.push( verticalErrorYVisual );
		return {
			controlPointId: point.id,
			expectedAr: vector3ToObject( expectedAr ),
			engineeringActualAr: vector3ToObject( engineeringActualAr ),
			visualActualAr: vector3ToObject( visualActualAr ),
			horizontalErrorXZEngineering: Number( horizontalErrorXZEngineering.toFixed( 6 ) ),
			verticalErrorYEngineering: Number( verticalErrorYEngineering.toFixed( 6 ) ),
			horizontalErrorXZVisual: Number( horizontalErrorXZVisual.toFixed( 6 ) ),
			verticalErrorYVisual: Number( verticalErrorYVisual.toFixed( 6 ) )
		};
	} );

	console.info( '[UndergroundPlacementDiagnostic]', {
		modelId: registrationSolution.modelId,
		visualPlacementMode: registrationSolution.visualPlacementMode,
		defaultMode: registrationSolution.undergroundDisplay?.defaultMode ?? null,
		buriedDepthMeters: registrationSolution.undergroundDisplay?.buriedDepthMeters ?? null,
		buriedDepthSource: buriedDepth.source,
		modelHeight: buriedDepth.modelHeight ?? null,
		depthMeters: Number( buriedDepth.depthMeters.toFixed( 6 ) ),
		visualGroundOffsetMeters: Number( registrationSolution.visualGroundOffsetMeters.toFixed( 6 ) ),
		visualOffsetY: Number( visualOffsetMeters.toFixed( 6 ) ),
		engineeringMatrix: engineeringMatrix.toArray(),
		visualMatrix: visualMatrix.toArray(),
		engineeringHorizontalRms: Number( computeRms( engineeringHorizontalErrors ).toFixed( 6 ) ),
		engineeringVerticalMax: Number( Math.max( ...engineeringVerticalErrors, 0 ).toFixed( 6 ) ),
		visualHorizontalRms: Number( computeRms( visualHorizontalErrors ).toFixed( 6 ) ),
		visualVerticalMax: Number( Math.max( ...visualVerticalErrors, 0 ).toFixed( 6 ) ),
		warning: buriedDepth.warning ?? null,
		points,
		note: 'engineeringMatrix checks registration closure; visualMatrix includes display-only Y offset'
	} );

}

function horizontalErrorXZ(a: THREE.Vector3, b: THREE.Vector3): number {

	return Math.hypot( a.x - b.x, a.z - b.z );

}

function computeRms(values: number[]): number {

	if ( values.length === 0 ) {
		return 0;
	}
	return Math.sqrt( values.reduce( ( sum, value ) => sum + value * value, 0 ) / values.length );

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

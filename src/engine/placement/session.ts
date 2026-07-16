import * as THREE from 'three';
import type { ARSceneBundle, XrTrackingStatus } from '@/features/ar/types/runtime-types.js';
import { clearPlacedModel } from '@/engine/core/model.js';
import type { ArFromEnuSolution } from '@/localization/core/ar-from-enu-solution.js';
import type { EngineeringRegistrationSolution } from '@/localization/coarse/engineering-registration.js';
import { createDefaultTargetGuidanceState } from '@/localization/core/registration-store.js';
import { createPlacementSummaryState } from '@/engine/session/view-state.js';
import { composeModelRawLocalToArMatrix } from './runtime.js';
import {
	correctUpsideDownModelMatrix,
	ModelTransformRuntime,
	type ModelPlacementPhase,
	type ModelTransformAuditEntry,
	type ModelTransformCommitReason,
	type ModelTransformGuardOptions
} from './model-transform-runtime.js';
import type { PropertySelectionController } from '@/engine/interaction/property-selection.js';

export type ModelLifecycleReason =
	| 'explicit-reset'
	| 'model-changed'
	| 'session-start'
	| 'session-ended'
	| 'disposed';

export type ModelVisibilityReason =
	| 'model-not-ready'
	| 'session-active'
	| 'session-ended'
	| 'explicit-user-hide'
	| 'project-capability';

export interface ModelLifecycleAuditEntry {
	event: 'created' | 'removed';
	reason: ModelTransformCommitReason | ModelLifecycleReason;
	timestamp: number;
	modelUuid: string;
}

export interface ModelVisibilityState {
	visible: boolean;
	reason: ModelVisibilityReason;
	timestamp: number;
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
	transformGuard?: Partial<ModelTransformGuardOptions>;
	setStatus(message: string): void;
	updateRegistrationStatusDetail(message: string): void;
}

export interface PlacementSession {
	getPlacedModel(): THREE.Group | null;
	getArPlacedModel(): THREE.Group | null;
	getPlacementPhase(): ModelPlacementPhase;
	getCommittedModelMatrix(target?: THREE.Matrix4): THREE.Matrix4 | null;
	getTransformAudit(): readonly ModelTransformAuditEntry[];
	getLastLifecycleEvent(): ModelLifecycleAuditEntry | null;
	getVisibilityState(): ModelVisibilityState;
	setTrackingStatus(status: XrTrackingStatus): void;
	setCommittedModelVisible(visible: boolean, reason: ModelVisibilityReason): void;
	resetPlacement(reason?: ModelLifecycleReason): void;
	dispose(): void;
	placeEngineeringModelFromCurrentArFromEnu(args: {
		modelTemplate: THREE.Group | null;
		registrationSolution: EngineeringRegistrationSolution | null;
		arFromEnuSolution: ArFromEnuSolution | null;
		currentSessionId?: string | null;
		reason: ModelTransformCommitReason;
		source: string;
	}): boolean;
}

export function createPlacementSession(options: CreatePlacementSessionOptions): PlacementSession {

	const {
		store,
		sceneBundle,
		propertySelection,
		setStatus,
		updateRegistrationStatusDetail
	} = options;
	const transformRuntime = new ModelTransformRuntime( options.transformGuard );
	let arPlacedModel: THREE.Group | null = null;
	let lastLifecycleEvent: ModelLifecycleAuditEntry | null = null;
	let visibilityState: ModelVisibilityState = {
		visible: false,
		reason: 'model-not-ready',
		timestamp: Date.now()
	};

	function applyCommittedModelVisibility(visible: boolean, reason: ModelVisibilityReason): void {

		if ( sceneBundle.arModelAnchor.visible !== visible ) sceneBundle.arModelAnchor.visible = visible;
		if ( visibilityState.visible !== visible || visibilityState.reason !== reason ) {
			visibilityState = { visible, reason, timestamp: Date.now() };
		}

	}

	applyCommittedModelVisibility( false, 'model-not-ready' );

	function updatePlacementSummary(): void {

		store.patch( { placementSummary: createPlacementSummaryState( arPlacedModel ) } );

	}

	return {
		getPlacedModel() {

			return arPlacedModel;

		},

		getArPlacedModel() {

			return arPlacedModel;

		},

		getPlacementPhase() {

			return transformRuntime.getPhase();

		},

		getCommittedModelMatrix(target) {

			return transformRuntime.getCommittedModelMatrix( target );

		},

		getTransformAudit() {

			return transformRuntime.getAudit();

		},

		getLastLifecycleEvent() {

			return lastLifecycleEvent === null ? null : { ...lastLifecycleEvent };

		},

		getVisibilityState() {

			return { ...visibilityState };

		},

		setTrackingStatus(status) {

			transformRuntime.setTrackingStatus( status );

		},

		setCommittedModelVisible(visible, reason) {

			applyCommittedModelVisibility( visible, reason );

		},

		resetPlacement(reason = 'explicit-reset') {

			if ( arPlacedModel !== null ) {
				lastLifecycleEvent = {
					event: 'removed',
					reason,
					timestamp: Date.now(),
					modelUuid: arPlacedModel.uuid
				};
			}
			arPlacedModel = clearPlacedModel( sceneBundle.arModelAnchor, arPlacedModel );
			transformRuntime.reset();
			propertySelection.clearSelection();
			updatePlacementSummary();
			store.patch( { targetGuidance: createDefaultTargetGuidanceState() } );

		},

		dispose() {

			this.resetPlacement( 'disposed' );
			transformRuntime.dispose();

		},

		placeEngineeringModelFromCurrentArFromEnu(args) {

			const {
				modelTemplate,
				registrationSolution,
				arFromEnuSolution,
				currentSessionId,
				reason,
				source
			} = args;

			if ( modelTemplate === null || registrationSolution === null || arFromEnuSolution === null ) {
				return false;
			}

			if (
				requiresCurrentSession( arFromEnuSolution.source )
				&& currentSessionId !== undefined
				&& arFromEnuSolution.sessionId !== currentSessionId
			) {
				return false;
			}

			const engineeringMatrix = correctUpsideDownModelMatrix(
				composeModelRawLocalToArMatrix( {
					arFromEnuSolution,
					registrationSolution
				} )
			);
			const wasCreated = arPlacedModel === null;
			arPlacedModel = transformRuntime.commitModelTransform( {
				modelTemplate,
				currentModel: arPlacedModel,
				parent: sceneBundle.arModelAnchor,
				commit: {
					matrix: engineeringMatrix,
					reason,
					source,
					confirmed: true
				}
			} );
			if ( wasCreated ) {
				lastLifecycleEvent = {
					event: 'created',
					reason,
					timestamp: Date.now(),
					modelUuid: arPlacedModel.uuid
				};
			}
			applyModelInstanceUserData( arPlacedModel, {
				id: registrationSolution.modelId,
				name: registrationSolution.modelId,
				role: 'primary'
			} );
			updateRegistrationStatusDetail( '状态：模型已按工程矩阵显示' );
			updatePlacementSummary();
			setStatus( '模型已按工程矩阵显示，hit-test 仅继续更新准星。' );
			return true;

		}
	};

}

function requiresCurrentSession(source: ArFromEnuSolution['source'] | undefined): boolean {

	return source === 'marker';

}

function applyModelInstanceUserData(
	root: THREE.Object3D,
	instance: {
		id: string;
		name: string;
		role: string;
	}
): void {

	root.userData.modelInstanceId = instance.id;
	root.userData.modelInstanceName = instance.name;
	root.userData.modelRole = instance.role;

}

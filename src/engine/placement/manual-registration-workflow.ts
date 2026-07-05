import * as THREE from 'three';
import type { ArWorkflowMode } from '@/features/ar/types/workflow.js';
import type { EngineeringRegistrationSolution } from '@/localization/coarse/engineering-registration.js';
import type { ManualPlacementBase, ManualRegistrationState, ManualTranslationAxis } from '@/localization/manual/manual-registration.js';
import type { PlacementSession } from './session.js';

interface ManualRegistrationControllerLike {
	setState(
		nextState: ManualRegistrationState,
		options?: { silent?: boolean; statusMessage?: string }
	): ManualRegistrationState;
	reset(): ManualRegistrationState;
	applyToPlacement(
		base: ManualPlacementBase,
		targetPosition: THREE.Vector3,
		targetOrientation: THREE.Quaternion
	): { position: THREE.Vector3; orientation: THREE.Quaternion; scale: number };
}

interface ManualRegistrationWorkflowOptions {
	placementSession: PlacementSession;
	manualRegistration: ManualRegistrationControllerLike;
	getWorkflowMode(): ArWorkflowMode;
	getCurrentSessionId(): string | null;
	getSiteId(): string | null;
	getModelTemplate(): THREE.Group | null;
	getRegistrationSolution(): EngineeringRegistrationSolution | null;
	getManualPositionTarget(): THREE.Vector3;
	getManualOrientationTarget(): THREE.Quaternion;
	isPresenting(): boolean;
	setStatus(message: string): void;
	syncRegistrationChainDebug(): void;
	applyModelLayerVisibility(): void;
	syncArSessionPhase(): void;
	syncSceneHost(): void;
	emit(): void;
	markPlacementCommitted(committed?: boolean): void;
}

export class ManualRegistrationWorkflow {

	constructor(private readonly options: ManualRegistrationWorkflowOptions) {}

	resetRuntimeState(): void {

		this.options.manualRegistration.setState( createDefaultManualRegistrationState(), { silent: true } );
		this.options.syncRegistrationChainDebug();

	}

	loadManualRegistration(_modelId: string): void {

		console.info( '[CrossSessionTransformSaveBlocked]', {
			mode: this.options.getWorkflowMode(),
			siteId: this.options.getSiteId(),
			sessionId: this.options.getCurrentSessionId(),
			reason: 'legacy manual transform restore disabled',
			createdAt: Date.now()
		} );
		this.resetRuntimeState();

	}

	syncForHeading(_headingDeg: number): void {

		// Manual transform-derived localization has been removed from the formal flow.

	}

	refreshActiveSitePose(): void {

		// The current model transform is not converted back into a localization solution.

	}

	clearActiveSitePose(): void {

		this.options.syncRegistrationChainDebug();

	}

	canUseManualRegistration(): boolean {

		return false;

	}

	hasActiveSitePose(): boolean {

		return false;

	}

	getActiveSitePose(): null {

		return null;

	}

	hasRestoredSitePose(): boolean {

		return false;

	}

	adjustTranslation(_axis: ManualTranslationAxis, _direction: 1 | -1): void {

		this.rejectManualAlignment();

	}

	adjustYaw(_direction: 1 | -1): void {

		this.rejectManualAlignment();

	}

	adjustScale(_direction: 1 | -1): void {

		this.rejectManualAlignment();

	}

	saveCurrentRegistration(): void {

		this.rejectManualAlignment();

	}

	resetManualRegistration(): void {

		this.options.manualRegistration.reset();
		this.options.syncRegistrationChainDebug();

	}

	clearSavedRegistration(): boolean {

		this.options.manualRegistration.reset();
		this.options.syncRegistrationChainDebug();
		return true;

	}

	reapplyPlacement(): void {

		this.options.syncArSessionPhase();
		this.options.syncSceneHost();
		this.options.emit();

	}

	private rejectManualAlignment(): void {

		console.warn( '[ManualAlignmentSaveRejectedBecauseSessionTransform]', {
			mode: this.options.getWorkflowMode(),
			siteId: this.options.getSiteId(),
			sessionId: this.options.getCurrentSessionId(),
			reason: 'manual transform adjustment is not a formal engineering localization source',
			createdAt: Date.now()
		} );
		this.options.setStatus( '手动模型姿态调整已从正式配准流程移除，请使用 Marker 四角点校正。' );

	}

}

function createDefaultManualRegistrationState(): ManualRegistrationState {

	return {
		offset: new THREE.Vector3(),
		yawDeg: 0,
		scaleMultiplier: 1
	};

}

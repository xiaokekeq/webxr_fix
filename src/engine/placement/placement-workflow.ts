import * as THREE from 'three';
import type { XRHitTestController } from '@/features/ar/types/runtime-types.js';
import type { ArWorkflowMode } from '@/features/ar/types/workflow.js';
import type { ArFromEnuSolution } from '@/localization/core/ar-from-enu-solution.js';
import type { EngineeringRegistrationSolution } from '@/localization/coarse/engineering-registration.js';
import type { ManualPlacementBase } from '@/localization/manual/manual-registration.js';
import type { PlacementSession } from './session.js';

interface PlacementWorkflowOptions {
	placementSession: PlacementSession;
	getWorkflowMode(): ArWorkflowMode;
	getSiteId(): string | null;
	getCurrentSessionId(): string | null;
	getInspectionTargetId(): string | null;
	getInspectionStableFrameCount(): number;
	getPreferredLocalizationOverride(): ArFromEnuSolution | null;
	getModelTemplate(): THREE.Group | null;
	getRegistrationSolution(): EngineeringRegistrationSolution | null;
	getHitTestController(): XRHitTestController;
	getManualApplyToPlacement(): (
		base: ManualPlacementBase,
		targetPosition: THREE.Vector3,
		targetOrientation: THREE.Quaternion
	) => { position: THREE.Vector3; orientation: THREE.Quaternion; scale: number };
	getManualPositionTarget(): THREE.Vector3;
	getManualOrientationTarget(): THREE.Quaternion;
	getModelOrientationTarget(): THREE.Quaternion;
	getCameraWorldPositionTarget(): THREE.Vector3;
	onBeforePlacementRequest(): void;
	onPlacementBaseResolved(headingDeg: number): void;
	refreshActiveManualRegistrationSitePose(): void;
	applyModelLayerVisibility(): void;
	syncRegistrationChainDebug(): void;
	syncArSessionPhase(): void;
	emit(): void;
	setStatus(message: string): void;
	onPlacementCompleted(): void;
}

export class PlacementWorkflow {

	constructor(private readonly options: PlacementWorkflowOptions) {}

	async placeLocalizedModel(): Promise<void> {

		if ( this.options.getModelTemplate() === null || this.options.getRegistrationSolution() === null ) {
			this.options.setStatus( '模型资源尚未准备完成。' );
			return;
		}

		if ( this.options.getHitTestController().hasGroundHit() === false ) {
			this.options.setStatus( '请先扫描地面或墙面，再开始放置。' );
			return;
		}

		const localizationOverride = this.options.getPreferredLocalizationOverride();
		if ( localizationOverride === null ) {
			console.info( '[FormalLocalizationRequired]', {
				mode: this.options.getWorkflowMode(),
				siteId: this.options.getSiteId(),
				sessionId: this.options.getCurrentSessionId(),
				reason: 'formal placement requires marker/manual/rtk localization',
				createdAt: Date.now()
			} );
			this.options.setStatus( '请先完成 Marker 自动识别或手动四角点校正，再应用正式放置。' );
			return;
		}

		this.options.onBeforePlacementRequest();
		this.requestAutoPlacement();
		this.options.syncArSessionPhase();

		if ( this.options.placementSession.getPlacedModel() === null ) {
			if ( this.options.placementSession.getAutoPlacementPending() ) {
				this.options.setStatus( '正在应用当前会话定位结果...' );
				return;
			}

			this.options.setStatus( '已识别平面，但本次放置未完成，请重试。' );
		}

	}

	requestAutoPlacement(): void {

		this.options.placementSession.requestAutoPlacement( this.options.getModelTemplate() );
		if ( this.options.getWorkflowMode() === 'ar-inspection' ) {
			const localizationOverride = this.options.getPreferredLocalizationOverride();
			console.info( '[ArInspectionAutoPlacementRequested]', {
				mode: this.options.getWorkflowMode(),
				siteId: this.options.getSiteId(),
				sessionId: this.options.getCurrentSessionId(),
				targetId: this.options.getInspectionTargetId(),
				source: localizationOverride?.source ?? 'fallback',
				trackingState: 'placement-requested',
				stableFrameCount: this.options.getInspectionStableFrameCount(),
				hasHitTest: this.options.getHitTestController().hasGroundHit(),
				createdAt: Date.now()
			} );
			console.info( '[LocalizationPriorityResolved]', {
				mode: this.options.getWorkflowMode(),
				siteId: this.options.getSiteId(),
				sessionId: this.options.getCurrentSessionId(),
				source: localizationOverride?.source ?? 'fallback',
				createdAt: Date.now()
			} );
		}
		this.attemptAutoPlacement();

	}

	attemptAutoPlacement(): void {

		const hadPlacedModel = this.options.placementSession.getPlacedModel() !== null;
		const localizationOverride = this.options.getPreferredLocalizationOverride();
		if ( localizationOverride === null ) {
			console.info( '[FormalLocalizationRequired]', {
				mode: this.options.getWorkflowMode(),
				siteId: this.options.getSiteId(),
				sessionId: this.options.getCurrentSessionId(),
				reason: 'no formal localization override available',
				createdAt: Date.now()
			} );
			return;
		}

		this.options.placementSession.attemptLocalizedPlacement( {
			xrHitTest: this.options.getHitTestController(),
			modelTemplate: this.options.getModelTemplate(),
			registrationSolution: this.options.getRegistrationSolution(),
			arFromEnuSolutionOverride: localizationOverride,
			manualApplyToPlacement: this.options.getManualApplyToPlacement(),
			manualPositionTarget: this.options.getManualPositionTarget(),
			manualOrientationTarget: this.options.getManualOrientationTarget(),
			modelOrientationTarget: this.options.getModelOrientationTarget(),
			cameraWorldPosition: this.options.getCameraWorldPositionTarget(),
			onPlacementBaseResolved: ( base ) => {
				this.options.onPlacementBaseResolved( base.siteContext?.headingDeg ?? 0 );
			}
		} );
		this.options.refreshActiveManualRegistrationSitePose();
		this.options.applyModelLayerVisibility();
		this.options.syncRegistrationChainDebug();

		const placedModel = this.options.placementSession.getPlacedModel();
		if ( hadPlacedModel === false && placedModel !== null ) {
			this.options.onPlacementCompleted();
		}

		this.options.syncArSessionPhase();
		this.options.emit();

	}

}

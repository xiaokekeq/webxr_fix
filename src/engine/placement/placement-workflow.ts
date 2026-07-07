import * as THREE from 'three';
import type { XRHitTestController } from '@/features/ar/types/runtime-types.js';
import type { ArWorkflowMode } from '@/features/ar/types/workflow.js';
import type { ArFromEnuSolution } from '@/localization/core/ar-from-enu-solution.js';
import type { EngineeringRegistrationSolution } from '@/localization/coarse/engineering-registration.js';
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
	getModelOrientationTarget(): THREE.Quaternion;
	onBeforePlacementRequest(): void;
	onPlacementBaseResolved(headingDeg: number): void;
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

		if ( this.options.getPreferredLocalizationOverride() === null ) {
			console.info( '[FormalLocalizationRequired]', {
				mode: this.options.getWorkflowMode(),
				siteId: this.options.getSiteId(),
				sessionId: this.options.getCurrentSessionId(),
				reason: 'engineering placement requires marker ENU-to-AR localization',
				hasHitTest: this.options.getHitTestController().hasGroundHit(),
				createdAt: Date.now()
			} );
			this.options.setStatus( '请先完成 Marker 四角点校正后再进行工程放置。' );
			return;
		}

		this.options.onBeforePlacementRequest();
		this.requestAutoPlacement();
		this.options.syncArSessionPhase();

		if ( this.options.placementSession.getPlacedModel() === null ) {
			this.options.setStatus(
				this.options.placementSession.getAutoPlacementPending()
					? '正在按 Marker 校正结果放置模型...'
					: '工程放置未完成，请重试。'
			);
		}

	}

	requestAutoPlacement(): void {

		this.options.placementSession.requestAutoPlacement( this.options.getModelTemplate() );
		if ( this.options.getWorkflowMode() === 'ar-inspection' ) {
			const localizationOverride = this.options.getPreferredLocalizationOverride();
			console.info( '[ArInspectionEngineeringPlacementRequested]', {
				mode: this.options.getWorkflowMode(),
				siteId: this.options.getSiteId(),
				sessionId: this.options.getCurrentSessionId(),
				targetId: this.options.getInspectionTargetId(),
				source: localizationOverride?.source ?? 'missing',
				stableFrameCount: this.options.getInspectionStableFrameCount(),
				hasHitTest: this.options.getHitTestController().hasGroundHit(),
				usesHitTestForFinalPose: false,
				createdAt: Date.now()
			} );
		}
		this.attemptAutoPlacement();

	}

	attemptAutoPlacement(): void {

		const hadPlacedModel = this.options.placementSession.getPlacedModel() !== null;
		const localizationOverride = this.options.getPreferredLocalizationOverride();
		if ( localizationOverride === null ) {
			if ( this.options.getHitTestController().hasGroundHit() ) {
				console.warn( '[HitTestReadyButLocalizationMissing]', this.createPlacementLogPayload( {
					source: 'unknown',
					localizationReady: false
				} ) );
			}
			console.info( '[FormalLocalizationRequired]', {
				mode: this.options.getWorkflowMode(),
				siteId: this.options.getSiteId(),
				sessionId: this.options.getCurrentSessionId(),
				reason: 'no marker ENU-to-AR transform available',
				createdAt: Date.now()
			} );
			return;
		}

		console.info( '[EngineeringPlacementTriggered]', this.createPlacementLogPayload( {
			source: localizationOverride.source,
			localizationReady: true
		} ) );

		this.options.placementSession.attemptLocalizedPlacement( {
			modelTemplate: this.options.getModelTemplate(),
			registrationSolution: this.options.getRegistrationSolution(),
			arFromEnuSolutionOverride: localizationOverride,
			modelOrientationTarget: this.options.getModelOrientationTarget(),
			onPlacementBaseResolved: ( base ) => {
				this.options.onPlacementBaseResolved( base.siteContext?.headingDeg ?? 0 );
			}
		} );
		this.options.applyModelLayerVisibility();
		this.options.syncRegistrationChainDebug();

		const placedModel = this.options.placementSession.getPlacedModel();
		if ( hadPlacedModel === false && placedModel !== null ) {
			console.info( '[EngineeringModelPlaced]', this.createPlacementLogPayload( {
				source: localizationOverride.source,
				localizationReady: true
			} ) );
			this.options.onPlacementCompleted();
		}

		this.options.syncArSessionPhase();
		this.options.emit();

	}

	private createPlacementLogPayload(args: {
		source: string;
		localizationReady: boolean;
	}): Record<string, unknown> {

		return {
			mode: 'marker-corners-4',
			workflowMode: this.options.getWorkflowMode(),
			siteId: this.options.getSiteId(),
			modelId: this.options.getSiteId(),
			sessionId: this.options.getCurrentSessionId(),
			targetId: this.options.getInspectionTargetId(),
			source: args.source,
			hasSiteOrigin: this.options.getRegistrationSolution() !== null,
			hasModelLocalToEnu: this.options.getRegistrationSolution() !== null,
			modelLocalToEnuSource: this.options.getRegistrationSolution() === null ? 'missing' : 'control-points',
			hitTestReady: this.options.getHitTestController().hasGroundHit(),
			usesHitTestForFinalPose: false,
			localizationReady: args.localizationReady,
			modelPlaced: this.options.placementSession.getPlacedModel() !== null,
			createdAt: Date.now()
		};

	}

}

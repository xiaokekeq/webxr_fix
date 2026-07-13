import * as THREE from 'three';
import type { XRHitTestController } from '@/features/ar/types/runtime-types.js';
import type { ArWorkflowMode } from '@/features/ar/types/workflow.js';
import type { ArFromEnuSolution } from '@/localization/core/ar-from-enu-solution.js';
import type { EngineeringRegistrationSolution } from '@/localization/coarse/engineering-registration.js';
import type { ModelRuntimeLoadStatus } from '@/localization/core/registration-store.js';
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
	getRuntimeLoadStatus(): ModelRuntimeLoadStatus;
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

		const modelTemplate = this.options.getModelTemplate();
		const registrationSolution = this.options.getRegistrationSolution();
		const localization = this.options.getPreferredLocalizationOverride();
		if ( modelTemplate === null || registrationSolution === null || localization === null ) {
			const runtime = this.options.getRuntimeLoadStatus();
			console.warn( '[EngineeringPlacementBlocked]', {
				hasModelTemplate: modelTemplate !== null,
				hasRegistrationSolution: registrationSolution !== null,
				hasLocalization: localization !== null,
				runtimeState: runtime.modelRuntimeLoadState,
				runtimeStage: runtime.modelRuntimeLoadStage,
				runtimeFailureReason: runtime.modelRuntimeLoadFailureReason
			} );
			this.options.setStatus(
				modelTemplate === null
					? '模型模板尚未加载完成。'
					: registrationSolution === null
						? '模型工程配准解尚未建立。'
						: '请先完成 Marker 四角点校正。'
			);
			return;
		}

		this.options.onBeforePlacementRequest();
		const localizationOverride = localization;
		const hadPlacedModel = this.options.placementSession.getPlacedModel() !== null;
		console.info( '[EngineeringPlacementTriggered]', this.createPlacementLogPayload( {
			source: localizationOverride?.source ?? 'missing',
			localizationReady: localizationOverride !== null
		} ) );
		const placed = this.options.placementSession.placeEngineeringModelFromCurrentArFromEnu( {
			modelTemplate,
			registrationSolution,
			arFromEnuSolution: localizationOverride,
			currentSessionId: this.options.getCurrentSessionId()
		} );
		if ( placed ) {
			this.options.applyModelLayerVisibility();
			this.options.syncRegistrationChainDebug();
			if ( hadPlacedModel === false ) {
				console.info( '[EngineeringModelPlaced]', this.createPlacementLogPayload( {
					source: localizationOverride?.source ?? 'missing',
					localizationReady: localizationOverride !== null
				} ) );
				this.options.onPlacementCompleted();
			}
			this.options.syncArSessionPhase();
			this.options.emit();
			return;
		}
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

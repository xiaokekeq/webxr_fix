import { arWarn } from '@/engine/debug/ar-logger.js';
import * as THREE from 'three';
import type { XRHitTestController, XRWorldLockPreparation } from '@/features/ar/types/runtime-types.js';
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
	getPreferredLocalizationOverride(): ArFromEnuSolution | null;
	getModelTemplate(): THREE.Group | null;
	getRegistrationSolution(): EngineeringRegistrationSolution | null;
	getRuntimeLoadStatus(): ModelRuntimeLoadStatus;
	getHitTestController(): XRHitTestController;
	canPlaceOrCalibrate(): boolean;
	getInteractionBlockMessage(): string | null;
	prepareModelWorldLock(): Promise<XRWorldLockPreparation>;
	commitModelWorldLock(preparation: XRWorldLockPreparation): boolean;
	cancelModelWorldLock(preparation: XRWorldLockPreparation): void;
	onBeforePlacementRequest(): void;
	applyModelLayerVisibility(): void;
	syncRegistrationChainDebug(): void;
	syncLocalizationDebug(): void;
	syncArSessionPhase(): void;
	emit(): void;
	setStatus(message: string): void;
	onPlacementCompleted(): void;
}

export type PlacementWorkflowResult =
	| { status: 'placed'; worldLock: 'anchored' | 'unanchored' }
	| { status: 'already-placed' | 'blocked' | 'tracking-unavailable' | 'timeout' | 'failed' | 'cancelled' | 'placement-failed' };

export class PlacementWorkflow {
	private placementInFlight = false;

	constructor(private readonly options: PlacementWorkflowOptions) {}

	async placeLocalizedModel(): Promise<PlacementWorkflowResult> {

		if ( this.placementInFlight ) return { status: 'cancelled' };
		this.placementInFlight = true;
		try {
			return await this.placeLocalizedModelOnce();
		} finally {
			this.placementInFlight = false;
		}

	}

	private async placeLocalizedModelOnce(): Promise<PlacementWorkflowResult> {

		const modelTemplate = this.options.getModelTemplate();
		const registrationSolution = this.options.getRegistrationSolution();
		const localization = this.options.getPreferredLocalizationOverride();
		if ( modelTemplate === null || registrationSolution === null || localization === null ) {
			const runtime = this.options.getRuntimeLoadStatus();
			arWarn( '[EngineeringPlacementBlocked]', {
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
			return { status: 'blocked' };
		}
		if ( this.options.placementSession.getPlacedModel() !== null ) return { status: 'already-placed' };
		if ( this.options.canPlaceOrCalibrate() === false ) {
			this.options.setStatus( this.options.getInteractionBlockMessage() ?? '跟踪恢复中，请保持设备稳定。' );
			return { status: 'tracking-unavailable' };
		}

		const worldLock = await this.options.prepareModelWorldLock();
		if ( worldLock.status === 'timeout' ) {
			this.options.setStatus( '现实锚点创建超时，请保持稳定平面可见后重试。' );
			return { status: 'timeout' };
		}
		if ( worldLock.status === 'failed' ) {
			arWarn( '[EngineeringPlacementAnchorFailed]', { error: worldLock.error } );
			this.options.setStatus( '现实锚点创建失败，本次未放置模型。' );
			return { status: 'failed' };
		}
		if ( worldLock.status === 'cancelled' ) return { status: 'cancelled' };

		this.options.onBeforePlacementRequest();
		const localizationOverride = localization;
		const hadPlacedModel = this.options.placementSession.getPlacedModel() !== null;
		const placed = this.options.placementSession.placeEngineeringModelFromCurrentArFromEnu( {
			modelTemplate,
			registrationSolution,
			arFromEnuSolution: localizationOverride,
			currentSessionId: this.options.getCurrentSessionId()
		} );
		if ( placed ) {
			if ( this.options.commitModelWorldLock( worldLock ) === false ) {
				this.options.cancelModelWorldLock( worldLock );
				if ( hadPlacedModel === false ) this.options.placementSession.resetPlacement();
				this.options.setStatus( this.options.getInteractionBlockMessage() ?? 'AR 会话已变化，本次模型放置已取消。' );
				return { status: 'cancelled' };
			}
			this.options.applyModelLayerVisibility();
			this.options.syncRegistrationChainDebug();
			this.options.syncLocalizationDebug();
			if ( hadPlacedModel === false ) {
				this.options.onPlacementCompleted();
			}
			this.options.syncArSessionPhase();
			this.options.emit();
			return { status: 'placed', worldLock: worldLock.status };
		}
		this.options.cancelModelWorldLock( worldLock );
		this.options.syncArSessionPhase();

		if ( this.options.placementSession.getPlacedModel() === null ) {
			this.options.setStatus(
				this.options.placementSession.getAutoPlacementPending()
					? '正在按 Marker 校正结果放置模型...'
					: '工程放置未完成，请重试。'
			);
		}
		return { status: 'placement-failed' };

	}

	requestAutoPlacement(): void {

		this.options.placementSession.requestAutoPlacement( this.options.getModelTemplate() );
		this.attemptAutoPlacement();

	}

	attemptAutoPlacement(): void {

		if (
			this.placementInFlight
			|| this.options.placementSession.getPlacedModel() !== null
			|| this.options.placementSession.getAutoPlacementPending() === false
		) return;
		const localizationOverride = this.options.getPreferredLocalizationOverride();
		if ( localizationOverride === null ) {
			if ( this.options.getHitTestController().hasGroundHit() ) {
				arWarn( '[HitTestReadyButLocalizationMissing]', this.createPlacementLogPayload( {
					source: 'unknown',
					localizationReady: false
				} ) );
			}
			return;
		}
		void this.placeLocalizedModel();

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

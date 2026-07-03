import * as THREE from 'three';
import type { RegistrationStore } from '@/localization/core/registration-store.js';
import type { ArWorkflowMode } from '@/features/ar/types/workflow.js';
import type { ManualPlacementBase } from '@/localization/manual/manual-registration.js';
import type { EngineeringRegistrationSolution } from '@/localization/coarse/engineering-registration.js';
import type { PlacementSession } from '@/engine/placement/session.js';
import type { XRHitTestController } from '@/features/ar/types/runtime-types.js';
import type { ArSessionStateRuntime } from '@/engine/session/ar-session-state-runtime.js';
import type { ManualRegistrationWorkflow } from '@/engine/placement/manual-registration-workflow.js';
import type { PlacementWorkflow } from '@/engine/placement/placement-workflow.js';
import type { InspectionMarkerWorkflow } from '@/engine/inspection/inspection-marker-workflow.js';
import type { MarkerCalibrationRuntime } from '@/engine/inspection/marker-calibration-runtime.js';
import type { GpsBiasWorkflow } from '@/engine/session/gps-bias-workflow.js';
import type { SavedMarkerLocalizationResult } from '@/localization/marker/marker-localization-storage.js';
import type { ArFromEnuSolution } from '@/localization/core/ar-from-enu-solution.js';

interface SessionLifecycleRuntimeOptions {
	store: RegistrationStore;
	isPresenting(): boolean;
	getCurrentSessionId(): string | null;
	setCurrentSessionId(sessionId: string | null): void;
	getWorkflowMode(): ArWorkflowMode;
	getSiteId(): string | null;
	getPrimaryBaselineTargetId(): string | null;
	getActiveMarkerArFromEnuSolution(): ArFromEnuSolution | null;
	getActiveMarkerLocalizationResult(): SavedMarkerLocalizationResult | null;
	hasGroundHit(): boolean;
	getModelTemplate(): THREE.Group | null;
	getRegistrationSolution(): EngineeringRegistrationSolution | null;
	resetMarkerLocalizationCorrection(): void;
	refreshSiteCalibrationBaselineState(options?: { silentStatus?: boolean }): void;
	refreshGpsBiasCorrectionState(options?: { silentStatus?: boolean }): void;
	syncRegistrationChainDebug(): void;
	syncArSessionPhase(): void;
	syncSceneHost(): void;
	applyModelLayerVisibility(): void;
	emit(): void;
	appendLog(message: string): void;
	updateCoarseLocationDebugText(): void;
	setStatus(message: string): void;
	suppressSelection(durationMs: number): void;
	clearSelection(): void;
	getHitTestController(): XRHitTestController;
	placementSession: PlacementSession;
	arSessionStateRuntime: ArSessionStateRuntime;
	manualRegistrationWorkflow: ManualRegistrationWorkflow;
	placementWorkflow: PlacementWorkflow;
	inspectionMarkerWorkflow: InspectionMarkerWorkflow;
	markerCalibrationRuntime: MarkerCalibrationRuntime;
	gpsBiasWorkflow: GpsBiasWorkflow;
	manualApplyToPlacement(
		base: ManualPlacementBase,
		targetPosition: THREE.Vector3,
		targetOrientation: THREE.Quaternion
	): { position: THREE.Vector3; orientation: THREE.Quaternion; scale: number };
	manualPositionTarget: THREE.Vector3;
	manualOrientationTarget: THREE.Quaternion;
}

export class SessionLifecycleRuntime {

	constructor(private readonly options: SessionLifecycleRuntimeOptions) {}

	resetPlacement(): void {

		this.options.arSessionStateRuntime.markPlacementCommitted( false );
		this.options.placementSession.resetPlacement();
		this.options.syncArSessionPhase();
		this.options.syncSceneHost();
		if ( this.options.isPresenting() ) {
			this.options.setStatus( '模型位置已重置，请重新识别平面后再放置。' );
			return;
		}

		this.options.setStatus( '模型位置已重置。' );

	}

	handleXRSessionStart(): void {

		const currentSessionId = createArSessionId();
		this.options.setCurrentSessionId( currentSessionId );
		this.options.gpsBiasWorkflow.resetRuntimeState();
		this.options.inspectionMarkerWorkflow.startSession();
		this.options.resetMarkerLocalizationCorrection();
		this.options.markerCalibrationRuntime.resetRuntimeState();
		this.options.arSessionStateRuntime.handleSessionStart();
		this.options.suppressSelection( 1200 );
		this.options.placementSession.resetPlacement();
		this.options.manualRegistrationWorkflow.refreshActiveSitePose();
		this.options.refreshSiteCalibrationBaselineState( { silentStatus: true } );
		this.options.markerCalibrationRuntime.syncState();
		this.options.syncArSessionPhase();
		this.options.syncRegistrationChainDebug();
		this.options.syncSceneHost();
		console.info(
			this.options.getWorkflowMode() === 'site-baseline-config'
				? '[SiteBaselineConfigSessionStarted]'
				: '[ArInspectionSessionStarted]',
			{
				mode: this.options.getWorkflowMode(),
				siteId: this.options.getSiteId(),
				sessionId: currentSessionId,
				source: null,
				targetId: this.options.getPrimaryBaselineTargetId(),
				createdAt: Date.now(),
				trackingState: 'session-started',
				stableFrameCount: 0
			}
		);
		void this.options.placementWorkflow.warmupCoarseRegistration().catch( ( error ) => {
			console.error( 'Coarse registration warmup after session start failed:', error );
			this.options.appendLog( 'AR 会话后的粗配准预热失败。' );
			this.options.updateCoarseLocationDebugText();
		} );
		this.options.emit();

	}

	handleXRSessionEnd(): void {

		const endedSessionId = this.options.getCurrentSessionId();
		this.options.inspectionMarkerWorkflow.stopSession();
		this.options.resetMarkerLocalizationCorrection();
		this.options.gpsBiasWorkflow.resetRuntimeState();
		this.options.setCurrentSessionId( null );
		this.options.markerCalibrationRuntime.resetRuntimeState();
		this.options.arSessionStateRuntime.handleSessionEnd();
		this.options.placementSession.resetPlacement();
		this.options.manualRegistrationWorkflow.syncForHeading( 0 );
		this.options.refreshGpsBiasCorrectionState( { silentStatus: true } );
		this.options.syncRegistrationChainDebug();
		this.options.syncSceneHost();
		if ( this.options.getWorkflowMode() === 'ar-inspection' ) {
			console.info( '[ArInspectionSessionEnded]', {
				mode: this.options.getWorkflowMode(),
				siteId: this.options.getSiteId(),
				sessionId: endedSessionId,
				source: null,
				targetId: null,
				createdAt: Date.now(),
				trackingState: 'session-ended',
				stableFrameCount: 0
			} );
		}
		this.options.emit();

	}

	handlePlacementCompleted(): void {

		this.options.arSessionStateRuntime.markPlacementCommitted( true );
		if ( this.options.store.getState().workspaceMode !== 'browse' ) {
			this.options.store.patch( { workspaceMode: 'browse' } );
		}
		this.options.suppressSelection( 1200 );
		this.options.syncSceneHost();

		const activeMarkerSolution = this.options.getActiveMarkerArFromEnuSolution();
		if (
			this.options.getWorkflowMode() === 'ar-inspection'
			&& activeMarkerSolution !== null
			&& activeMarkerSolution.sessionId === this.options.getCurrentSessionId()
		) {
			console.info( '[ArInspectionAutoPlacementCompleted]', {
				mode: this.options.getWorkflowMode(),
				siteId: this.options.getSiteId(),
				sessionId: this.options.getCurrentSessionId(),
				targetId: this.options.getActiveMarkerLocalizationResult()?.markerId
					?? this.options.inspectionMarkerWorkflow.getStableTargetId(),
				source: activeMarkerSolution.source,
				trackingState: 'placement-completed',
				stableFrameCount: this.options.inspectionMarkerWorkflow.getStableFrameCount(),
				hasHitTest: this.options.hasGroundHit(),
				createdAt: Date.now()
			} );
			this.options.setStatus( '空间校正完成，模型已自动放置。' );
			return;
		}

		this.options.setStatus( '模型已放置，可切换浏览模式。' );

	}

	placeModelAtHitTest(): void {

		if ( this.options.isPresenting() === false ) {
			this.options.setStatus( 'AR 会话尚未开启。' );
			return;
		}

		if ( this.options.getHitTestController().hasGroundHit() === false ) {
			this.options.setStatus( '请先扫描可用平面，再执行临时放置。' );
			return;
		}

		const modelTemplate = this.options.getModelTemplate();
		const registrationSolution = this.options.getRegistrationSolution();
		if ( modelTemplate === null || registrationSolution === null ) {
			this.options.setStatus( '模型资源尚未准备完成。' );
			return;
		}

		this.options.clearSelection();
		this.options.suppressSelection( 1200 );
		const placed = this.options.placementSession.placeAtHitTest( {
			xrHitTest: this.options.getHitTestController(),
			modelTemplate,
			registrationSolution,
			manualApplyToPlacement: this.options.manualApplyToPlacement,
			manualPositionTarget: this.options.manualPositionTarget,
			manualOrientationTarget: this.options.manualOrientationTarget
		} );
		this.options.syncArSessionPhase();

		if ( placed === false ) {
			this.options.setStatus( '已识别平面，但临时放置未完成，请重试。' );
			return;
		}

		this.options.manualRegistrationWorkflow.clearActiveSitePose();
		this.options.applyModelLayerVisibility();
		this.handlePlacementCompleted();
		this.options.syncSceneHost();
		this.options.setStatus( '已按当前 hit-test 平面临时放置模型，不使用定位或配准结果。' );
		this.options.emit();

	}

}

function createArSessionId(): string {

	return `ar-session-${Date.now()}-${Math.random().toString( 36 ).slice( 2, 8 )}`;

}

import type { RegistrationStore } from '@/localization/core/registration-store.js';
import type { ArWorkflowMode } from '@/features/ar/types/workflow.js';
import type { PlacementSession } from '@/engine/placement/session.js';
import type { ArSessionStateRuntime } from '@/engine/session/ar-session-state-runtime.js';
import type { InspectionMarkerWorkflow } from '@/engine/inspection/inspection-marker-workflow.js';
import type { MarkerCalibrationRuntime } from '@/engine/inspection/marker-calibration-runtime.js';
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
	hasGroundHit(): boolean;
	resetMarkerLocalizationCorrection(): void;
	refreshSiteCalibrationBaselineState(options?: { silentStatus?: boolean }): void;
	syncRegistrationChainDebug(): void;
	syncArSessionPhase(): void;
	syncSceneHost(): void;
	emit(): void;
	setStatus(message: string): void;
	placementSession: PlacementSession;
	arSessionStateRuntime: ArSessionStateRuntime;
	inspectionMarkerWorkflow: InspectionMarkerWorkflow;
	markerCalibrationRuntime: MarkerCalibrationRuntime;
}

export class SessionLifecycleRuntime {

	constructor(private readonly options: SessionLifecycleRuntimeOptions) {}

	resetPlacement(): void {

		this.options.arSessionStateRuntime.markPlacementCommitted( false );
		this.options.placementSession.resetPlacement();
		this.options.syncArSessionPhase();
		this.options.syncSceneHost();
		this.options.setStatus(
			this.options.isPresenting()
				? '模型位置已重置，请重新完成 Marker 或手动四角点校正后再放置。'
				: '模型位置已重置。'
		);

	}

	handleXRSessionStart(): void {

		const currentSessionId = createArSessionId();
		this.options.setCurrentSessionId( currentSessionId );
		this.options.inspectionMarkerWorkflow.startSession();
		this.options.resetMarkerLocalizationCorrection();
		this.options.markerCalibrationRuntime.resetRuntimeState();
		this.options.arSessionStateRuntime.handleSessionStart();
		this.options.placementSession.resetPlacement();
		this.options.refreshSiteCalibrationBaselineState( { silentStatus: true } );
		this.options.markerCalibrationRuntime.syncState();
		this.options.syncArSessionPhase();
		this.options.syncRegistrationChainDebug();
		this.options.syncSceneHost();
		this.options.emit();

	}

	handleXRSessionEnd(): void {

		const endedSessionId = this.options.getCurrentSessionId();
		this.options.inspectionMarkerWorkflow.stopSession();
		this.options.resetMarkerLocalizationCorrection();
		this.options.setCurrentSessionId( null );
		this.options.markerCalibrationRuntime.resetRuntimeState();
		this.options.arSessionStateRuntime.handleSessionEnd();
		this.options.placementSession.resetPlacement();
		this.options.syncRegistrationChainDebug();
		this.options.syncSceneHost();
		this.options.emit();

	}

	handlePlacementCompleted(): void {

		this.options.arSessionStateRuntime.markPlacementCommitted( true );
		if ( this.options.store.getState().workspaceMode !== 'browse' ) {
			this.options.store.patch( { workspaceMode: 'browse' } );
		}
		this.options.syncSceneHost();

		const activeMarkerSolution = this.options.getActiveMarkerArFromEnuSolution();
		if (
			this.options.getWorkflowMode() === 'ar-inspection'
			&& activeMarkerSolution !== null
			&& activeMarkerSolution.sessionId === this.options.getCurrentSessionId()
		) {
			this.options.setStatus( '模型已按工程坐标显示，未强制贴地。' );
			return;
		}

		this.options.setStatus( '模型已放置，可切换浏览模式。' );

	}

}

function createArSessionId(): string {

	return `ar-session-${Date.now()}-${Math.random().toString( 36 ).slice( 2, 8 )}`;

}

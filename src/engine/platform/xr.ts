import type {
	ARSceneBundle,
	ArSessionRequestMode,
	SetStatus,
	XRHitTestController
} from '@/features/ar/types/runtime-types.js';
import {
	createXRHitTestController,
	detectImmersiveArSupport,
	type ImmersiveArSupportInfo
} from './xr-support.js';
import {
	recordXrStageTiming,
	updateXrFreezeWatchdog,
	xrFreezeHealthState
} from './xr-freeze-diagnostics.js';

interface CreateXRSessionRuntimeOptions {
	sceneBundle: ARSceneBundle;
	xrButtonWrap: HTMLElement;
	setStatus: SetStatus;
	onSessionStart(): void;
	onSessionEnd(): void;
	canReportStatus(): boolean;
	onAttemptAutoPlacement(): void;
	onFrameUpdate(frame: XRFrame): void;
}

interface XrFrameHealthState {
	sessionMode: ArSessionRequestMode;
	frameCount: number;
	renderCount: number;
	lastFrameAt: number;
	lastSuccessfulRenderAt: number;
	lastFrameDurationMs: number;
	maxFrameDurationMs: number;
	droppedOrFrozen: boolean;
	lastSuccessfulStage: string | null;
	lastFailedStage: string | null;
	lastErrorMessage: string | null;
	stageErrorCounts: Record<string, number>;
}

interface DepthInfoLike {
	width?: number;
	height?: number;
	rawValueToMeters?: number;
}

export interface XRSessionRuntime {
	setup(): void;
	detectSupport(): Promise<ImmersiveArSupportInfo>;
	requestSession(options?: { mode?: ArSessionRequestMode; cpuDepthDebug?: boolean }): void;
	renderFrame(time: number, frame?: XRFrame): void;
	getHitTestController(): XRHitTestController;
}

export function createXRSessionRuntime(options: CreateXRSessionRuntimeOptions): XRSessionRuntime {

	const {
		sceneBundle,
		xrButtonWrap,
		setStatus,
		onSessionStart,
		onSessionEnd,
		canReportStatus,
		onAttemptAutoPlacement,
		onFrameUpdate
	} = options;

	const xrHitTest = createXRHitTestController( {
		renderer: sceneBundle.renderer,
		reticle: sceneBundle.reticle,
		xrButtonWrap,
		setStatus,
		onSessionStart,
		onSessionEnd,
		canReportStatus
	} );
	const frameHealthState: XrFrameHealthState = createFrameHealthState();
	const lastStageErrorLogAt = new Map<string, number>();
	const lastStageSlowLogAt = new Map<string, number>();
	let lastViewerPoseSignature = '';

	function runFrameStage(stage: string, task: () => void): void {

		const startedAt = performance.now();
		xrFreezeHealthState.lastStartedStage = stage;
		try {
			task();
			frameHealthState.lastSuccessfulStage = stage;
			xrFreezeHealthState.lastSuccessfulStage = stage;
		} catch ( error ) {
			reportFrameStageError( stage, error );
		} finally {
			const durationMs = performance.now() - startedAt;
			recordXrStageTiming( stage, durationMs );
			const previousSlowLogAt = lastStageSlowLogAt.get( stage ) ?? 0;
			if ( import.meta.env.VITE_AR_DEBUG === 'true' && durationMs > 33 && startedAt - previousSlowLogAt > 3000 ) {
				lastStageSlowLogAt.set( stage, startedAt );
				console.warn( '[XrFrameStageSlow]', {
					stage,
					durationMs: Number( durationMs.toFixed( 2 ) )
				} );
			}
		}

	}

	function reportFrameStageError(stage: string, error: unknown): void {

		const now = performance.now();
		const previousLogAt = lastStageErrorLogAt.get( stage ) ?? 0;
		const count = ( frameHealthState.stageErrorCounts[ stage ] ?? 0 ) + 1;
		const message = error instanceof Error ? error.message : String( error );
		frameHealthState.stageErrorCounts[ stage ] = count;
		frameHealthState.lastFailedStage = stage;
		frameHealthState.lastErrorMessage = message;
		xrFreezeHealthState.lastFailedStage = stage;
		xrFreezeHealthState.lastErrorName = error instanceof Error ? error.name : typeof error;
		xrFreezeHealthState.lastErrorMessage = message;
		if ( stage === 'renderer-render' ) {
			xrFreezeHealthState.renderErrorCount += 1;
		}
		if ( now - previousLogAt < 3000 ) {
			return;
		}
		lastStageErrorLogAt.set( stage, now );
		console.error( '[XrFrameStageError]', {
			stage,
			errorName: error instanceof Error ? error.name : typeof error,
			errorMessage: message,
			stack: error instanceof Error ? error.stack : undefined,
			timestamp: Date.now(),
			errorCount: count,
			sessionMode: frameHealthState.sessionMode,
			depthUsage: readSessionValue( 'depthUsage' ),
			isPresenting: sceneBundle.renderer.xr.isPresenting
		} );
		setStatus( `XR 帧阶段异常：${stage}；已继续渲染。` );

	}

	function readSessionValue(key: 'depthUsage' | 'depthDataFormat' | 'depthActive'): unknown {

		try {
			return ( sceneBundle.renderer.xr.getSession() as unknown as Record<string, unknown> | null )?.[ key ];
		} catch {
			return undefined;
		}

	}

	function sampleViewerPose(frame: XRFrame, now: number): XRViewerPose | null {

		const referenceSpace = sceneBundle.renderer.xr.getReferenceSpace();
		if ( referenceSpace === null ) {
			return null;
		}
		const pose = frame.getViewerPose( referenceSpace ) ?? null;
		xrFreezeHealthState.viewerPoseSampleCount += 1;
		xrFreezeHealthState.lastViewerPoseSampleAt = now;
		if ( pose !== null && pose.views.length > 0 ) {
			const matrix = pose.views[ 0 ].transform.matrix;
			const signature = [
				matrix[ 0 ], matrix[ 1 ], matrix[ 2 ],
				matrix[ 4 ], matrix[ 5 ], matrix[ 6 ],
				matrix[ 8 ], matrix[ 9 ], matrix[ 10 ],
				matrix[ 12 ], matrix[ 13 ], matrix[ 14 ]
			].map( ( value ) => value.toFixed( 4 ) ).join( ',' );
			if ( signature !== lastViewerPoseSignature ) {
				lastViewerPoseSignature = signature;
				xrFreezeHealthState.viewerPoseChangeCount += 1;
				xrFreezeHealthState.lastViewerPoseChangedAt = now;
			}
		}
		return pose;

	}

	function readDepthCountOnly(frame: XRFrame, pose: XRViewerPose | null): void {

		xrFreezeHealthState.depthReadAttemptCount += 1;
		const getDepthInformation = ( frame as XRFrame & {
			getDepthInformation?: (view: XRView) => DepthInfoLike | null;
		} ).getDepthInformation;
		const view = pose?.views[ 0 ] ?? null;
		if ( getDepthInformation === undefined || view === null ) {
			xrFreezeHealthState.depthReadNullCount += 1;
			return;
		}
		const depthInfo = getDepthInformation.call( frame, view );
		if ( depthInfo === null || depthInfo === undefined ) {
			xrFreezeHealthState.depthReadNullCount += 1;
			return;
		}
		xrFreezeHealthState.depthReadSuccessCount += 1;
		xrFreezeHealthState.depthWidth = typeof depthInfo.width === 'number' ? depthInfo.width : null;
		xrFreezeHealthState.depthHeight = typeof depthInfo.height === 'number' ? depthInfo.height : null;
		xrFreezeHealthState.rawValueToMeters = typeof depthInfo.rawValueToMeters === 'number'
			? depthInfo.rawValueToMeters
			: null;

	}

	function resetFrameHealthState(): void {

		Object.assign( frameHealthState, createFrameHealthState(), {
			sessionMode: frameHealthState.sessionMode
		} );
		lastViewerPoseSignature = '';

	}

	return {
		setup() {

			xrHitTest.setup();

		},

		detectSupport() {

			return detectImmersiveArSupport();

		},

		requestSession(options) {

			frameHealthState.sessionMode = options?.mode ?? ( options?.cpuDepthDebug ? 'cpu-depth-debug' : 'normal' );
			resetFrameHealthState();
			xrHitTest.requestSession( options );

		},

		renderFrame(_: number, frame?: XRFrame) {

			const frameStartedAt = performance.now();
			frameHealthState.frameCount += 1;
			frameHealthState.lastFrameAt = frameStartedAt;
			xrFreezeHealthState.xrCallbackCount += 1;
			xrFreezeHealthState.lastXrCallbackAt = frameStartedAt;
			xrFreezeHealthState.depthReadEnabled = xrFreezeHealthState.diagnosticMode === 'depth-read-count';

			if ( sceneBundle.renderer.xr.isPresenting && frame ) {
				let viewerPose: XRViewerPose | null = null;
				runFrameStage( 'viewer-pose-read', () => {
					viewerPose = sampleViewerPose( frame, frameStartedAt );
				} );
				if ( xrFreezeHealthState.diagnosticMode !== 'depth-session-only' ) {
					runFrameStage( 'hit-test', () => {
						xrHitTest.update( frame );
					} );
				}
				if (
					xrFreezeHealthState.diagnosticMode !== 'depth-session-only'
					&& xrFreezeHealthState.diagnosticMode !== 'depth-hit-test'
				) {
					runFrameStage( 'auto-placement', () => {
						onAttemptAutoPlacement();
					} );
					runFrameStage( 'frame-update', () => {
						onFrameUpdate( frame );
					} );
				}
				if ( xrFreezeHealthState.diagnosticMode === 'depth-read-count' ) {
					runFrameStage( 'depth-read-count', () => {
						readDepthCountOnly( frame, viewerPose );
					} );
				}
			}

			runFrameStage( 'renderer-render', () => {
				xrFreezeHealthState.renderAttemptCount += 1;
				xrFreezeHealthState.lastRenderAttemptAt = performance.now();
				sceneBundle.renderer.render( sceneBundle.scene, sceneBundle.camera );
				frameHealthState.renderCount += 1;
				frameHealthState.lastSuccessfulRenderAt = performance.now();
				xrFreezeHealthState.renderSuccessCount += 1;
				xrFreezeHealthState.lastRenderSuccessAt = frameHealthState.lastSuccessfulRenderAt;
			} );
			const frameEndedAt = performance.now();
			frameHealthState.lastFrameDurationMs = frameEndedAt - frameStartedAt;
			frameHealthState.maxFrameDurationMs = Math.max(
				frameHealthState.maxFrameDurationMs,
				frameHealthState.lastFrameDurationMs
			);
			frameHealthState.droppedOrFrozen = sceneBundle.renderer.xr.isPresenting
				&& frameHealthState.lastSuccessfulRenderAt > 0
				&& frameEndedAt - frameHealthState.lastSuccessfulRenderAt > 1000;
			updateXrFreezeWatchdog( frameEndedAt );

		},

		getHitTestController() {

			return xrHitTest;

		}
	};

}

function createFrameHealthState(): XrFrameHealthState {

	return {
		sessionMode: 'normal',
		frameCount: 0,
		renderCount: 0,
		lastFrameAt: 0,
		lastSuccessfulRenderAt: 0,
		lastFrameDurationMs: 0,
		maxFrameDurationMs: 0,
		droppedOrFrozen: false,
		lastSuccessfulStage: null,
		lastFailedStage: null,
		lastErrorMessage: null,
		stageErrorCounts: {}
	};

}

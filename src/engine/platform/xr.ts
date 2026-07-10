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
	const frameHealthState: XrFrameHealthState = {
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
	const lastStageErrorLogAt = new Map<string, number>();

	function runFrameStage(stage: string, task: () => void): void {

		const startedAt = performance.now();
		try {
			task();
			frameHealthState.lastSuccessfulStage = stage;
		} catch ( error ) {
			reportFrameStageError( stage, error );
		} finally {
			const durationMs = performance.now() - startedAt;
			if ( import.meta.env.VITE_AR_DEBUG === 'true' && durationMs > 33 ) {
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

	return {
		setup() {

			xrHitTest.setup();

		},

		detectSupport() {

			return detectImmersiveArSupport();

		},

		requestSession(options) {

			frameHealthState.sessionMode = options?.mode ?? ( options?.cpuDepthDebug ? 'cpu-depth-debug' : 'normal' );
			xrHitTest.requestSession( options );

		},

		renderFrame(_: number, frame?: XRFrame) {

			const frameStartedAt = performance.now();
			frameHealthState.frameCount += 1;
			frameHealthState.lastFrameAt = frameStartedAt;
			if ( sceneBundle.renderer.xr.isPresenting && frame ) {
				runFrameStage( 'hit-test', () => {
					xrHitTest.update( frame );
				} );
				runFrameStage( 'auto-placement', () => {
					onAttemptAutoPlacement();
				} );
				runFrameStage( 'frame-update', () => {
					onFrameUpdate( frame );
				} );
			}

			runFrameStage( 'renderer-render', () => {
				sceneBundle.renderer.render( sceneBundle.scene, sceneBundle.camera );
				frameHealthState.renderCount += 1;
				frameHealthState.lastSuccessfulRenderAt = performance.now();
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

		},

		getHitTestController() {

			return xrHitTest;

		}
	};

}

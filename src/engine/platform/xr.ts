import { arError, arWarn } from '@/engine/debug/ar-logger.js';
import type {
	ARSceneBundle,
	ArSessionStartResult,
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
	onSessionStart(result: ArSessionStartResult): void;
	onSessionEnd(): void;
	canReportStatus(): boolean;
	onAttemptAutoPlacement(): void;
	onFrameUpdate(frame: XRFrame): void;
}

export interface XRSessionRuntime {
	setup(): void;
	detectSupport(): Promise<ImmersiveArSupportInfo>;
	requestSession(): Promise<void>;
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
	// Temporary investigation only: remove every XRDebugProbe before applying the fix.
	let probeSession: XRSession | null = null;
	let probeReferenceSpace: XRReferenceSpace | null = null;
	let lastProbeTrackingState: 'normal' | 'emulated' | 'unavailable' | null = null;
	const handleProbeVisibilityChange = (): void => {
		arWarn( '[XRDebugProbe]', {
			event: 'session-visibility-change',
			visibilityState: probeSession?.visibilityState ?? 'unknown',
			timestamp: Date.now()
		} );
	};
	const handleProbeReferenceSpaceReset = (event: Event): void => {
		const transform = ( event as Event & { transform?: XRRigidTransform | null } ).transform;
		arWarn( '[XRDebugProbe]', {
			event: 'reference-space-reset',
			transform: transform === undefined || transform === null ? null : Array.from( transform.matrix ),
			timestamp: Date.now()
		} );
	};
	const bindProbeReferenceSpace = (referenceSpace: XRReferenceSpace | null): void => {
		if ( referenceSpace === probeReferenceSpace ) return;
		probeReferenceSpace?.removeEventListener( 'reset', handleProbeReferenceSpaceReset );
		probeReferenceSpace = referenceSpace;
		probeReferenceSpace?.addEventListener( 'reset', handleProbeReferenceSpaceReset );
		arWarn( '[XRDebugProbe]', {
			event: 'reference-space-change',
			available: referenceSpace !== null,
			timestamp: Date.now()
		} );
	};
	const probeTracking = (frame: XRFrame, referenceSpace: XRReferenceSpace | null): void => {
		const pose = referenceSpace === null ? null : frame.getViewerPose( referenceSpace ) ?? null;
		const state = pose === null
			? 'unavailable'
			: pose.emulatedPosition
				? 'emulated'
				: 'normal';
		if ( state === lastProbeTrackingState ) return;
		lastProbeTrackingState = state;
		arWarn( '[XRDebugProbe]', {
			event: 'tracking-state-change',
			state,
			visibilityState: probeSession?.visibilityState ?? 'unknown',
			timestamp: Date.now()
		} );
	};
	const handleProbeSessionStart = (result: ArSessionStartResult): void => {
		probeSession = result.session;
		lastProbeTrackingState = null;
		probeSession.addEventListener( 'visibilitychange', handleProbeVisibilityChange );
		arWarn( '[XRDebugProbe]', {
			event: 'session-start',
			visibilityState: probeSession.visibilityState,
			timestamp: Date.now()
		} );
		onSessionStart( result );
	};
	const handleProbeSessionEnd = (): void => {
		arWarn( '[XRDebugProbe]', {
			event: 'session-end',
			visibilityState: probeSession?.visibilityState ?? 'unknown',
			timestamp: Date.now()
		} );
		probeSession?.removeEventListener( 'visibilitychange', handleProbeVisibilityChange );
		probeReferenceSpace?.removeEventListener( 'reset', handleProbeReferenceSpaceReset );
		probeSession = null;
		probeReferenceSpace = null;
		lastProbeTrackingState = null;
		onSessionEnd();
	};
	const xrHitTest = createXRHitTestController( {
		renderer: sceneBundle.renderer,
		reticle: sceneBundle.reticle,
		xrButtonWrap,
		setStatus,
		onSessionStart: handleProbeSessionStart,
		onSessionEnd: handleProbeSessionEnd,
		canReportStatus
	} );
	const errorCounts = new Map<string, number>();
	const lastErrorLogAt = new Map<string, number>();

	function runFrameStage(stage: string, task: () => void): void {

		try {
			task();
		} catch ( error ) {
			const now = performance.now();
			const count = ( errorCounts.get( stage ) ?? 0 ) + 1;
			errorCounts.set( stage, count );
			if ( now - ( lastErrorLogAt.get( stage ) ?? 0 ) < 3000 ) {
				return;
			}
			lastErrorLogAt.set( stage, now );
			const message = error instanceof Error ? error.message : String( error );
			arError( '[XrFrameStageError]', {
				stage,
				errorName: error instanceof Error ? error.name : typeof error,
				errorMessage: message,
				errorCount: count
			} );
			setStatus( `XR 帧阶段异常：${stage}；已继续渲染。` );
		}

	}

	return {
		setup() {

			xrHitTest.setup();

		},

		detectSupport() {

			return detectImmersiveArSupport();

		},

		requestSession() {

			return xrHitTest.requestSession();

		},

		renderFrame(_time: number, frame?: XRFrame) {

			if ( sceneBundle.renderer.xr.isPresenting && frame ) {
				const referenceSpace = sceneBundle.renderer.xr.getReferenceSpace();
				runFrameStage( 'tracking-probe', () => {
					bindProbeReferenceSpace( referenceSpace );
					probeTracking( frame, referenceSpace );
				} );
				runFrameStage( 'hit-test', () => xrHitTest.update( frame ) );
				runFrameStage( 'auto-placement', onAttemptAutoPlacement );
				runFrameStage( 'frame-update', () => onFrameUpdate( frame ) );
			}
			runFrameStage( 'renderer-render', () => {
				sceneBundle.renderer.render( sceneBundle.scene, sceneBundle.camera );
			} );

		},

		getHitTestController() {

			return xrHitTest;

		}
	};

}

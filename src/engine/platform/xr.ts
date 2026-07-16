import { arError } from '@/engine/debug/ar-logger.js';
import type {
	ARSceneBundle,
	ArSessionStartResult,
	SetStatus,
	XRHitTestController,
	XrSessionVisibilityState,
	XrTrackingStatus
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
	onTrackingStatusChange(status: XrTrackingStatus): void;
	onSessionVisibilityChange(state: XrSessionVisibilityState): void;
	onReferenceSpaceReset(): void;
	onFrameUpdate(frame: XRFrame): void;
}

export interface XRSessionRuntime {
	setup(): void;
	detectSupport(): Promise<ImmersiveArSupportInfo>;
	requestSession(domOverlayRoot: HTMLElement): Promise<boolean>;
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
		onTrackingStatusChange,
		onSessionVisibilityChange,
		onReferenceSpaceReset,
		onFrameUpdate
	} = options;
	let activeSession: XRSession | null = null;
	let activeReferenceSpace: XRReferenceSpace | null = null;
	const handleVisibilityChange = (): void => {
		onSessionVisibilityChange( readVisibilityState( activeSession ) );
	};
	const handleReferenceSpaceReset = (): void => {
		onReferenceSpaceReset();
	};
	const handleSessionStart = (result: ArSessionStartResult): void => {
		activeSession = result.session;
		activeSession.addEventListener( 'visibilitychange', handleVisibilityChange );
		onSessionVisibilityChange( readVisibilityState( activeSession ) );
		onSessionStart( result );
	};
	const handleSessionEnd = (): void => {
		activeSession?.removeEventListener( 'visibilitychange', handleVisibilityChange );
		activeReferenceSpace?.removeEventListener( 'reset', handleReferenceSpaceReset );
		activeSession = null;
		activeReferenceSpace = null;
		onSessionEnd();
	};
	const xrHitTest = createXRHitTestController( {
		renderer: sceneBundle.renderer,
		reticle: sceneBundle.reticle,
		xrButtonWrap,
		setStatus,
		onSessionStart: handleSessionStart,
		onSessionEnd: handleSessionEnd,
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

		requestSession(domOverlayRoot) {

			return xrHitTest.requestSession( domOverlayRoot );

		},

		renderFrame(_time: number, frame?: XRFrame) {

			if ( sceneBundle.renderer.xr.isPresenting && frame ) {
				const referenceSpace = sceneBundle.renderer.xr.getReferenceSpace();
				if ( referenceSpace !== activeReferenceSpace ) {
					activeReferenceSpace?.removeEventListener( 'reset', handleReferenceSpaceReset );
					activeReferenceSpace = referenceSpace;
					activeReferenceSpace?.addEventListener( 'reset', handleReferenceSpaceReset );
				}
				const viewerPose = referenceSpace === null ? null : frame.getViewerPose( referenceSpace ) ?? null;
				onTrackingStatusChange( resolveXrTrackingStatus( viewerPose ) );
				runFrameStage( 'hit-test', () => xrHitTest.update( frame ) );
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

export function resolveXrTrackingStatus(
	viewerPose: { emulatedPosition?: boolean } | null
): XrTrackingStatus {

	if ( viewerPose === null ) return 'unavailable';
	return viewerPose.emulatedPosition === true ? 'emulated' : 'normal';

}

function readVisibilityState(session: XRSession | null): XrSessionVisibilityState {

	const state = session?.visibilityState;
	return state === 'hidden' || state === 'visible-blurred' ? state : 'visible';

}

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
	requestSession(): void;
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
			console.error( '[XrFrameStageError]', {
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

			xrHitTest.requestSession();

		},

		renderFrame(_time: number, frame?: XRFrame) {

			if ( sceneBundle.renderer.xr.isPresenting && frame ) {
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

import type {
	ARSceneBundle,
	SetStatus,
	XRHitTestController,
	XrImageTrackingObservation,
	XrImageTrackingState,
	XrTrackedImageDefinition
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
	onAttemptCoarsePlacement(): void;
	onFrameUpdate(frame: XRFrame): void;
	getTrackedImages(): XrTrackedImageDefinition[];
	onImageTrackingStateChange(state: XrImageTrackingState): void;
	onImageTrackingObservation(observation: XrImageTrackingObservation): void;
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
		onAttemptCoarsePlacement,
		onFrameUpdate,
		getTrackedImages,
		onImageTrackingStateChange,
		onImageTrackingObservation
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

	return {
		setup() {

			xrHitTest.setup();

		},

		detectSupport() {

			return detectImmersiveArSupport();

		},

		requestSession() {

			xrHitTest.requestSession( {
				trackedImages: getTrackedImages()
			} );

		},

		renderFrame(_: number, frame?: XRFrame) {

			if ( sceneBundle.renderer.xr.isPresenting && frame ) {
				xrHitTest.update( frame );
				emitImageTrackingState();
				emitImageTrackingObservations( frame );
				onAttemptCoarsePlacement();
				onFrameUpdate( frame );
			}

			sceneBundle.renderer.render( sceneBundle.scene, sceneBundle.camera );

		},

		getHitTestController() {

			return xrHitTest;

		}
	};

	function emitImageTrackingState(): void {

		onImageTrackingStateChange( xrHitTest.getImageTrackingState() );

	}

	function emitImageTrackingObservations(frame: XRFrame): void {

		const imageTrackingState = xrHitTest.getImageTrackingState();
		if ( imageTrackingState.requested === false ) {
			return;
		}

		const trackedFrame = frame as XRFrame & {
			getImageTrackingResults?: () => Array<{
				index: number;
				trackingState?: string;
				imageSpace: XRSpace;
			}>;
		};
		if ( typeof trackedFrame.getImageTrackingResults !== 'function' ) {
			if ( imageTrackingState.supported || imageTrackingState.active ) {
				onImageTrackingStateChange( {
					requested: imageTrackingState.requested,
					supported: false,
					active: false,
					reason: 'frame-api-missing'
				} );
			}
			return;
		}

		const referenceSpace = sceneBundle.renderer.xr.getReferenceSpace();
		if ( referenceSpace === null ) {
			return;
		}

		for ( const result of trackedFrame.getImageTrackingResults() ) {
			const targetId = xrHitTest.getTrackedImageTargetId( result.index );
			if ( targetId === null ) {
				continue;
			}

			const pose = frame.getPose( result.imageSpace, referenceSpace );
			if ( pose == null ) {
				continue;
			}

			onImageTrackingObservation( {
				targetId,
				trackingState: result.trackingState ?? 'tracked',
				position: [
					pose.transform.position.x,
					pose.transform.position.y,
					pose.transform.position.z
				],
				rotation: [
					pose.transform.orientation.x,
					pose.transform.orientation.y,
					pose.transform.orientation.z,
					pose.transform.orientation.w
				],
				timestamp: Date.now()
			} );
		}

	}

}



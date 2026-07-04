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
	onAttemptAutoPlacement(): void;
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
		onAttemptAutoPlacement,
		onFrameUpdate,
		getTrackedImages,
		onImageTrackingStateChange,
		onImageTrackingObservation
	} = options;
	let lastApiMissingLoggedAt = 0;
	let lastNoResultsLoggedAt = 0;
	let lastObservedSignature = '';
	let lastObservedLoggedAt = 0;

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
				onAttemptAutoPlacement();
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
			if ( shouldLogImageTrackingEvent( lastApiMissingLoggedAt, 1000 ) ) {
				lastApiMissingLoggedAt = Date.now();
				console.info( '[AutoMarkerImageTrackingApiMissing]', {
					hasImageTrackingApi: false,
					resultsLength: 0,
					trackingState: imageTrackingState.reason,
					targetId: null,
					imageIndex: null
				} );
			}
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

		const results = trackedFrame.getImageTrackingResults();
		if ( results.length === 0 ) {
			if ( shouldLogImageTrackingEvent( lastNoResultsLoggedAt, 1000 ) ) {
				lastNoResultsLoggedAt = Date.now();
				console.info( '[AutoMarkerImageTrackingNoResults]', {
					hasImageTrackingApi: true,
					resultsLength: 0,
					trackingState: imageTrackingState.reason,
					targetId: null,
					imageIndex: null
				} );
			}
			return;
		}

		for ( const result of results ) {
			const targetId = xrHitTest.getTrackedImageTargetId( result.index );
			if ( targetId === null ) {
				continue;
			}
			const trackingState = result.trackingState ?? 'tracked';
			const observedSignature = [
				result.index,
				targetId,
				trackingState,
				results.length
			].join( '::' );
			if (
				observedSignature !== lastObservedSignature
				|| shouldLogImageTrackingEvent( lastObservedLoggedAt, 1000 )
			) {
				lastObservedSignature = observedSignature;
				lastObservedLoggedAt = Date.now();
				console.info( '[AutoMarkerImageTrackingResultObserved]', {
					hasImageTrackingApi: true,
					resultsLength: results.length,
					trackingState,
					targetId,
					imageIndex: result.index
				} );
			}

			const pose = frame.getPose( result.imageSpace, referenceSpace );
			if ( pose == null ) {
				continue;
			}

			onImageTrackingObservation( {
				targetId,
				trackingState,
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

function shouldLogImageTrackingEvent(lastLoggedAt: number, intervalMs: number): boolean {

	return Date.now() - lastLoggedAt >= intervalMs;

}



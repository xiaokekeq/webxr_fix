import { arError } from '@/engine/debug/ar-logger.js';
import { formatXrDebugPoint, resetXrDebugPanel, showXrDebugProbe } from '@/engine/debug/xr-debug-panel.js';
import * as THREE from 'three';
import type {
	ARSceneBundle,
	ArSessionStartResult,
	SetStatus,
	XRAnchorHandle,
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
	lockModelToLatestHit(): Promise<'locked' | 'unavailable' | 'cancelled'>;
	clearModelWorldLock(): void;
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
	// Temporary investigation UI calls are removed after the device verification pass.
	let probeSession: XRSession | null = null;
	let activeReferenceSpace: XRReferenceSpace | null = null;
	let lastTrackingState: 'normal' | 'emulated' | 'unavailable' | null = null;
	let modelWorldAnchor: XRAnchorHandle | null = null;
	let modelWorldAnchorRequestId = 0;
	let modelWorldAnchorTracked = false;
	let unanchoredModelInvalidated = false;
	const initialAnchorPoseInverse = new THREE.Matrix4();
	const currentAnchorPose = new THREE.Matrix4();
	const worldLockCorrection = new THREE.Matrix4();
	const worldLockPosition = new THREE.Vector3();
	const worldLockQuaternion = new THREE.Quaternion();
	const worldLockScale = new THREE.Vector3();
	const handleProbeVisibilityChange = (): void => {
		showXrDebugProbe( `visibility ${probeSession?.visibilityState ?? 'unknown'}` );
	};
	const handleReferenceSpaceReset = (event: Event): void => {
		const transform = ( event as Event & { transform?: XRRigidTransform | null } ).transform;
		showXrDebugProbe( `reference reset ${transform === undefined || transform === null ? 'transform=null' : `delta=${formatXrDebugPoint( transform.position )}`}` );
		if ( modelWorldAnchor === null && sceneBundle.arModelAnchor.children.length > 0 ) {
			sceneBundle.arPlacementAnchor.visible = false;
			unanchoredModelInvalidated = true;
			setStatus( 'XR 空间已重置且设备未建立现实锚点；请重置模型并重新完成 Marker 校正。' );
		}
	};
	const bindReferenceSpace = (referenceSpace: XRReferenceSpace | null): void => {
		if ( referenceSpace === activeReferenceSpace ) return;
		activeReferenceSpace?.removeEventListener( 'reset', handleReferenceSpaceReset );
		activeReferenceSpace = referenceSpace;
		activeReferenceSpace?.addEventListener( 'reset', handleReferenceSpaceReset );
		showXrDebugProbe( `reference space ${referenceSpace === null ? 'missing' : 'ready'}` );
	};
	const updateTrackingState = (frame: XRFrame, referenceSpace: XRReferenceSpace | null): void => {
		const pose = referenceSpace === null ? null : frame.getViewerPose( referenceSpace ) ?? null;
		const state = pose === null
			? 'unavailable'
			: pose.emulatedPosition
				? 'emulated'
				: 'normal';
		const previousState = lastTrackingState;
		if (
			modelWorldAnchor === null
			&& sceneBundle.arModelAnchor.children.length > 0
			&& ( state !== 'normal' || unanchoredModelInvalidated )
		) {
			sceneBundle.arPlacementAnchor.visible = false;
			unanchoredModelInvalidated = true;
			if ( state === 'normal' && previousState !== 'normal' ) {
				setStatus( '空间跟踪已恢复，但设备未建立现实锚点；请重置模型并重新完成 Marker 校正。' );
			}
		}
		if ( state === previousState ) return;
		lastTrackingState = state;
		showXrDebugProbe( `tracking ${state} / ${probeSession?.visibilityState ?? 'unknown'}` );
	};
	const handleProbeSessionStart = (result: ArSessionStartResult): void => {
		probeSession = result.session;
		lastTrackingState = null;
		probeSession.addEventListener( 'visibilitychange', handleProbeVisibilityChange );
		resetXrDebugPanel();
		showXrDebugProbe( `session start / ${probeSession.visibilityState}` );
		onSessionStart( result );
	};
	const handleProbeSessionEnd = (): void => {
		showXrDebugProbe( `session end / ${probeSession?.visibilityState ?? 'unknown'}` );
		clearModelWorldLock();
		probeSession?.removeEventListener( 'visibilitychange', handleProbeVisibilityChange );
		activeReferenceSpace?.removeEventListener( 'reset', handleReferenceSpaceReset );
		probeSession = null;
		activeReferenceSpace = null;
		lastTrackingState = null;
		onSessionEnd();
	};
	function resetPlacementAnchorTransform(): void {

		sceneBundle.arPlacementAnchor.position.set( 0, 0, 0 );
		sceneBundle.arPlacementAnchor.quaternion.identity();
		sceneBundle.arPlacementAnchor.scale.set( 1, 1, 1 );
		sceneBundle.arPlacementAnchor.visible = true;
		sceneBundle.arPlacementAnchor.updateMatrixWorld( true );

	}
	function clearModelWorldLock(): void {

		modelWorldAnchorRequestId += 1;
		xrHitTest.cancelPendingAnchorRequest();
		try {
			modelWorldAnchor?.delete?.();
		} catch {}
		modelWorldAnchor = null;
		modelWorldAnchorTracked = false;
		unanchoredModelInvalidated = false;
		resetPlacementAnchorTransform();

	}
	async function lockModelToLatestHit(): Promise<'locked' | 'unavailable' | 'cancelled'> {

		const session = sceneBundle.renderer.xr.getSession();
		if ( session === null ) return 'cancelled';

		clearModelWorldLock();
		const requestId = modelWorldAnchorRequestId;
		const placement = await xrHitTest.createAnchorFromNextHit();
		if ( requestId !== modelWorldAnchorRequestId || sceneBundle.renderer.xr.getSession() !== session ) {
			if ( placement !== null ) {
				try {
					placement.anchor.delete?.();
				} catch {}
			}
			return 'cancelled';
		}
		if ( placement === null ) {
			showXrDebugProbe( 'world anchor unavailable' );
			return 'unavailable';
		}
		const { anchor, initialPoseMatrix } = placement;

		modelWorldAnchor = anchor;
		unanchoredModelInvalidated = false;
		initialAnchorPoseInverse.copy( initialPoseMatrix ).invert();
		showXrDebugProbe( `world anchor ready at ${formatXrDebugPoint( new THREE.Vector3().setFromMatrixPosition( initialPoseMatrix ) )}` );
		return 'locked';

	}
	function updateModelWorldLock(frame: XRFrame, referenceSpace: XRReferenceSpace): void {

		if ( modelWorldAnchor === null ) return;
		const viewerPose = frame.getViewerPose( referenceSpace );
		const anchorPose = viewerPose === null ? null : frame.getPose( modelWorldAnchor.anchorSpace, referenceSpace );
		if ( anchorPose === undefined || anchorPose === null ) {
			sceneBundle.arPlacementAnchor.visible = false;
			if ( modelWorldAnchorTracked ) showXrDebugProbe( 'world anchor tracking unavailable' );
			modelWorldAnchorTracked = false;
			return;
		}

		currentAnchorPose.fromArray( anchorPose.transform.matrix );
		composeWorldLockCorrection( currentAnchorPose, initialAnchorPoseInverse, worldLockCorrection )
			.decompose( worldLockPosition, worldLockQuaternion, worldLockScale );
		sceneBundle.arPlacementAnchor.position.copy( worldLockPosition );
		sceneBundle.arPlacementAnchor.quaternion.copy( worldLockQuaternion );
		sceneBundle.arPlacementAnchor.scale.copy( worldLockScale );
		sceneBundle.arPlacementAnchor.visible = true;
		sceneBundle.arPlacementAnchor.updateMatrixWorld( true );
		if ( modelWorldAnchorTracked === false ) {
			showXrDebugProbe( `world anchor tracking normal delta=${formatXrDebugPoint( worldLockPosition )}` );
		}
		modelWorldAnchorTracked = true;

	}
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

		lockModelToLatestHit,

		clearModelWorldLock,

		renderFrame(_time: number, frame?: XRFrame) {

			if ( sceneBundle.renderer.xr.isPresenting && frame ) {
				const referenceSpace = sceneBundle.renderer.xr.getReferenceSpace();
				runFrameStage( 'tracking-probe', () => {
					bindReferenceSpace( referenceSpace );
					updateTrackingState( frame, referenceSpace );
				} );
				runFrameStage( 'hit-test', () => xrHitTest.update( frame ) );
				if ( referenceSpace !== null ) runFrameStage( 'world-anchor', () => updateModelWorldLock( frame, referenceSpace ) );
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

export function composeWorldLockCorrection(
	currentPose: THREE.Matrix4,
	initialPoseInverse: THREE.Matrix4,
	target = new THREE.Matrix4()
): THREE.Matrix4 {

	return target.multiplyMatrices( currentPose, initialPoseInverse );

}

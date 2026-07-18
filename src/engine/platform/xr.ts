import { arError } from '@/engine/debug/ar-logger.js';
import * as THREE from 'three';
import type {
	ARSceneBundle,
	ArSessionStartResult,
	SetStatus,
	XRAnchorHandle,
	XRInteractionState,
	XRSessionVisibilityState,
	XRTrackingState,
	XRWorldLockPreparation,
	XRWorldLockState,
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
	isHudPickingLocked(): boolean;
	onInteractionStateChange(): void;
	onAttemptAutoPlacement(): void;
	onFrameUpdate(frame: XRFrame): void;
}

export interface XRSessionRuntime {
	setup(): void;
	dispose(): void;
	detectSupport(): Promise<ImmersiveArSupportInfo>;
	requestSession(): Promise<void>;
	renderFrame(time: number, frame?: XRFrame): void;
	getHitTestController(): XRHitTestController;
	prepareModelWorldLock(): Promise<XRWorldLockPreparation>;
	commitModelWorldLock(preparation: XRWorldLockPreparation): boolean;
	cancelModelWorldLock(preparation: XRWorldLockPreparation): void;
	clearModelWorldLock(): void;
	getInteractionState(): XRInteractionState;
	canPlaceOrCalibrate(): boolean;
	canPickModel(): boolean;
	getInteractionBlockMessage(): string | null;
}

export function createXRSessionRuntime(options: CreateXRSessionRuntimeOptions): XRSessionRuntime {

	const {
		sceneBundle,
		xrButtonWrap,
		setStatus,
		onSessionStart,
		onSessionEnd,
		canReportStatus,
		isHudPickingLocked,
		onInteractionStateChange,
		onAttemptAutoPlacement,
		onFrameUpdate
	} = options;
	let activeSession: XRSession | null = null;
	let activeReferenceSpace: XRReferenceSpace | null = null;
	let viewerTrackingState: XRTrackingState = 'unavailable';
	let anchorPoseAvailable = true;
	let anchorSeenTracked = false;
	let modelWorldAnchor: XRAnchorHandle | null = null;
	let modelWorldAnchorRequestId = 0;
	let pendingWorldLockPreparation: XRWorldLockPreparation | null = null;
	let pendingPreviousWorldLock: XRWorldLockState = 'none';
	const interactionState: XRInteractionState = {
		tracking: 'unavailable',
		visibility: 'hidden',
		worldLock: 'none',
		hudPickingLocked: false
	};
	const initialAnchorPoseInverse = new THREE.Matrix4();
	const currentAnchorPose = new THREE.Matrix4();
	const worldLockCorrection = new THREE.Matrix4();
	const worldLockPosition = new THREE.Vector3();
	const worldLockQuaternion = new THREE.Quaternion();
	const worldLockScale = new THREE.Vector3();
	const resetMatrix = new THREE.Matrix4();
	const resetCompensatedMatrix = new THREE.Matrix4();

	const handleReferenceSpaceReset = (event: XRReferenceSpaceEvent): void => {
		const effectiveWorldLock = interactionState.worldLock === 'pending'
			? pendingPreviousWorldLock
			: interactionState.worldLock;
		if ( effectiveWorldLock === 'anchored' || sceneBundle.arModelAnchor.children.length === 0 ) return;
		if ( effectiveWorldLock !== 'unanchored' ) return;
		const transform = event.transform ?? null;

		if ( transform === null ) {
			abortPendingWorldLock();
			setWorldLockState( 'recalibration-required' );
			setStatus( '空间坐标发生变化，请重新校正；现有模型已冻结，不会自动重放。' );
			return;
		}

		sceneBundle.arPlacementAnchor.updateMatrix();
		resetMatrix.fromArray( transform.matrix );
		composeReferenceSpaceResetCompensation(
			sceneBundle.arPlacementAnchor.matrix,
			resetMatrix,
			resetCompensatedMatrix
		).decompose( worldLockPosition, worldLockQuaternion, worldLockScale );
		sceneBundle.arPlacementAnchor.position.copy( worldLockPosition );
		sceneBundle.arPlacementAnchor.quaternion.copy( worldLockQuaternion );
		sceneBundle.arPlacementAnchor.scale.copy( worldLockScale );
		sceneBundle.arPlacementAnchor.updateMatrixWorld( true );
	};

	const handleVisibilityChange = (): void => {
		if ( activeSession === null ) return;
		const visibility = normalizeVisibilityState( activeSession.visibilityState );
		if ( visibility === interactionState.visibility ) return;
		interactionState.visibility = visibility;
		onInteractionStateChange();
		if ( visibility !== 'visible' ) setStatus( '跟踪恢复中，已暂停放置、校正和模型拾取。' );
	};

	const bindReferenceSpace = (referenceSpace: XRReferenceSpace | null): void => {
		if ( referenceSpace === activeReferenceSpace ) return;
		activeReferenceSpace?.removeEventListener( 'reset', handleReferenceSpaceReset );
		activeReferenceSpace = referenceSpace;
		activeReferenceSpace?.addEventListener( 'reset', handleReferenceSpaceReset );
	};

	const updateTrackingState = (frame: XRFrame, referenceSpace: XRReferenceSpace | null): void => {
		const pose = referenceSpace === null ? null : frame.getViewerPose( referenceSpace ) ?? null;
		const nextViewerTracking = resolveXRTrackingState( pose );
		const previousEffectiveTracking = interactionState.tracking;
		viewerTrackingState = nextViewerTracking;
		refreshEffectiveTracking();
		if ( interactionState.tracking === previousEffectiveTracking ) return;
		if ( interactionState.tracking === 'normal' ) {
			setStatus( '空间跟踪已恢复。' );
		} else {
			setStatus( '跟踪恢复中，已暂停放置、校正和模型拾取。' );
		}
	};

	const handleSessionStart = (result: ArSessionStartResult): void => {
		activeSession?.removeEventListener( 'visibilitychange', handleVisibilityChange );
		clearModelWorldLock();
		activeSession = result.session;
		activeSession.addEventListener( 'visibilitychange', handleVisibilityChange );
		viewerTrackingState = 'unavailable';
		anchorPoseAvailable = true;
		interactionState.tracking = 'unavailable';
		interactionState.visibility = normalizeVisibilityState( activeSession.visibilityState );
		interactionState.worldLock = 'none';
		onInteractionStateChange();
		onSessionStart( result );
	};

	const handleSessionEnd = (): void => {
		activeSession?.removeEventListener( 'visibilitychange', handleVisibilityChange );
		activeSession = null;
		clearModelWorldLock();
		activeReferenceSpace?.removeEventListener( 'reset', handleReferenceSpaceReset );
		activeReferenceSpace = null;
		viewerTrackingState = 'unavailable';
		interactionState.tracking = 'unavailable';
		interactionState.visibility = 'hidden';
		onInteractionStateChange();
		onSessionEnd();
	};

	function getInteractionState(): XRInteractionState {

		return {
			...interactionState,
			hudPickingLocked: isHudPickingLocked()
		};

	}

	function refreshEffectiveTracking(): void {

		const nextTracking = anchorPoseAvailable ? viewerTrackingState : 'unavailable';
		if ( nextTracking === interactionState.tracking ) return;
		interactionState.tracking = nextTracking;
		onInteractionStateChange();

	}

	function setWorldLockState(worldLock: XRWorldLockState): void {

		if ( interactionState.worldLock === worldLock ) return;
		interactionState.worldLock = worldLock;
		onInteractionStateChange();

	}

	function resetPlacementAnchorTransform(): void {

		sceneBundle.arPlacementAnchor.position.set( 0, 0, 0 );
		sceneBundle.arPlacementAnchor.quaternion.identity();
		sceneBundle.arPlacementAnchor.scale.set( 1, 1, 1 );
		sceneBundle.arPlacementAnchor.visible = true;
		sceneBundle.arPlacementAnchor.updateMatrixWorld( true );

	}

	function clearModelWorldLock(): void {

		abortPendingWorldLock();
		deleteAnchor( modelWorldAnchor );
		modelWorldAnchor = null;
		pendingPreviousWorldLock = 'none';
		anchorPoseAvailable = true;
		anchorSeenTracked = false;
		refreshEffectiveTracking();
		setWorldLockState( 'none' );
		resetPlacementAnchorTransform();

	}

	async function prepareModelWorldLock(): Promise<XRWorldLockPreparation> {

		const session = sceneBundle.renderer.xr.getSession();
		if ( session === null || canPlaceOrCalibrate() === false || pendingWorldLockPreparation !== null ) {
			return { status: 'cancelled', requestId: modelWorldAnchorRequestId };
		}
		const requestId = ++modelWorldAnchorRequestId;

		pendingPreviousWorldLock = interactionState.worldLock;
		setWorldLockState( 'pending' );
		const result = await xrHitTest.createAnchorFromNextHit();
		if ( requestId !== modelWorldAnchorRequestId || sceneBundle.renderer.xr.getSession() !== session ) {
			if ( result.status === 'anchored' ) deleteAnchor( result.anchor );
			return { status: 'cancelled', requestId };
		}

		const preparation: XRWorldLockPreparation = result.status === 'anchored'
			? { ...result, requestId }
			: result.status === 'unsupported'
				? { status: 'unanchored', requestId }
				: result.status === 'failed'
					? { status: 'failed', requestId, error: result.error }
					: { status: result.status, requestId };

		if ( preparation.status === 'anchored' || preparation.status === 'unanchored' ) {
			pendingWorldLockPreparation = preparation;
			return preparation;
		}

		setWorldLockState( pendingPreviousWorldLock );
		return preparation;

	}

	function commitModelWorldLock(preparation: XRWorldLockPreparation): boolean {

		if (
			pendingWorldLockPreparation !== preparation
			|| interactionState.tracking !== 'normal'
			|| interactionState.visibility !== 'visible'
			|| anchorPoseAvailable === false
		) return false;
		const previousAnchor = modelWorldAnchor;
		if ( preparation.status === 'anchored' ) {
			modelWorldAnchor = preparation.anchor;
			initialAnchorPoseInverse.copy( preparation.initialPoseMatrix ).invert();
			anchorSeenTracked = false;
		} else if ( preparation.status === 'unanchored' ) {
			modelWorldAnchor = null;
		} else {
			return false;
		}

		pendingWorldLockPreparation = null;
		anchorPoseAvailable = true;
		refreshEffectiveTracking();
		resetPlacementAnchorTransform();
		setWorldLockState( preparation.status );
		if ( previousAnchor !== modelWorldAnchor ) deleteAnchor( previousAnchor );
		return true;

	}

	function cancelModelWorldLock(preparation: XRWorldLockPreparation): void {

		if ( pendingWorldLockPreparation !== preparation ) return;
		if ( preparation.status === 'anchored' ) deleteAnchor( preparation.anchor );
		pendingWorldLockPreparation = null;
		setWorldLockState( pendingPreviousWorldLock );

	}

	function updateModelWorldLock(frame: XRFrame, referenceSpace: XRReferenceSpace): void {

		if (
			modelWorldAnchor === null
			|| interactionState.worldLock === 'recalibration-required'
			|| viewerTrackingState !== 'normal'
			|| interactionState.visibility !== 'visible'
		) return;
		const trackedAnchors = ( frame as XRFrame & { trackedAnchors?: ReadonlySet<XRAnchorHandle> } ).trackedAnchors;
		if ( trackedAnchors?.has( modelWorldAnchor ) === true ) anchorSeenTracked = true;
		if ( trackedAnchors !== undefined && anchorSeenTracked && trackedAnchors.has( modelWorldAnchor ) === false ) {
			abortPendingWorldLock();
			anchorPoseAvailable = false;
			refreshEffectiveTracking();
			setWorldLockState( 'recalibration-required' );
			setStatus( '现实锚点已丢失，请重新校正；现有模型已冻结，不会自动重放。' );
			return;
		}

		const anchorPose = frame.getPose( modelWorldAnchor.anchorSpace, referenceSpace );
		if ( anchorPose === undefined || anchorPose === null ) {
			if ( anchorPoseAvailable ) {
				anchorPoseAvailable = false;
				refreshEffectiveTracking();
				setStatus( '跟踪恢复中，模型保持最后有效位置。' );
			}
			return;
		}

		if ( anchorPoseAvailable === false ) {
			anchorPoseAvailable = true;
			refreshEffectiveTracking();
			setStatus( '空间跟踪已恢复。' );
		}
		currentAnchorPose.fromArray( anchorPose.transform.matrix );
		composeWorldLockCorrection( currentAnchorPose, initialAnchorPoseInverse, worldLockCorrection )
			.decompose( worldLockPosition, worldLockQuaternion, worldLockScale );
		sceneBundle.arPlacementAnchor.position.copy( worldLockPosition );
		sceneBundle.arPlacementAnchor.quaternion.copy( worldLockQuaternion );
		sceneBundle.arPlacementAnchor.scale.copy( worldLockScale );
		sceneBundle.arPlacementAnchor.visible = true;
		sceneBundle.arPlacementAnchor.updateMatrixWorld( true );

	}

	function abortPendingWorldLock(): void {

		modelWorldAnchorRequestId += 1;
		xrHitTest.cancelPendingAnchorRequest();
		if ( pendingWorldLockPreparation?.status === 'anchored' ) deleteAnchor( pendingWorldLockPreparation.anchor );
		pendingWorldLockPreparation = null;

	}

	function canPlaceOrCalibrate(): boolean {

		return isXRSessionInteractive( getInteractionState() ) && anchorPoseAvailable;

	}

	function canPickModel(): boolean {

		return canPlaceOrCalibrate() && isHudPickingLocked() === false;

	}

	function getInteractionBlockMessage(): string | null {

		if ( interactionState.worldLock === 'recalibration-required' ) return '空间坐标发生变化，请重新校正。';
		if ( interactionState.worldLock === 'pending' ) return '正在建立现实锚点，请稍候。';
		if ( interactionState.visibility !== 'visible' || interactionState.tracking !== 'normal' || anchorPoseAvailable === false ) {
			return '跟踪恢复中，请保持设备稳定。';
		}
		return null;

	}

	const xrHitTest = createXRHitTestController( {
		renderer: sceneBundle.renderer,
		reticle: sceneBundle.reticle,
		xrButtonWrap,
		setStatus,
		onSessionStart: handleSessionStart,
		onSessionEnd: handleSessionEnd,
		canReportStatus,
		isHudPickingLocked
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
			if ( now - ( lastErrorLogAt.get( stage ) ?? 0 ) < 3000 ) return;
			lastErrorLogAt.set( stage, now );
			arError( '[XrFrameStageError]', {
				stage,
				errorName: error instanceof Error ? error.name : typeof error,
				errorMessage: error instanceof Error ? error.message : String( error ),
				errorCount: count
			} );
			setStatus( `XR 帧阶段异常：${stage}；已继续渲染。` );
		}

	}

	return {
		setup() {

			xrHitTest.setup();

		},

		dispose() {

			activeSession?.removeEventListener( 'visibilitychange', handleVisibilityChange );
			activeSession = null;
			activeReferenceSpace?.removeEventListener( 'reset', handleReferenceSpaceReset );
			activeReferenceSpace = null;
			clearModelWorldLock();
			xrHitTest.dispose();

		},

		detectSupport() {

			return detectImmersiveArSupport();

		},

		requestSession() {

			return xrHitTest.requestSession();

		},

		prepareModelWorldLock,
		commitModelWorldLock,
		cancelModelWorldLock,
		clearModelWorldLock,
		getInteractionState,
		canPlaceOrCalibrate,
		canPickModel,
		getInteractionBlockMessage,

		renderFrame(_time: number, frame?: XRFrame) {

			if ( sceneBundle.renderer.xr.isPresenting && frame ) {
				const referenceSpace = sceneBundle.renderer.xr.getReferenceSpace();
				runFrameStage( 'tracking-state', () => {
					bindReferenceSpace( referenceSpace );
					updateTrackingState( frame, referenceSpace );
				} );
				if (
					interactionState.tracking === 'normal'
					&& interactionState.visibility === 'visible'
					&& interactionState.worldLock !== 'recalibration-required'
				) runFrameStage( 'hit-test', () => xrHitTest.update( frame ) );
				if ( referenceSpace !== null ) runFrameStage( 'world-anchor', () => updateModelWorldLock( frame, referenceSpace ) );
				if ( canPlaceOrCalibrate() && sceneBundle.arModelAnchor.children.length === 0 ) {
					runFrameStage( 'auto-placement', onAttemptAutoPlacement );
				}
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

export function resolveXRTrackingState(pose: XRViewerPose | null): XRTrackingState {

	return pose === null ? 'unavailable' : pose.emulatedPosition ? 'emulated' : 'normal';

}

export function isXRSessionInteractive(state: XRInteractionState): boolean {

	return state.tracking === 'normal'
		&& state.visibility === 'visible'
		&& state.worldLock !== 'pending'
		&& state.worldLock !== 'recalibration-required';

}

export function composeWorldLockCorrection(
	currentPose: THREE.Matrix4,
	initialPoseInverse: THREE.Matrix4,
	target = new THREE.Matrix4()
): THREE.Matrix4 {

	return target.multiplyMatrices( currentPose, initialPoseInverse );

}

export function composeReferenceSpaceResetCompensation(
	currentMatrix: THREE.Matrix4,
	resetTransform: THREE.Matrix4,
	target = new THREE.Matrix4()
): THREE.Matrix4 {

	return target.copy( resetTransform ).invert().multiply( currentMatrix );

}

function normalizeVisibilityState(value: XRVisibilityState | undefined): XRSessionVisibilityState {

	return value === 'visible' || value === 'visible-blurred' ? value : 'hidden';

}

function deleteAnchor(anchor: XRAnchorHandle | null): void {

	try {
		anchor?.delete?.();
	} catch {}

}

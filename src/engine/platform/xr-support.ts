import { arWarn, arError } from '@/engine/debug/ar-logger.js';
import * as THREE from 'three';
import type {
	ArSessionStartResult,
	SetStatus,
	XRAnchorHandle,
	XRAnchorPlacementResult,
	XRHitTestController,
	XRHitTestQuality
} from '@/features/ar/types/runtime-types.js';

interface CreateXRHitTestControllerOptions {
	renderer: THREE.WebGLRenderer;
	reticle: THREE.Group;
	xrButtonWrap: HTMLElement;
	setStatus: SetStatus;
	onSessionStart?: (result: ArSessionStartResult) => void;
	onSessionEnd?: () => void;
	canReportStatus?: () => boolean;
	isHudPickingLocked?: () => boolean;
}

interface PendingAnchorRequest {
	promise: Promise<XRAnchorPlacementResult>;
	resolve(value: XRAnchorPlacementResult): void;
	timeoutId: ReturnType<typeof setTimeout> | null;
	generation: number;
	settled: boolean;
}

const reticlePosition = new THREE.Vector3();
const qualityCentroid = new THREE.Vector3();
const qualityDelta = new THREE.Vector3();
const RETICLE_PERSIST_MS = 350;
const PLACEABLE_HIT_RETENTION_MS = 1600;
const ANCHOR_CREATE_TIMEOUT_MS = 4000;
const HIT_QUALITY_WINDOW_MS = 700;
const MAX_HIT_QUALITY_SAMPLES = 24;

export interface ImmersiveArSupportInfo {
	supported: boolean;
	message: string;
}

export async function detectImmersiveArSupport(): Promise<ImmersiveArSupportInfo> {

	if ( navigator.xr === undefined ) {
		return { supported: false, message: '当前设备不支持 WebXR AR，可继续浏览模型，但无法进入 AR 会话。' };
	}
	try {
		const supported = await navigator.xr.isSessionSupported( 'immersive-ar' );
		return supported
			? { supported: true, message: '当前设备支持 WebXR AR，确认模型后即可进入现场模式。' }
			: { supported: false, message: '当前设备不支持 WebXR AR，可继续浏览模型，但无法进入 AR 会话。' };
	} catch {
		return { supported: false, message: 'AR 能力检测失败，当前无法启动 AR 会话。' };
	}

}

export function createXRHitTestController(options: CreateXRHitTestControllerOptions): XRHitTestController {

	const { renderer, reticle, xrButtonWrap, setStatus, onSessionStart, onSessionEnd, canReportStatus, isHudPickingLocked } = options;
	const domOverlayRoot = typeof document === 'undefined' ? null : document.body;
	let hitTestSource: XRHitTestSource | null = null;
	let hitTestSourceRequested = false;
	let lastSuccessfulHitTime = 0;
	let lastStableHitPosition: THREE.Vector3 | null = null;
	let anchorRequestGeneration = 0;
	let pendingAnchorRequest: PendingAnchorRequest | null = null;
	let inFlightAnchorRequest: PendingAnchorRequest | null = null;
	let recentHitSamples: Array<{ position: THREE.Vector3; time: number }> = [];
	let sessionRequestPending = false;
	let activeSession: XRSession | null = null;
	let pendingStartResult: ArSessionStartResult | null = null;

	function setup(): void {

		xrButtonWrap.replaceChildren();
		renderer.xr.addEventListener( 'sessionstart', handleSessionStart );
		renderer.xr.addEventListener( 'sessionend', handleSessionEnd );

	}

	async function handleSessionStart(): Promise<void> {

		reticle.visible = false;
		resetHitState();
		const session = renderer.xr.getSession();
		if ( session === null ) {
			return;
		}
		activeSession = session;
		domOverlayRoot?.addEventListener( 'beforexrselect', handleBeforeXRSelect );
		const startResult = pendingStartResult ?? createSessionResult( session, true, false, null );
		pendingStartResult = null;
		onSessionStart?.( startResult );
		setStatus( '已进入 AR，请缓慢移动手机，让系统持续识别地面或墙面。' );

		const viewerSpace = await session.requestReferenceSpace( 'viewer' );
		if ( session.requestHitTestSource === undefined ) {
			setStatus( '当前设备不支持 hit-test，无法识别现实平面。' );
			return;
		}
		hitTestSource = await createBestEffortHitTestSource( session, viewerSpace );
		if ( hitTestSource === null ) {
			setStatus( '未能创建 hit-test 数据源，无法识别地面或墙面。' );
			return;
		}
		hitTestSourceRequested = true;

	}

	function handleSessionEnd(): void {

		sessionRequestPending = false;
		domOverlayRoot?.removeEventListener( 'beforexrselect', handleBeforeXRSelect );
		activeSession = null;
		pendingStartResult = null;
		reticle.visible = false;
		resetHitState();
		onSessionEnd?.();
		setStatus( 'AR 会话已结束，可再次进入 AR。' );

	}

	function handleBeforeXRSelect(event: Event): void {

		if ( shouldPreventXRSelect( event.target, isHudPickingLocked?.() === true ) ) {
			event.preventDefault();
		}

	}

	function update(frame: XRFrame): void {

		if ( hitTestSourceRequested === false || hitTestSource === null ) {
			return;
		}
		const referenceSpace = renderer.xr.getReferenceSpace();
		if ( referenceSpace === null ) {
			reticle.visible = false;
			return;
		}
		const firstHit = frame.getHitTestResults( hitTestSource )[ 0 ];
		const pose = firstHit?.getPose( referenceSpace );
		if ( pose === undefined || pose === null ) {
			handleMissingHit();
			return;
		}
		lastSuccessfulHitTime = performance.now();
		reticle.visible = true;
		reticle.matrix.fromArray( pose.transform.matrix );
		reticlePosition.setFromMatrixPosition( reticle.matrix );
		lastStableHitPosition = reticlePosition.clone();
		startPendingAnchorRequest( firstHit, reticle.matrix );
		pushHitSample( reticlePosition, lastSuccessfulHitTime );
		if ( canReportStatus?.() !== false ) {
			setStatus( '已找到可用平面，可继续观察地面或墙面的命中效果。' );
		}

	}

	function handleMissingHit(): void {

		if ( reticle.visible && performance.now() - lastSuccessfulHitTime < RETICLE_PERSIST_MS ) {
			return;
		}
		reticle.visible = false;
		if ( canReportStatus?.() !== false ) {
			setStatus( '当前未命中平面，请缓慢移动手机并保持墙面或地面在视野中。' );
		}

	}

	function hasGroundHit(): boolean {

		return renderer.xr.isPresenting && ( reticle.visible || (
			lastStableHitPosition !== null && performance.now() - lastSuccessfulHitTime <= PLACEABLE_HIT_RETENTION_MS
		) );

	}

	function getHitPosition(target: THREE.Vector3): THREE.Vector3 | null {

		if ( hasGroundHit() === false ) {
			return null;
		}
		if ( reticle.visible ) {
			return target.setFromMatrixPosition( reticle.matrix );
		}
		return lastStableHitPosition === null ? null : target.copy( lastStableHitPosition );

	}

	function getHitTestQuality(): XRHitTestQuality | null {

		if ( hasGroundHit() === false ) {
			return null;
		}
		const now = performance.now();
		pruneHitSamples( now );
		if ( recentHitSamples.length === 0 ) {
			return null;
		}
		qualityCentroid.set( 0, 0, 0 );
		for ( const sample of recentHitSamples ) qualityCentroid.add( sample.position );
		qualityCentroid.divideScalar( recentHitSamples.length );
		let sumSquaredDistance = 0;
		for ( const sample of recentHitSamples ) sumSquaredDistance += qualityDelta.copy( sample.position ).sub( qualityCentroid ).lengthSq();
		return {
			sampleCount: recentHitSamples.length,
			jitterMeters: Math.sqrt( sumSquaredDistance / recentHitSamples.length ),
			ageMs: now - recentHitSamples[ recentHitSamples.length - 1 ].time
		};

	}

	function createAnchorFromNextHit(): Promise<XRAnchorPlacementResult> {

		if ( pendingAnchorRequest !== null ) return pendingAnchorRequest.promise;
		if ( inFlightAnchorRequest !== null ) return inFlightAnchorRequest.promise;
		let resolveRequest!: (value: XRAnchorPlacementResult) => void;
		const promise = new Promise<XRAnchorPlacementResult>( ( resolve ) => {
			resolveRequest = resolve;
		} );
		const request: PendingAnchorRequest = {
			promise,
			resolve: resolveRequest,
			timeoutId: null,
			generation: anchorRequestGeneration,
			settled: false
		};
		request.timeoutId = setTimeout( () => {
			finishAnchorRequest( request, { status: 'timeout' } );
		}, PLACEABLE_HIT_RETENTION_MS );
		pendingAnchorRequest = request;
		return promise;

	}

	function startPendingAnchorRequest(firstHit: XRHitTestResult, initialPoseMatrix: THREE.Matrix4): void {

		const request = pendingAnchorRequest;
		if ( request === null ) return;
		pendingAnchorRequest = null;
		if ( request.timeoutId !== null ) clearTimeout( request.timeoutId );
		request.timeoutId = setTimeout( () => {
			finishAnchorRequest( request, { status: 'timeout' } );
		}, ANCHOR_CREATE_TIMEOUT_MS );
		inFlightAnchorRequest = request;
		const result = firstHit as XRHitTestResult & { createAnchor?: () => Promise<XRAnchorHandle> };
		if ( result.createAnchor === undefined ) {
			finishAnchorRequest( request, { status: 'unsupported' } );
			return;
		}
		const initialPose = initialPoseMatrix.clone();
		try {
			const anchorPromise = result.createAnchor();
			void anchorPromise.then( ( anchor ) => {
				if ( request.settled || request.generation !== anchorRequestGeneration ) {
					try {
						anchor.delete?.();
					} catch {}
					finishAnchorRequest( request, { status: 'cancelled' } );
					return;
				}
				finishAnchorRequest( request, { status: 'anchored', anchor, initialPoseMatrix: initialPose } );
			}, ( error ) => {
				if ( request.settled === false ) {
					arWarn( '[XRAnchorPlacement]', { created: false, reason: 'createAnchor failed', error } );
				}
				finishAnchorRequest( request, isUnsupportedAnchorError( error )
					? { status: 'unsupported' }
					: { status: 'failed', error }
				);
			} );
		} catch ( error ) {
			arWarn( '[XRAnchorPlacement]', { created: false, reason: 'createAnchor failed', error } );
			finishAnchorRequest( request, isUnsupportedAnchorError( error )
				? { status: 'unsupported' }
				: { status: 'failed', error }
			);
		}

	}

	function finishAnchorRequest(request: PendingAnchorRequest, value: XRAnchorPlacementResult): void {

		if ( request.settled ) return;
		request.settled = true;
		if ( request.timeoutId !== null ) clearTimeout( request.timeoutId );
		request.timeoutId = null;
		if ( pendingAnchorRequest === request ) pendingAnchorRequest = null;
		if ( inFlightAnchorRequest === request ) inFlightAnchorRequest = null;
		request.resolve( value );

	}

	function resetHitState(): void {

		hitTestSource = null;
		hitTestSourceRequested = false;
		lastSuccessfulHitTime = 0;
		lastStableHitPosition = null;
		cancelPendingAnchorRequest();
		recentHitSamples = [];

	}

	function cancelPendingAnchorRequest(): void {

		anchorRequestGeneration += 1;
		if ( pendingAnchorRequest !== null ) finishAnchorRequest( pendingAnchorRequest, { status: 'cancelled' } );
		if ( inFlightAnchorRequest !== null ) finishAnchorRequest( inFlightAnchorRequest, { status: 'cancelled' } );

	}

	return {
		setup,
		dispose() {

			renderer.xr.removeEventListener( 'sessionstart', handleSessionStart );
			renderer.xr.removeEventListener( 'sessionend', handleSessionEnd );
			domOverlayRoot?.removeEventListener( 'beforexrselect', handleBeforeXRSelect );
			activeSession = null;
			resetHitState();

		},
		update,
		hasGroundHit,
		getHitPosition,
		getHitTestQuality,
		createAnchorFromNextHit,
		cancelPendingAnchorRequest,
		async requestSession() {

			if ( renderer.xr.isPresenting || sessionRequestPending || navigator.xr === undefined ) {
				return;
			}
			sessionRequestPending = true;
			setStatus( '正在请求 AR 会话...' );
			try {
				pendingStartResult = await requestArSession( navigator.xr );
				renderer.xr.setReferenceSpaceType( 'local' );
				await renderer.xr.setSession( pendingStartResult.session );
			} catch ( error ) {
				sessionRequestPending = false;
				pendingStartResult = null;
				arError( 'XR session request failed:', error );
				setStatus( error instanceof Error ? `AR 会话启动失败：${error.message}` : 'AR 会话启动失败。' );
			}

		}
	};

	function pushHitSample(position: THREE.Vector3, time: number): void {

		recentHitSamples.push( { position: position.clone(), time } );
		if ( recentHitSamples.length > MAX_HIT_QUALITY_SAMPLES ) recentHitSamples.splice( 0, recentHitSamples.length - MAX_HIT_QUALITY_SAMPLES );
		pruneHitSamples( time );

	}

	function pruneHitSamples(now: number): void {

		recentHitSamples = recentHitSamples.filter( ( sample ) => now - sample.time <= HIT_QUALITY_WINDOW_MS );

	}

}

export function shouldPreventXRSelect(target: EventTarget | null, hudPickingLocked: boolean): boolean {

	if ( hudPickingLocked ) return true;
	const candidate = target as { closest?: (selector: string) => Element | null } | null;
	return typeof candidate?.closest === 'function' && candidate.closest( '[data-ar-ui]' ) !== null;

}

function isUnsupportedAnchorError(error: unknown): boolean {

	return error instanceof DOMException && error.name === 'NotSupportedError';

}

async function requestArSession(xr: XRSystem): Promise<ArSessionStartResult> {

	const fallbackInit: XRSessionInit = {
		requiredFeatures: [ 'hit-test' ],
		optionalFeatures: [ 'dom-overlay', 'anchors' ],
		domOverlay: { root: document.body }
	};
	const depthInit = {
		requiredFeatures: [ 'hit-test', 'depth-sensing' ],
		optionalFeatures: [ 'dom-overlay', 'anchors' ],
		depthSensing: {
			usagePreference: [ 'cpu-optimized' ],
			dataFormatPreference: [ 'luminance-alpha' ],
			matchDepthView: true
		},
		domOverlay: { root: document.body }
	};
	try {
		return createSessionResult( await xr.requestSession( 'immersive-ar', depthInit as XRSessionInit ), true, false, null );
	} catch ( error ) {
		if ( error instanceof DOMException && error.name === 'NotSupportedError' ) {
			return createSessionResult(
				await xr.requestSession( 'immersive-ar', fallbackInit ),
				true,
				true,
				error.message || error.name
			);
		}
		throw error;
	}

}

function createSessionResult(session: XRSession, depthRequested: boolean, fallbackUsed: boolean, fallbackReason: string | null): ArSessionStartResult {

	const depthUsage = readSessionDepthUsage( session );
	return {
		session,
		depthRequested,
		depthGranted: depthUsage !== null,
		depthUsage,
		depthDataFormat: readSessionDepthFormat( session ),
		depthActive: readSessionDepthActive( session ),
		fallbackUsed,
		fallbackReason
	};

}

function readSessionDepthUsage(session: XRSession): ArSessionStartResult['depthUsage'] {

	try {
		const value = ( session as unknown as { depthUsage?: unknown } ).depthUsage;
		return value === 'cpu-optimized' ? value : null;
	} catch {
		return null;
	}

}

function readSessionDepthFormat(session: XRSession): ArSessionStartResult['depthDataFormat'] {

	try {
		const value = ( session as unknown as { depthDataFormat?: unknown } ).depthDataFormat;
		return value === 'luminance-alpha' ? value : null;
	} catch {
		return null;
	}

}

function readSessionDepthActive(session: XRSession): boolean | null {

	try {
		const value = ( session as unknown as { depthActive?: unknown } ).depthActive;
		return typeof value === 'boolean' ? value : null;
	} catch {
		return null;
	}

}

async function createBestEffortHitTestSource(session: XRSession, viewerSpace: XRReferenceSpace): Promise<XRHitTestSource | null> {

	if ( session.requestHitTestSource === undefined ) return null;
	for ( const options of [
		{ space: viewerSpace, entityTypes: [ 'plane', 'mesh', 'point' ] },
		{ space: viewerSpace, entityTypes: [ 'plane', 'point' ] },
		{ space: viewerSpace, entityTypes: [ 'plane' ] },
		{ space: viewerSpace }
	] ) {
		try {
			const source = await session.requestHitTestSource( options as unknown as XRHitTestOptionsInit );
			if ( source !== null && source !== undefined ) return source;
		} catch {
			// Try a less demanding entity type set.
		}
	}
	return null;

}

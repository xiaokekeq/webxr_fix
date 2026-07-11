import * as THREE from 'three';
import type {
	ArSessionStartResult,
	SetStatus,
	XRAnchorHandle,
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
	onSelect?: () => void;
	canReportStatus?: () => boolean;
}

const reticlePosition = new THREE.Vector3();
const reticleMatrix = new THREE.Matrix4();
const qualityCentroid = new THREE.Vector3();
const qualityDelta = new THREE.Vector3();
const RETICLE_PERSIST_MS = 350;
const PLACEABLE_HIT_RETENTION_MS = 1600;
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

	const { renderer, reticle, xrButtonWrap, setStatus, onSessionStart, onSessionEnd, onSelect, canReportStatus } = options;
	let hitTestSource: XRHitTestSource | null = null;
	let hitTestSourceRequested = false;
	let lastSuccessfulHitTime = 0;
	let lastStableHitPosition: THREE.Vector3 | null = null;
	let lastStableHitMatrix: THREE.Matrix4 | null = null;
	let lastHitTestResult: XRHitTestResult | null = null;
	let anchorSupportDetected = false;
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
		session.addEventListener( 'select', handleSelect );
		const startResult = pendingStartResult ?? createSessionResult( session, true, false, null );
		pendingStartResult = null;
		onSessionStart?.( startResult );
		console.info( '[ArSessionStarted]', {
			depthRequested: startResult.depthRequested,
			depthGranted: startResult.depthGranted,
			depthUsage: startResult.depthUsage,
			depthDataFormat: startResult.depthDataFormat,
			depthActive: startResult.depthActive,
			fallbackUsed: startResult.fallbackUsed,
			fallbackReason: startResult.fallbackReason
		} );
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
		activeSession?.removeEventListener( 'select', handleSelect );
		activeSession = null;
		pendingStartResult = null;
		reticle.visible = false;
		resetHitState();
		onSessionEnd?.();
		setStatus( 'AR 会话已结束，可再次进入 AR。' );

	}

	function handleSelect(): void {

		onSelect?.();

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
		lastHitTestResult = firstHit;
		anchorSupportDetected = typeof ( firstHit as XRHitTestResult & { createAnchor?: () => Promise<XRAnchorHandle> } ).createAnchor === 'function';
		reticle.visible = true;
		reticle.matrix.fromArray( pose.transform.matrix );
		reticleMatrix.fromArray( pose.transform.matrix );
		reticlePosition.setFromMatrixPosition( reticle.matrix );
		lastStableHitPosition = reticlePosition.clone();
		lastStableHitMatrix = reticleMatrix.clone();
		pushHitSample( reticlePosition, lastSuccessfulHitTime );
		if ( canReportStatus?.() !== false ) {
			setStatus( '已找到可用平面，可继续观察地面或墙面的命中效果。' );
		}

	}

	function handleMissingHit(): void {

		if ( reticle.visible && performance.now() - lastSuccessfulHitTime < RETICLE_PERSIST_MS ) {
			return;
		}
		lastHitTestResult = null;
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

	function getHitMatrix(target: THREE.Matrix4): THREE.Matrix4 | null {

		return lastStableHitMatrix === null ? null : target.copy( lastStableHitMatrix );

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

	function supportsAnchors(): boolean {

		return anchorSupportDetected;

	}

	async function createAnchorFromLatestHit(): Promise<XRAnchorHandle | null> {

		const result = lastHitTestResult as ( XRHitTestResult & { createAnchor?: () => Promise<XRAnchorHandle> } ) | null;
		if ( result?.createAnchor === undefined ) return null;
		try {
			return await result.createAnchor();
		} catch ( error ) {
			console.warn( '[XRAnchorPlacement]', { created: false, reason: 'createAnchor failed', error } );
			return null;
		}

	}

	function resetHitState(): void {

		hitTestSource = null;
		hitTestSourceRequested = false;
		lastSuccessfulHitTime = 0;
		lastStableHitPosition = null;
		lastStableHitMatrix = null;
		lastHitTestResult = null;
		anchorSupportDetected = false;
		recentHitSamples = [];

	}

	return {
		setup,
		update,
		hasGroundHit,
		getHitPosition,
		getHitMatrix,
		getHitTestQuality,
		supportsAnchors,
		createAnchorFromLatestHit,
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
				console.error( 'XR session request failed:', error );
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
			usagePreference: [ 'cpu-optimized', 'gpu-optimized' ],
			dataFormatPreference: [ 'luminance-alpha', 'float32', 'unsigned-short' ],
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
		return value === 'cpu-optimized' || value === 'gpu-optimized' ? value : null;
	} catch {
		return null;
	}

}

function readSessionDepthFormat(session: XRSession): ArSessionStartResult['depthDataFormat'] {

	try {
		const value = ( session as unknown as { depthDataFormat?: unknown } ).depthDataFormat;
		return value === 'luminance-alpha' || value === 'float32' || value === 'unsigned-short' ? value : null;
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

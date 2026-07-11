import * as THREE from 'three';
import type {
	SetStatus,
	ArSessionRequestMode,
	XRAnchorHandle,
	XRHitTestController,
	XRHitTestQuality
} from '@/features/ar/types/runtime-types.js';
import {
	resetDepthSensingSessionState,
	setCpuDepthEnabled,
	cpuDepthDebugState
} from '@/engine/visualization/cpu-depth-visualization.js';
import { xrFreezeHealthState } from '@/engine/platform/xr-freeze-diagnostics.js';

interface CreateXRHitTestControllerOptions {
	renderer: THREE.WebGLRenderer;
	reticle: THREE.Group;
	xrButtonWrap: HTMLElement;
	setStatus: SetStatus;
	onSessionStart?: () => void;
	onSessionEnd?: () => void;
	onSelect?: () => void;
	canReportStatus?: () => boolean;
}

interface XRDepthSensingSessionInit {
	depthSensing?: {
		usagePreference: Array<'cpu-optimized' | 'gpu-optimized'>;
		dataFormatPreference: Array<'luminance-alpha' | 'float32' | 'unsigned-short'>;
		matchDepthView?: boolean;
	};
}

interface DepthAwareSessionInit extends XRDepthSensingSessionInit {
	requiredFeatures?: string[];
	optionalFeatures?: string[];
	domOverlay?: {
		root: HTMLElement;
	};
}

interface ArSessionRequestOptions {
	mode?: ArSessionRequestMode;
	cpuDepthDebug?: boolean;
}

const reticlePosition = new THREE.Vector3();
const reticleMatrix = new THREE.Matrix4();
const qualityCentroid = new THREE.Vector3();
const qualityDelta = new THREE.Vector3();
const RETICLE_PERSIST_MS = 350;
const PLACEABLE_HIT_RETENTION_MS = 1600;
const HIT_QUALITY_WINDOW_MS = 700;
const MAX_HIT_QUALITY_SAMPLES = 24;
const ENABLE_DEPTH_IN_NORMAL_AR = import.meta.env.VITE_ENABLE_DEPTH_IN_NORMAL_AR === 'true';

export interface ImmersiveArSupportInfo {
	supported: boolean;
	message: string;
}

export async function detectImmersiveArSupport(): Promise<ImmersiveArSupportInfo> {

	if ( 'xr' in navigator === false || navigator.xr === undefined ) {
		return {
			supported: false,
			message: '当前设备不支持 WebXR AR，可继续浏览模型，但无法进入 AR 会话。'
		};
	}

	try {
		const supported = await navigator.xr.isSessionSupported( 'immersive-ar' );
		return supported
			? {
				supported: true,
				message: '当前设备支持 WebXR AR，确认模型后即可进入现场模式。'
			}
			: {
				supported: false,
				message: '当前设备不支持 WebXR AR，可继续浏览模型，但无法进入 AR 会话。'
			};
	} catch {
		return {
			supported: false,
			message: 'AR 能力检测失败，当前无法启动 AR 会话。'
		};
	}

}

export function createXRHitTestController(
	options: CreateXRHitTestControllerOptions
): XRHitTestController {

	const {
		renderer,
		reticle,
		xrButtonWrap,
		setStatus,
		onSessionStart,
		onSessionEnd,
		onSelect,
		canReportStatus
	} = options;

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
	let depthProbePending = false;
	let currentSessionMode: ArSessionRequestMode = 'normal';
	let cpuDepthFallbackWithoutDepth = false;

	function setup(): void {

		xrButtonWrap.replaceChildren();
		renderer.xr.addEventListener( 'sessionstart', handleSessionStart );
		renderer.xr.addEventListener( 'sessionend', handleSessionEnd );

	}

	async function handleSessionStart(): Promise<void> {

		onSessionStart?.();
		reticle.visible = false;
		lastSuccessfulHitTime = 0;
		lastStableHitPosition = null;
		lastStableHitMatrix = null;
		lastHitTestResult = null;
		anchorSupportDetected = false;
		recentHitSamples = [];
		setStatus( '已进入 AR，请缓慢移动手机，让系统持续识别地面或墙面。' );

		const session = renderer.xr.getSession();
		if ( session === null ) {
			return;
		}

		activeSession = session;
		session.addEventListener( 'select', handleSelect );
		document.addEventListener( 'visibilitychange', handleVisibilityChange );
		xrFreezeHealthState.sessionStartedAt = performance.now();
		xrFreezeHealthState.sessionEndedAt = null;
		xrFreezeHealthState.sessionVisibilityState = document.visibilityState ?? null;
		const depthUsage = readXrSessionProperty( session, 'depthUsage' );
		const depthDataFormat = readXrSessionProperty( session, 'depthDataFormat' );
		const depthActive = readXrSessionProperty( session, 'depthActive' );
		xrFreezeHealthState.depthRequested = currentSessionMode !== 'normal';
		xrFreezeHealthState.depthGranted = depthUsage !== undefined;
		xrFreezeHealthState.depthUsage = typeof depthUsage === 'string' ? depthUsage : null;
		xrFreezeHealthState.depthDataFormat = typeof depthDataFormat === 'string' ? depthDataFormat : null;
		xrFreezeHealthState.depthActive = typeof depthActive === 'boolean' ? depthActive : null;
		console.info( '[ArSessionStarted]', {
			diagnosticMode: xrFreezeHealthState.diagnosticMode,
			rendererProfile: xrFreezeHealthState.rendererProfile,
			requestedSessionMode: xrFreezeHealthState.requestedSessionMode,
			effectiveSessionMode: xrFreezeHealthState.effectiveSessionMode,
			fallbackUsed: xrFreezeHealthState.fallbackUsed,
			fallbackReason: xrFreezeHealthState.fallbackReason,
			mode: currentSessionMode,
			depthRequested: currentSessionMode !== 'normal',
			depthGranted: xrFreezeHealthState.depthGranted,
			depthUsage: xrFreezeHealthState.depthUsage,
			depthDataFormat: xrFreezeHealthState.depthDataFormat,
			depthActive: xrFreezeHealthState.depthActive
		} );

		// Detect CPU Depth sensing availability on session start
		resetDepthSensingSessionState();
		if ( cpuDepthFallbackWithoutDepth ) {
			cpuDepthDebugState.supported = false;
			cpuDepthDebugState.active = false;
			cpuDepthDebugState.depthSensingSessionEnabled = false;
			cpuDepthDebugState.errorMessage = '当前设备或浏览器不支持 WebXR CPU Depth。';
			cpuDepthFallbackWithoutDepth = false;
		}
		if ( currentSessionMode === 'cpu-depth-debug' ) {
			depthProbePending = true;
			console.info( '[CpuDepthSessionRequested]' );
		}

		if (
			xrFreezeHealthState.diagnosticMode === 'depth-bare-session'
			|| xrFreezeHealthState.diagnosticMode === 'depth-session-only'
		) {
			xrFreezeHealthState.hitTestRequested = false;
			xrFreezeHealthState.hitTestSourceCreated = false;
			return;
		}

		xrFreezeHealthState.hitTestRequested = true;
		const viewerSpace = await session.requestReferenceSpace( 'viewer' );
		const requestHitTestSource = session.requestHitTestSource;
		if ( requestHitTestSource === undefined ) {
			setStatus( '当前设备不支持 hit-test，无法识别现实平面。' );
			return;
		}

		hitTestSource = await createBestEffortHitTestSource( session, viewerSpace );
		if ( hitTestSource === null ) {
			setStatus( '未能创建 hit-test 数据源，无法识别地面或墙面。' );
			return;
		}

		hitTestSourceRequested = true;
		xrFreezeHealthState.hitTestSourceCreated = true;

	}

	function handleSessionEnd(): void {

		sessionRequestPending = false;
		depthProbePending = false;
		xrFreezeHealthState.sessionEndedAt = performance.now();
		xrFreezeHealthState.hitTestRequested = false;
		xrFreezeHealthState.hitTestSourceCreated = false;
		console.info( '[ArSessionEnded]', {
			diagnosticMode: xrFreezeHealthState.diagnosticMode,
			rendererProfile: xrFreezeHealthState.rendererProfile,
			requestedSessionMode: xrFreezeHealthState.requestedSessionMode,
			effectiveSessionMode: xrFreezeHealthState.effectiveSessionMode,
			visibilityState: document.visibilityState ?? null
		} );
		currentSessionMode = 'normal';
		cpuDepthFallbackWithoutDepth = false;
		setCpuDepthEnabled( false );
		resetDepthSensingSessionState();
		activeSession?.removeEventListener( 'select', handleSelect );
		document.removeEventListener( 'visibilitychange', handleVisibilityChange );
		activeSession = null;
		reticle.visible = false;
		hitTestSource = null;
		hitTestSourceRequested = false;
		lastSuccessfulHitTime = 0;
		lastStableHitPosition = null;
		lastStableHitMatrix = null;
		lastHitTestResult = null;
		anchorSupportDetected = false;
		recentHitSamples = [];
		onSessionEnd?.();
		setStatus( 'AR 会话已结束，可再次进入 AR。' );

	}

	function handleSelect(): void {

		onSelect?.();

	}

	function handleVisibilityChange(): void {

		xrFreezeHealthState.sessionVisibilityState = document.visibilityState ?? null;
		console.info( '[ArSessionVisibilityChanged]', {
			diagnosticMode: xrFreezeHealthState.diagnosticMode,
			rendererProfile: xrFreezeHealthState.rendererProfile,
			requestedSessionMode: xrFreezeHealthState.requestedSessionMode,
			effectiveSessionMode: xrFreezeHealthState.effectiveSessionMode,
			visibilityState: xrFreezeHealthState.sessionVisibilityState,
			depthRequested: xrFreezeHealthState.depthRequested,
			depthGranted: xrFreezeHealthState.depthGranted,
			depthUsage: xrFreezeHealthState.depthUsage,
			depthDataFormat: xrFreezeHealthState.depthDataFormat,
			depthActive: xrFreezeHealthState.depthActive,
			hitTestRequested: xrFreezeHealthState.hitTestRequested,
			hitTestSourceCreated: xrFreezeHealthState.hitTestSourceCreated
		} );

	}

	function update(frame: XRFrame): void {

		// One-shot depth probe: check getDepthInformation on first frame after session start
		if ( depthProbePending ) {
			depthProbePending = false;
			try {
				const hasGetDepth = typeof (
					frame as unknown as Record<string, unknown>
				).getDepthInformation === 'function';
				if ( hasGetDepth === false ) {
					cpuDepthDebugState.supported = false;
					cpuDepthDebugState.active = false;
					console.info( '[CpuDepthSessionUnsupported]', 'getDepthInformation missing.' );
				}
			} catch {
				cpuDepthDebugState.supported = false;
				cpuDepthDebugState.active = false;
				console.info( '[CpuDepthSessionUnsupported]', 'Depth probe failed.' );
			}
		}

		if ( hitTestSourceRequested === false || hitTestSource === null ) {
			return;
		}

		const referenceSpace = renderer.xr.getReferenceSpace();
		if ( referenceSpace === null ) {
			reticle.visible = false;
			return;
		}

		const hitTestResults = frame.getHitTestResults( hitTestSource );
		if ( hitTestResults.length === 0 ) {
			handleMissingHit();
			return;
		}

		const firstHit = hitTestResults[ 0 ];
		const pose = firstHit?.getPose( referenceSpace );
		if ( pose === undefined || pose === null ) {
			handleMissingHit();
			return;
		}

		lastSuccessfulHitTime = performance.now();
		lastHitTestResult = firstHit;
		anchorSupportDetected = typeof ( firstHit as XRHitTestResult & {
			createAnchor?: () => Promise<XRAnchorHandle>;
		} ).createAnchor === 'function';
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

		const elapsed = performance.now() - lastSuccessfulHitTime;
		if ( reticle.visible && elapsed < RETICLE_PERSIST_MS ) {
			return;
		}

		lastHitTestResult = null;
		reticle.visible = false;
		if ( canReportStatus?.() !== false ) {
			setStatus( '当前未命中平面，请缓慢移动手机并保持墙面或地面在视野中。' );
		}

	}

	function hasGroundHit(): boolean {

		if ( renderer.xr.isPresenting === false ) {
			return false;
		}

		if ( reticle.visible ) {
			return true;
		}

		return lastStableHitPosition !== null
			&& performance.now() - lastSuccessfulHitTime <= PLACEABLE_HIT_RETENTION_MS;

	}

	function getHitPosition(target: THREE.Vector3): THREE.Vector3 | null {

		if ( hasGroundHit() === false ) {
			return null;
		}

		if ( reticle.visible ) {
			reticlePosition.setFromMatrixPosition( reticle.matrix );
			target.copy( reticlePosition );
			return target;
		}

		if ( lastStableHitPosition === null ) {
			return null;
		}

		target.copy( lastStableHitPosition );
		return target;

	}

	function getHitMatrix(target: THREE.Matrix4): THREE.Matrix4 | null {

		if ( lastStableHitMatrix === null ) {
			return null;
		}

		target.copy( lastStableHitMatrix );
		return target;

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
		for ( const sample of recentHitSamples ) {
			qualityCentroid.add( sample.position );
		}
		qualityCentroid.divideScalar( recentHitSamples.length );

		let sumSquaredDistance = 0;
		for ( const sample of recentHitSamples ) {
			sumSquaredDistance += qualityDelta
				.copy( sample.position )
				.sub( qualityCentroid )
				.lengthSq();
		}

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

		const hitResultWithAnchor = lastHitTestResult as ( XRHitTestResult & {
			createAnchor?: () => Promise<XRAnchorHandle>;
		} ) | null;
		if ( hitResultWithAnchor?.createAnchor === undefined ) {
			return null;
		}

		try {
			return await hitResultWithAnchor.createAnchor();
		} catch ( error ) {
			console.warn( '[XRAnchorPlacement]', {
				created: false,
				reason: 'createAnchor failed',
				error
			} );
			return null;
		}

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
		async requestSession(options: ArSessionRequestOptions = {}) {

			if ( renderer.xr.isPresenting || sessionRequestPending ) {
				return;
			}

			if ( navigator.xr === undefined ) {
				setStatus( '当前设备未提供 WebXR 接口。' );
				return;
			}

			sessionRequestPending = true;
			const requestedMode = options.mode ?? ( options.cpuDepthDebug ? 'cpu-depth-debug' : 'normal' );
			currentSessionMode = requestedMode === 'normal' && shouldRequestDepthForCurrentDiagnostic()
				? 'normal-with-depth'
				: requestedMode;
			xrFreezeHealthState.requestedSessionMode = currentSessionMode;
			xrFreezeHealthState.effectiveSessionMode = currentSessionMode;
			xrFreezeHealthState.fallbackUsed = false;
			xrFreezeHealthState.fallbackReason = null;
			setStatus( '正在请求 AR 会话...' );
			console.info( '[ArSessionRequested]', {
				diagnosticMode: xrFreezeHealthState.diagnosticMode,
				rendererProfile: xrFreezeHealthState.rendererProfile,
				requestedSessionMode: currentSessionMode
			} );

			try {
				const requestedSession = await requestArSession( navigator.xr, {
					mode: currentSessionMode,
					cpuDepthDebug: currentSessionMode === 'cpu-depth-debug'
				} );
				cpuDepthFallbackWithoutDepth = currentSessionMode === 'cpu-depth-debug'
					&& requestedSession.mode === 'normal';
				currentSessionMode = requestedSession.mode;
				xrFreezeHealthState.effectiveSessionMode = currentSessionMode;
				renderer.xr.setReferenceSpaceType( 'local' );
				await renderer.xr.setSession( requestedSession.session );
			} catch ( error ) {
				sessionRequestPending = false;
				currentSessionMode = 'normal';
				console.error( 'XR session request failed:', error );
				setStatus(
					error instanceof Error
						? `AR 会话启动失败：${error.message}`
						: 'AR 会话启动失败。'
				);
			}

		}
	};

	function pushHitSample(position: THREE.Vector3, time: number): void {

		recentHitSamples.push( {
			position: position.clone(),
			time
		} );

		if ( recentHitSamples.length > MAX_HIT_QUALITY_SAMPLES ) {
			recentHitSamples.splice( 0, recentHitSamples.length - MAX_HIT_QUALITY_SAMPLES );
		}

		pruneHitSamples( time );

	}

	function pruneHitSamples(now: number): void {

		recentHitSamples = recentHitSamples.filter(
			( sample ) => now - sample.time <= HIT_QUALITY_WINDOW_MS
		);

	}

}

/**
 * 单次请求 AR 会话。
 *
 * 关键：immersive-ar 的 requestSession 一旦调用就会让浏览器进入沉浸态，
 * 且 WebXR 没有取消 API。因此绝不能用超时 race 去“放弃”一个请求，
 * 否则会产生占用摄像头却无渲染循环驱动的“孤儿 session”，直接导致画面卡死。
 *
 * 默认普通 AR 不请求 depth；depth 只在 normal-with-depth 或 cpu-depth-debug 请求。
 * 这样 depth 接入未完成时不会拖垮正式 AR 帧循环。
 */
async function requestArSession(
	xr: XRSystem,
	options: ArSessionRequestOptions = {}
): Promise<{ session: XRSession; mode: ArSessionRequestMode }> {

	const mode = options.mode ?? ( options.cpuDepthDebug ? 'cpu-depth-debug' : 'normal' );

	const normalInit = {
		requiredFeatures: [ 'hit-test' ],
		optionalFeatures: [ 'dom-overlay', 'anchors' ],
		domOverlay: { root: document.body }
	};
	const normalDepthInit = {
		requiredFeatures: [ 'hit-test', 'depth-sensing' ],
		optionalFeatures: [ 'dom-overlay', 'anchors' ],
		depthSensing: {
			usagePreference: [ 'cpu-optimized', 'gpu-optimized' ],
			dataFormatPreference: [ 'luminance-alpha', 'float32' ],
			matchDepthView: true
		},
		domOverlay: { root: document.body }
	};
	const depthSessionOnlyInit = {
		requiredFeatures: [ 'depth-sensing' ],
		optionalFeatures: [ 'dom-overlay' ],
		depthSensing: {
			usagePreference: [ 'cpu-optimized' ],
			dataFormatPreference: [ 'luminance-alpha', 'float32' ],
			matchDepthView: true
		},
		domOverlay: { root: document.body }
	};
	const depthBareSessionInit = {
		requiredFeatures: [ 'depth-sensing' ],
		optionalFeatures: [],
		depthSensing: {
			usagePreference: [ 'cpu-optimized' ],
			dataFormatPreference: [ 'luminance-alpha', 'float32' ],
			matchDepthView: true
		}
	};

	if ( mode === 'normal' ) {
		console.info( '[ArSessionRequestedNormal]' );
		return {
			session: await xr.requestSession( 'immersive-ar', normalInit as XRSessionInit ),
			mode: 'normal'
		};
	}

	if ( mode === 'normal-with-depth' ) {
		console.info( '[ArSessionRequestedNormalWithDepth]' );
		const init = xrFreezeHealthState.diagnosticMode === 'depth-bare-session'
			? depthBareSessionInit
			: xrFreezeHealthState.diagnosticMode === 'depth-session-only'
				? depthSessionOnlyInit
				: normalDepthInit;
		try {
			return {
				session: await xr.requestSession( 'immersive-ar', init as XRSessionInit ),
				mode: 'normal-with-depth'
			};
		} catch ( error ) {
			if ( error instanceof DOMException && error.name === 'NotSupportedError' ) {
				console.warn( '[ArSessionDepthNotSupportedFallbackWithoutDepth]', {
					reason: error.message
				} );
				xrFreezeHealthState.fallbackUsed = true;
				xrFreezeHealthState.fallbackReason = error.message || error.name;
				return {
					session: await xr.requestSession( 'immersive-ar', normalInit as XRSessionInit ),
					mode: 'normal'
				};
			}
			throw error;
		}
	}

	const depthInit = {
		requiredFeatures: [ 'hit-test', 'depth-sensing' ],
		optionalFeatures: [ 'dom-overlay', 'anchors' ],
		depthSensing: {
			usagePreference: [ 'cpu-optimized' ],
			dataFormatPreference: [ 'luminance-alpha', 'float32' ],
			matchDepthView: true
		},
		domOverlay: { root: document.body }
	};

	try {
		console.info( '[ArSessionRequestedCpuDepthDebug]' );
		return {
			session: await xr.requestSession( 'immersive-ar', depthInit as XRSessionInit ),
			mode: 'cpu-depth-debug'
		};
	} catch ( error ) {
		if ( error instanceof DOMException && error.name === 'NotSupportedError' ) {
			// depth 配置被同步拒绝（不会创建 session），可安全降级重试
			setCpuDepthEnabled( false );
			cpuDepthDebugState.supported = false;
			cpuDepthDebugState.active = false;
			cpuDepthDebugState.depthSensingSessionEnabled = false;
			cpuDepthDebugState.errorMessage = '当前设备或浏览器不支持 WebXR CPU Depth。';
			console.info( '[CpuDepthSessionFallbackWithoutDepth]' );
			xrFreezeHealthState.fallbackUsed = true;
			xrFreezeHealthState.fallbackReason = error.message || error.name;
			return {
				session: await xr.requestSession( 'immersive-ar', normalInit as XRSessionInit ),
				mode: 'normal'
			};
		}
		throw error;
	}

}

function shouldRequestDepthForCurrentDiagnostic(): boolean {

	return ENABLE_DEPTH_IN_NORMAL_AR || xrFreezeHealthState.diagnosticMode !== 'baseline';

}

function readXrSessionProperty(session: XRSession, key: string): unknown {

	try {
		return ( session as unknown as Record<string, unknown> )[ key ];
	} catch {
		return undefined;
	}

}

async function createBestEffortHitTestSource(
	session: XRSession,
	viewerSpace: XRReferenceSpace
): Promise<XRHitTestSource | null> {

	const requestHitTestSource = session.requestHitTestSource;
	if ( requestHitTestSource === undefined ) {
		return null;
	}

	const optionVariants: Array<Record<string, unknown>> = [
		{ space: viewerSpace, entityTypes: [ 'plane', 'mesh', 'point' ] },
		{ space: viewerSpace, entityTypes: [ 'plane', 'point' ] },
		{ space: viewerSpace, entityTypes: [ 'plane' ] },
		{ space: viewerSpace }
	];

	for ( const options of optionVariants ) {
		try {
			const source = await requestHitTestSource.call( session, options as unknown as XRHitTestOptionsInit );
			if ( source !== undefined && source !== null ) {
				return source;
			}
		} catch {
			// Try the next less-demanding option set.
		}
	}

	return null;

}



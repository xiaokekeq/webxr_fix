import * as THREE from 'three';
import type {
	SetStatus,
	XRAnchorHandle,
	XRHitTestController,
	XRHitTestQuality
} from '@/features/ar/types/runtime-types.js';
import {
	markDepthSensingSessionEnabled,
	resetDepthSensingSessionState,
	cpuDepthDebugState,
	pushDepthSessionLog
} from '@/engine/visualization/cpu-depth-visualization.js';

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
	};
}

interface DepthAwareSessionInit extends XRDepthSensingSessionInit {
	requiredFeatures?: string[];
	optionalFeatures?: string[];
	domOverlay?: {
		root: HTMLElement;
	};
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

		// Detect CPU Depth sensing availability on session start
		resetDepthSensingSessionState();
		try {
			const hasDepthApi = typeof (
				session as unknown as Record<string, unknown>
			).hasDepthSensing === 'boolean'
				? ( session as unknown as Record<string, boolean> ).hasDepthSensing
				: undefined;

			if ( hasDepthApi === true ) {
				markDepthSensingSessionEnabled();
			} else {
				// Fallback: probe XRFrame for getDepthInformation on first frame
				// (handled via onDepthSensingProbe in update())
				depthProbePending = true;
			}
		} catch {
			// silently ignore
		}

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

	}

	function handleSessionEnd(): void {

		sessionRequestPending = false;
		depthProbePending = false;
		resetDepthSensingSessionState();
		activeSession?.removeEventListener( 'select', handleSelect );
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

	function update(frame: XRFrame): void {

		// One-shot depth probe: check getDepthInformation on first frame after session start
		if ( depthProbePending ) {
			depthProbePending = false;
			try {
				const hasGetDepth = typeof (
					frame as unknown as Record<string, unknown>
				).getDepthInformation === 'function';
				if ( hasGetDepth ) {
					markDepthSensingSessionEnabled();
				} else {
					cpuDepthDebugState.supported = false;
					console.info( '[CpuDepthSessionUnsupported]', 'getDepthInformation not available in current AR session.' );
				}
			} catch {
				cpuDepthDebugState.supported = false;
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
		async requestSession() {

			if ( renderer.xr.isPresenting || sessionRequestPending ) {
				return;
			}

			if ( navigator.xr === undefined ) {
				setStatus( '当前设备未提供 WebXR 接口。' );
				return;
			}

			sessionRequestPending = true;
			setStatus( '正在请求 AR 会话...' );

			try {
				const session = await tryMultipleDepthFormats( navigator.xr );
				renderer.xr.setReferenceSpaceType( 'local' );
				await renderer.xr.setSession( session );
			} catch ( error ) {
				sessionRequestPending = false;
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

const DEPTH_TIMEOUT_MS = 3000;

function withTimeout<T>( p: Promise<T>, ms: number, label: string ): Promise<T> {
	return Promise.race( [
		p,
		new Promise<never>( ( _, rej ) => setTimeout( () => rej( new Error( label + ' timeout' ) ), ms ) )
	] );
}

async function tryMultipleDepthFormats( xr: XRSystem ): Promise<XRSession> {

	// 配置 1: depthSensing (最新规范) + domOverlay
	const configs: Array<{ label: string; init: Record<string, unknown> }> = [
		{
			label: 'depthSensing + domOverlay',
			init: {
				requiredFeatures: [ 'hit-test' ],
				optionalFeatures: [ 'dom-overlay', 'anchors', 'depth-sensing' ],
				depthSensing: {
					usagePreference: [ 'cpu-optimized' ],
					dataFormatPreference: [ 'luminance-alpha', 'float32' ]
				},
				domOverlay: { root: document.body }
			}
		},
		{
			label: 'depthSensing 无 domOverlay',
			init: {
				requiredFeatures: [ 'hit-test' ],
				optionalFeatures: [ 'anchors', 'depth-sensing' ],
				depthSensing: {
					usagePreference: [ 'cpu-optimized' ],
					dataFormatPreference: [ 'luminance-alpha', 'float32' ]
				}
			}
		},
		{
			label: 'depthState (旧规范) + domOverlay',
			init: {
				requiredFeatures: [ 'hit-test' ],
				optionalFeatures: [ 'dom-overlay', 'anchors', 'depth-sensing' ],
				depthState: {
					usagePreference: [ 'cpu-optimized' ],
					dataFormatPreference: [ 'luminance-alpha', 'float32' ]
				},
				domOverlay: { root: document.body }
			}
		},
		{
			label: 'plain (无 depth)',
			init: {
				requiredFeatures: [ 'hit-test' ],
				optionalFeatures: [ 'dom-overlay', 'anchors' ],
				domOverlay: { root: document.body }
			}
		}
	];

	for ( const cfg of configs ) {
		try {
			pushDepthSessionLog( '尝试: ' + cfg.label );
			const session = await withTimeout(
				xr.requestSession( 'immersive-ar', cfg.init as XRSessionInit ),
				DEPTH_TIMEOUT_MS,
				cfg.label
			);
			pushDepthSessionLog( '✓ 成功: ' + cfg.label );
			return session;
		} catch ( err ) {
			pushDepthSessionLog( '✗ 失败: ' + cfg.label + ' (' + ( err instanceof Error ? err.message : 'unknown' ) + ')' );
		}
	}

	pushDepthSessionLog( '✗ 所有配置均失败' );
	throw new Error( '所有 AR session 配置均失败' );

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



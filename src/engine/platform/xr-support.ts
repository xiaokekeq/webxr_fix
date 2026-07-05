import * as THREE from 'three';
import type {
	SetStatus,
	XRAnchorHandle,
	XRHitTestController,
	XRHitTestQuality,
	XrImageTrackingState,
	XrSessionRequestOptions
} from '@/features/ar/types/runtime-types.js';

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
	trackedImages?: XRTrackedImageInit[];
}

interface XRTrackedImageInit {
	image: ImageBitmap;
	widthInMeters: number;
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
	let trackedImageTargetIds: string[] = [];
	let imageTrackingState: XrImageTrackingState = {
		requested: false,
		supported: false,
		active: false,
		reason: 'idle'
	};

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
		imageTrackingState = {
			...imageTrackingState,
			active: imageTrackingState.requested && imageTrackingState.supported,
			reason: imageTrackingState.requested
				? imageTrackingState.supported
					? 'session-active'
					: imageTrackingState.reason
				: 'idle'
		};
		setStatus( '已进入 AR，请缓慢移动手机，让系统持续识别地面或墙面。' );

		const session = renderer.xr.getSession();
		if ( session === null ) {
			return;
		}

		activeSession = session;
		session.addEventListener( 'select', handleSelect );

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
		trackedImageTargetIds = [];
		imageTrackingState = {
			requested: false,
			supported: false,
			active: false,
			reason: 'session-ended'
		};
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

	function getImageTrackingState(): XrImageTrackingState {

		return { ...imageTrackingState };

	}

	function getTrackedImageTargetId(index: number): string | null {

		if ( index < 0 || index >= trackedImageTargetIds.length ) {
			return null;
		}

		return trackedImageTargetIds[ index ] ?? null;

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
		getImageTrackingState,
		getTrackedImageTargetId,
		async requestSession(options?: XrSessionRequestOptions) {

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
				const trackedImageResources = await resolveTrackedImageResources( options?.trackedImages ?? [] );
				const shouldAttemptImageTracking = trackedImageResources.trackedImages.length > 0;
				console.info( '[AutoMarkerImageTrackingRequested]', {
					requestedTargetsCount: options?.trackedImages?.length ?? 0,
					trackedImagesCount: trackedImageResources.trackedImages.length,
					targetIds: trackedImageResources.targetIds,
					reason: trackedImageResources.reason
				} );
				trackedImageTargetIds = trackedImageResources.targetIds;
				imageTrackingState = {
					requested: ( options?.trackedImages?.length ?? 0 ) > 0,
					supported: shouldAttemptImageTracking,
					active: false,
					reason: shouldAttemptImageTracking
						? 'requesting'
						: ( options?.trackedImages?.length ?? 0 ) > 0
							? trackedImageResources.reason
							: 'idle'
				};
				let session: XRSession;
				const imageTrackingSessionInit = createSessionInit( trackedImageResources.trackedImages );
				console.info( '[AutoMarkerImageTrackingSessionInit]', {
					optionalFeatures: imageTrackingSessionInit.optionalFeatures ?? [],
					hasImageTrackingFeature: ( imageTrackingSessionInit.optionalFeatures ?? [] ).includes( 'image-tracking' ),
					trackedImagesCount: trackedImageResources.trackedImages.length,
					targetIds: trackedImageResources.targetIds
				} );

				try {
					session = await navigator.xr.requestSession(
						'immersive-ar',
						imageTrackingSessionInit
					);
					imageTrackingState = {
						...imageTrackingState,
						supported: shouldAttemptImageTracking,
						active: shouldAttemptImageTracking,
						reason: shouldAttemptImageTracking ? 'enabled' : imageTrackingState.reason
					};
				} catch ( error ) {
					if ( shouldAttemptImageTracking === false ) {
						throw error;
					}

					console.warn( '[AutoMarkerImageTrackingUnsupported]', {
						trackedImagesCount: trackedImageResources.trackedImages.length,
						targetIds: trackedImageResources.targetIds,
						reason: 'request-session-failed',
						error
					} );
					trackedImageTargetIds = [];
					imageTrackingState = {
						requested: true,
						supported: false,
						active: false,
						reason: 'unsupported'
					};
					const fallbackSessionInit = createSessionInit();
					console.info( '[AutoMarkerImageTrackingSessionInit]', {
						optionalFeatures: fallbackSessionInit.optionalFeatures ?? [],
						hasImageTrackingFeature: ( fallbackSessionInit.optionalFeatures ?? [] ).includes( 'image-tracking' ),
						trackedImagesCount: 0,
						targetIds: []
					} );
					session = await navigator.xr.requestSession(
						'immersive-ar',
						fallbackSessionInit
					);
				}
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

function createSessionInit(trackedImages?: XRTrackedImageInit[]): DepthAwareSessionInit {

	const sessionInit: DepthAwareSessionInit = {
		requiredFeatures: [ 'hit-test' ],
		optionalFeatures: [ 'dom-overlay', 'anchors' ],
		domOverlay: { root: document.body }
	};
	if ( trackedImages !== undefined && trackedImages.length > 0 ) {
		sessionInit.optionalFeatures = [ ...( sessionInit.optionalFeatures ?? [] ), 'image-tracking' ];
		sessionInit.trackedImages = trackedImages;
	}

	return sessionInit;

}

async function resolveTrackedImageResources(
	definitions: NonNullable<XrSessionRequestOptions['trackedImages']>
): Promise<{
	trackedImages: XRTrackedImageInit[];
	targetIds: string[];
	reason: string;
}> {

	if ( definitions.length === 0 ) {
		console.info( '[AutoMarkerTrackedImagesEmpty]', {
			siteId: null,
			markerId: null,
			patternUrl: null,
			trackingWidthMeters: null,
			sizeMeters: null,
			imageLoaded: false,
			trackedImagesCount: 0,
			reason: 'no-targets'
		} );
		return {
			trackedImages: [],
			targetIds: [],
			reason: 'no-targets'
		};
	}

	if ( typeof createImageBitmap !== 'function' ) {
		const firstDefinition = definitions[ 0 ];
		console.info( '[AutoMarkerTrackedImagesEmpty]', {
			siteId: firstDefinition?.siteId ?? null,
			markerId: firstDefinition?.markerId ?? firstDefinition?.targetId ?? null,
			patternUrl: firstDefinition?.patternUrl ?? firstDefinition?.imageUrl ?? null,
			trackingWidthMeters: firstDefinition?.trackingWidthMeters ?? firstDefinition?.widthInMeters ?? null,
			sizeMeters: firstDefinition?.sizeMeters ?? null,
			imageLoaded: false,
			trackedImagesCount: 0,
			reason: 'create-image-bitmap-unavailable'
		} );
		return {
			trackedImages: [],
			targetIds: [],
			reason: 'create-image-bitmap-unavailable'
		};
	}

	const trackedImages: XRTrackedImageInit[] = [];
	const targetIds: string[] = [];

	for ( const definition of definitions ) {
		console.info( '[AutoMarkerTrackedImagesPreparing]', {
			siteId: definition.siteId ?? null,
			markerId: definition.markerId ?? definition.targetId,
			patternUrl: definition.patternUrl ?? definition.imageUrl,
			trackingWidthMeters: definition.trackingWidthMeters ?? definition.widthInMeters,
			sizeMeters: definition.sizeMeters ?? null,
			imageLoaded: false,
			trackedImagesCount: trackedImages.length
		} );
		try {
			const response = await fetch( definition.imageUrl );
			if ( response.ok === false ) {
				throw new Error( `HTTP ${response.status}` );
			}

			const blob = await response.blob();
			const image = await createImageBitmap( blob );
			trackedImages.push( {
				image,
				widthInMeters: definition.widthInMeters
			} );
			targetIds.push( definition.targetId );
			console.info( '[AutoMarkerTrackedImageLoaded]', {
				siteId: definition.siteId ?? null,
				markerId: definition.markerId ?? definition.targetId,
				patternUrl: definition.patternUrl ?? definition.imageUrl,
				trackingWidthMeters: definition.trackingWidthMeters ?? definition.widthInMeters,
				sizeMeters: definition.sizeMeters ?? null,
				imageLoaded: true,
				trackedImagesCount: trackedImages.length
			} );
		} catch ( error ) {
			console.warn( '[AutoMarkerImageLoadFailed]', {
				siteId: definition.siteId ?? null,
				markerId: definition.markerId ?? definition.targetId,
				patternUrl: definition.patternUrl ?? definition.imageUrl,
				trackingWidthMeters: definition.trackingWidthMeters ?? definition.widthInMeters,
				sizeMeters: definition.sizeMeters ?? null,
				imageLoaded: false,
				trackedImagesCount: trackedImages.length,
				error
			} );
		}
	}

	if ( trackedImages.length === 0 ) {
		const firstDefinition = definitions[ 0 ];
		console.info( '[AutoMarkerTrackedImagesEmpty]', {
			siteId: firstDefinition?.siteId ?? null,
			markerId: firstDefinition?.markerId ?? firstDefinition?.targetId ?? null,
			patternUrl: firstDefinition?.patternUrl ?? firstDefinition?.imageUrl ?? null,
			trackingWidthMeters: firstDefinition?.trackingWidthMeters ?? firstDefinition?.widthInMeters ?? null,
			sizeMeters: firstDefinition?.sizeMeters ?? null,
			imageLoaded: false,
			trackedImagesCount: 0,
			reason: 'image-load-failed'
		} );
	} else {
		console.info( '[AutoMarkerTrackedImagesReady]', {
			siteId: definitions[ 0 ]?.siteId ?? null,
			markerId: null,
			patternUrl: null,
			trackingWidthMeters: null,
			sizeMeters: null,
			imageLoaded: true,
			trackedImagesCount: trackedImages.length,
			targetIds
		} );
	}

	return {
		trackedImages,
		targetIds,
		reason: trackedImages.length > 0 ? 'ready' : 'image-load-failed'
	};

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



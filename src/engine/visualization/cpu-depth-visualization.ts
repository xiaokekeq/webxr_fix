/**
 * CPU Depth Debug Visualization
 *
 * Standalone debug module for WebXR CPU Depth sensing.
 * - Reads CPU depth each frame (when enabled)
 * - Generates a low-res heatmap overlay
 * - Does NOT participate in registration, placement, or X-Ray logic
 */
import { reactive } from 'vue';

// ---------------------------------------------------------------------------
// Public state interface
// ---------------------------------------------------------------------------

export interface CpuDepthDebugState {
	enabled: boolean;
	supported: boolean | 'unknown';
	active: boolean;
	width?: number;
	height?: number;
	centerDepth?: number;
	minDepth?: number;
	maxDepth?: number;
	validSampleCount?: number;
	lastUpdatedAt?: number;
	errorMessage?: string;
	depthSensingSessionEnabled: boolean;
	sessionLog: string[];
}

// ---------------------------------------------------------------------------
// Sampling constants
// ---------------------------------------------------------------------------

const SAMPLE_WIDTH = 64;
const SAMPLE_HEIGHT = 48;
const NEAR_METERS = 0.3;
const FAR_METERS = 8.0;
const UPDATE_INTERVAL_MS = 150;           // ~7 fps UI refresh
const CONSECUTIVE_FAILURE_LIMIT = 60;      // auto-close after N bad frames
const LOG_THROTTLE_MS = 3_000;

// ---------------------------------------------------------------------------
// Reactive state (imported directly by Vue components)
// ---------------------------------------------------------------------------

function buildDefaultState(): CpuDepthDebugState {
	return {
		enabled: false,
		supported: 'unknown',
		active: false,
		depthSensingSessionEnabled: false,
		sessionLog: []
	};
}

export const cpuDepthDebugState = reactive<CpuDepthDebugState>( buildDefaultState() );

export function pushDepthSessionLog( msg: string ): void {
	const ts = new Date().toLocaleTimeString();
	cpuDepthDebugState.sessionLog = [ ...cpuDepthDebugState.sessionLog, `[${ts}] ${msg}` ].slice( -12 );
	console.info( '[CpuDepthUI]', msg );
}

// ---------------------------------------------------------------------------
// Offscreen heatmap canvas
// ---------------------------------------------------------------------------

const heatmapCanvas = document.createElement( 'canvas' );
heatmapCanvas.width = SAMPLE_WIDTH;
heatmapCanvas.height = SAMPLE_HEIGHT;
const heatmapCtx = heatmapCanvas.getContext( '2d' )!;

export function getHeatmapCanvas(): HTMLCanvasElement {
	return heatmapCanvas;
}

// ---------------------------------------------------------------------------
// Internal bookkeeping
// ---------------------------------------------------------------------------

let lastUpdateTime = 0;
let lastLogTime = 0;
let consecutiveFailures = 0;

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

export function setCpuDepthEnabled( enabled: boolean ): void {
	cpuDepthDebugState.enabled = enabled;
	if ( enabled ) {
		consecutiveFailures = 0;
		lastUpdateTime = 0;
	} else {
		resetDepthData();
	}
}

export function markDepthSensingSessionEnabled(): void {
	cpuDepthDebugState.depthSensingSessionEnabled = true;
	cpuDepthDebugState.supported = true;
	throttledLog( 'CpuDepthSessionEnabled', 'CPU Depth sensing is active in current AR session.' );
}

export function resetDepthSensingSessionState(): void {
	cpuDepthDebugState.depthSensingSessionEnabled = false;
	cpuDepthDebugState.supported = 'unknown';
	cpuDepthDebugState.active = false;
	resetDepthData();
}

// ---------------------------------------------------------------------------
// Per-frame entry point (called from ThreeEngine onFrameUpdate)
// ---------------------------------------------------------------------------

export function updateCpuDepthFromFrame(
	frame: XRFrame | undefined,
	referenceSpace: XRReferenceSpace | null
): void {

	if ( cpuDepthDebugState.enabled === false ) {
		return;
	}

	if ( cpuDepthDebugState.depthSensingSessionEnabled === false ) {
		return;
	}

	if ( frame === undefined || referenceSpace === null ) {
		return;
	}

	// Throttle UI updates
	const now = performance.now();
	if ( now - lastUpdateTime < UPDATE_INTERVAL_MS ) {
		return;
	}

	const getDepthInformation = ( frame as unknown as Record<string, unknown> ).getDepthInformation;
	if ( typeof getDepthInformation !== 'function' ) {
		throttledLog( 'CpuDepthApiMissing', 'frame.getDepthInformation is not available.' );
		cpuDepthDebugState.supported = false;
		cpuDepthDebugState.errorMessage = '当前 AR 会话未提供 getDepthInformation API。';
		return;
	}

	try {
		const pose = frame.getViewerPose( referenceSpace ) as XRViewerPose | undefined;
		if ( pose === undefined || pose === null ) {
			return;
		}

		let depthInfo: XRCPUDepthInformation | null = null;
		for ( const view of pose.views ) {
			try {
				const info = getDepthInformation.call( frame, view ) as XRCPUDepthInformation | undefined;
				if ( info !== undefined && info !== null ) {
					depthInfo = info;
					break;
				}
			} catch {
				// view-level failure, try next view
			}
		}

		if ( depthInfo === null ) {
			throttledLog( 'CpuDepthFrameUnavailable', 'No depth information available this frame.' );
			consecutiveFailures += 1;
			checkFailureLimit();
			return;
		}

		consecutiveFailures = 0;
		sampleDepthData( depthInfo );
		lastUpdateTime = now;
		cpuDepthDebugState.lastUpdatedAt = now;
		cpuDepthDebugState.active = true;

	} catch ( error ) {
		throttledLog(
			'CpuDepthReadFailed',
			error instanceof Error ? error.message : 'Unknown depth read error.'
		);
		consecutiveFailures += 1;
		checkFailureLimit();
	}
}

// ---------------------------------------------------------------------------
// Depth sampling
// ---------------------------------------------------------------------------

function sampleDepthData( depthInfo: XRCPUDepthInformation ): void {

	const width = depthInfo.width ?? SAMPLE_WIDTH;
	const height = depthInfo.height ?? SAMPLE_HEIGHT;

	let minDepth = Infinity;
	let maxDepth = -Infinity;
	let centerDepth: number | undefined;
	let validCount = 0;

	const imageData = heatmapCtx.createImageData( SAMPLE_WIDTH, SAMPLE_HEIGHT );

	for ( let y = 0; y < SAMPLE_HEIGHT; y++ ) {
		for ( let x = 0; x < SAMPLE_WIDTH; x++ ) {
			const u = ( x + 0.5 ) / SAMPLE_WIDTH;
			const v = ( y + 0.5 ) / SAMPLE_HEIGHT;

			let depth: number | undefined;
			try {
				depth = depthInfo.getDepthInMeters( u, v ) as number | undefined;
			} catch {
				depth = undefined;
			}

			const pixelIndex = ( y * SAMPLE_WIDTH + x ) * 4;

			if (
				depth === undefined
				|| depth === null
				|| Number.isNaN( depth )
				|| !Number.isFinite( depth )
				|| depth <= 0
			) {
				// invalid -> transparent black
				imageData.data[ pixelIndex ] = 0;
				imageData.data[ pixelIndex + 1 ] = 0;
				imageData.data[ pixelIndex + 2 ] = 0;
				imageData.data[ pixelIndex + 3 ] = 0;
				continue;
			}

			validCount += 1;
			if ( depth < minDepth ) minDepth = depth;
			if ( depth > maxDepth ) maxDepth = depth;

			// Centre sample
			if (
				centerDepth === undefined
				&& Math.abs( x - SAMPLE_WIDTH / 2 ) < 2
				&& Math.abs( y - SAMPLE_HEIGHT / 2 ) < 2
			) {
				centerDepth = depth;
			}

			const t = clamp01( ( depth - NEAR_METERS ) / ( FAR_METERS - NEAR_METERS ) );
			const [ r, g, b ] = depthToRgb( t );
			imageData.data[ pixelIndex ] = r;
			imageData.data[ pixelIndex + 1 ] = g;
			imageData.data[ pixelIndex + 2 ] = b;
			imageData.data[ pixelIndex + 3 ] = 210;
		}
	}

	heatmapCtx.putImageData( imageData, 0, 0 );

	throttledLog(
		'CpuDepthFrameAvailable',
		`depth ${width}x${height}, valid=${validCount}, center=${centerDepth?.toFixed( 2 ) ?? '-'}`
	);

	if ( centerDepth !== undefined ) {
		throttledLog(
			'CpuDepthCenterSampled',
			`centerDepth=${centerDepth.toFixed( 3 )}m`
		);
	}

	cpuDepthDebugState.width = width;
	cpuDepthDebugState.height = height;
	cpuDepthDebugState.centerDepth = centerDepth;
	cpuDepthDebugState.minDepth = minDepth === Infinity ? undefined : minDepth;
	cpuDepthDebugState.maxDepth = maxDepth === -Infinity ? undefined : maxDepth;
	cpuDepthDebugState.validSampleCount = validCount;
}

// ---------------------------------------------------------------------------
// Color mapping: near=red/yellow, mid=green/cyan, far=blue/purple
// ---------------------------------------------------------------------------

function depthToRgb( t: number ): [ number, number, number ] {
	// 5-stop gradient
	if ( t < 0.25 ) {
		const s = t / 0.25;
		return [ 255, Math.round( s * 255 ), 0 ];            // red -> yellow
	}
	if ( t < 0.5 ) {
		const s = ( t - 0.25 ) / 0.25;
		return [ Math.round( ( 1 - s ) * 255 ), 255, Math.round( s * 128 ) ]; // yellow -> green
	}
	if ( t < 0.75 ) {
		const s = ( t - 0.5 ) / 0.25;
		return [ 0, Math.round( ( 1 - s ) * 255 ), Math.round( 128 + s * 127 ) ]; // green -> cyan/blue
	}
	const s = ( t - 0.75 ) / 0.25;
	return [ Math.round( s * 128 ), 0, Math.round( 255 - s * 128 ) ]; // blue -> purple
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function clamp01( v: number ): number {
	return v < 0 ? 0 : v > 1 ? 1 : v;
}

function resetDepthData(): void {
	cpuDepthDebugState.width = undefined;
	cpuDepthDebugState.height = undefined;
	cpuDepthDebugState.centerDepth = undefined;
	cpuDepthDebugState.minDepth = undefined;
	cpuDepthDebugState.maxDepth = undefined;
	cpuDepthDebugState.validSampleCount = undefined;
	cpuDepthDebugState.lastUpdatedAt = undefined;
	cpuDepthDebugState.errorMessage = undefined;
	cpuDepthDebugState.active = false;
	heatmapCtx.clearRect( 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT );
}

function checkFailureLimit(): void {
	if ( consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT ) {
		cpuDepthDebugState.enabled = false;
		cpuDepthDebugState.errorMessage = `连续 ${consecutiveFailures} 帧未获取到深度数据，已自动关闭。`;
		cpuDepthDebugState.active = false;
		consecutiveFailures = 0;
	}
}

function throttledLog( tag: string, message: string ): void {
	const now = performance.now();
	if ( now - lastLogTime < LOG_THROTTLE_MS ) {
		return;
	}
	lastLogTime = now;
	console.info( `[${tag}]`, message );
}

// ---------------------------------------------------------------------------
// WebXR type augmentations (depth-sensing is not in all TS lib versions)
// ---------------------------------------------------------------------------

interface XRCPUDepthInformation {
	width: number;
	height: number;
	getDepthInMeters( u: number, v: number ): number;
}

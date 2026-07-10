import { reactive } from 'vue';
import type { ArSessionRequestMode } from '@/features/ar/types/runtime-types.js';

export type XrFreezeDiagnosticMode =
	| 'baseline'
	| 'depth-session-only'
	| 'depth-hit-test'
	| 'depth-project-frame'
	| 'depth-read-count';

export type XrRendererProfile = 'current' | 'xr-safe';
export type SuspectedFreezeType =
	| 'none'
	| 'xr-callback-stopped'
	| 'render-stopped'
	| 'viewer-pose-stopped'
	| 'webgl-context-lost'
	| 'unknown';

export interface StageTimingState {
	latestMs: number;
	maxMs: number;
	count: number;
}

export interface XrFreezeHealthState {
	diagnosticMode: XrFreezeDiagnosticMode;
	rendererProfile: XrRendererProfile;
	requestedSessionMode: ArSessionRequestMode;
	effectiveSessionMode: ArSessionRequestMode;
	fallbackUsed: boolean;
	fallbackReason: string | null;
	sessionStartedAt: number | null;
	sessionEndedAt: number | null;
	sessionVisibilityState: string | null;
	depthRequested: boolean;
	depthGranted: boolean;
	depthUsage: string | null;
	depthDataFormat: string | null;
	depthActive: boolean | null;
	hitTestRequested: boolean;
	hitTestSourceCreated: boolean;
	depthReadEnabled: boolean;
	xrCallbackCount: number;
	renderAttemptCount: number;
	renderSuccessCount: number;
	renderErrorCount: number;
	lastXrCallbackAt: number | null;
	lastRenderAttemptAt: number | null;
	lastRenderSuccessAt: number | null;
	viewerPoseSampleCount: number;
	viewerPoseChangeCount: number;
	lastViewerPoseSampleAt: number | null;
	lastViewerPoseChangedAt: number | null;
	depthReadAttemptCount: number;
	depthReadSuccessCount: number;
	depthReadNullCount: number;
	depthWidth: number | null;
	depthHeight: number | null;
	rawValueToMeters: number | null;
	webglContextLost: boolean;
	webglContextLostCount: number;
	webglContextRestoredCount: number;
	lastStartedStage: string | null;
	lastSuccessfulStage: string | null;
	lastFailedStage: string | null;
	lastErrorName: string | null;
	lastErrorMessage: string | null;
	xrCallbackAlive: boolean;
	rendererAlive: boolean;
	viewerPoseRecentlyChanged: boolean;
	suspectedFreezeType: SuspectedFreezeType;
	stageTimings: Record<string, StageTimingState>;
}

export const xrFreezeHealthState = reactive<XrFreezeHealthState>( createDefaultXrFreezeHealthState() );

export function createDefaultXrFreezeHealthState(): XrFreezeHealthState {

	return {
		diagnosticMode: resolveXrFreezeDiagnosticMode(),
		rendererProfile: resolveXrRendererProfile(),
		requestedSessionMode: 'normal',
		effectiveSessionMode: 'normal',
		fallbackUsed: false,
		fallbackReason: null,
		sessionStartedAt: null,
		sessionEndedAt: null,
		sessionVisibilityState: document.visibilityState ?? null,
		depthRequested: false,
		depthGranted: false,
		depthUsage: null,
		depthDataFormat: null,
		depthActive: null,
		hitTestRequested: false,
		hitTestSourceCreated: false,
		depthReadEnabled: false,
		xrCallbackCount: 0,
		renderAttemptCount: 0,
		renderSuccessCount: 0,
		renderErrorCount: 0,
		lastXrCallbackAt: null,
		lastRenderAttemptAt: null,
		lastRenderSuccessAt: null,
		viewerPoseSampleCount: 0,
		viewerPoseChangeCount: 0,
		lastViewerPoseSampleAt: null,
		lastViewerPoseChangedAt: null,
		depthReadAttemptCount: 0,
		depthReadSuccessCount: 0,
		depthReadNullCount: 0,
		depthWidth: null,
		depthHeight: null,
		rawValueToMeters: null,
		webglContextLost: false,
		webglContextLostCount: 0,
		webglContextRestoredCount: 0,
		lastStartedStage: null,
		lastSuccessfulStage: null,
		lastFailedStage: null,
		lastErrorName: null,
		lastErrorMessage: null,
		xrCallbackAlive: false,
		rendererAlive: false,
		viewerPoseRecentlyChanged: false,
		suspectedFreezeType: 'none',
		stageTimings: {}
	};

}

export function resolveXrFreezeDiagnosticMode(): XrFreezeDiagnosticMode {

	const value = new URLSearchParams( window.location.search ).get( 'xrDiag' )
		?? import.meta.env.VITE_XR_FREEZE_DIAGNOSTIC_MODE
		?? 'baseline';
	return isXrFreezeDiagnosticMode( value ) ? value : 'baseline';

}

export function resolveXrRendererProfile(): XrRendererProfile {

	const value = new URLSearchParams( window.location.search ).get( 'xrRenderer' )
		?? import.meta.env.VITE_XR_RENDERER_PROFILE
		?? 'current';
	return value === 'xr-safe' ? 'xr-safe' : 'current';

}

export function resetXrFreezeCounters(): void {

	const baseline = createDefaultXrFreezeHealthState();
	Object.assign( xrFreezeHealthState, {
		...baseline,
		diagnosticMode: xrFreezeHealthState.diagnosticMode,
		rendererProfile: xrFreezeHealthState.rendererProfile,
		requestedSessionMode: xrFreezeHealthState.requestedSessionMode,
		effectiveSessionMode: xrFreezeHealthState.effectiveSessionMode
	} );

}

export function updateXrFreezeWatchdog(now = performance.now()): void {

	xrFreezeHealthState.xrCallbackAlive = xrFreezeHealthState.lastXrCallbackAt !== null
		&& now - xrFreezeHealthState.lastXrCallbackAt < 1000;
	xrFreezeHealthState.rendererAlive = xrFreezeHealthState.lastRenderSuccessAt !== null
		&& now - xrFreezeHealthState.lastRenderSuccessAt < 1000;
	xrFreezeHealthState.viewerPoseRecentlyChanged = xrFreezeHealthState.lastViewerPoseChangedAt !== null
		&& now - xrFreezeHealthState.lastViewerPoseChangedAt < 1500;

	if ( xrFreezeHealthState.webglContextLost ) {
		xrFreezeHealthState.suspectedFreezeType = 'webgl-context-lost';
	} else if ( xrFreezeHealthState.sessionStartedAt !== null && xrFreezeHealthState.sessionEndedAt === null && ! xrFreezeHealthState.xrCallbackAlive ) {
		xrFreezeHealthState.suspectedFreezeType = 'xr-callback-stopped';
	} else if ( xrFreezeHealthState.xrCallbackAlive && ! xrFreezeHealthState.rendererAlive ) {
		xrFreezeHealthState.suspectedFreezeType = 'render-stopped';
	} else if ( xrFreezeHealthState.xrCallbackAlive && xrFreezeHealthState.rendererAlive && ! xrFreezeHealthState.viewerPoseRecentlyChanged ) {
		xrFreezeHealthState.suspectedFreezeType = 'viewer-pose-stopped';
	} else {
		xrFreezeHealthState.suspectedFreezeType = 'none';
	}

}

export function recordXrStageTiming(stage: string, durationMs: number): void {

	const timing = xrFreezeHealthState.stageTimings[ stage ] ?? { latestMs: 0, maxMs: 0, count: 0 };
	timing.latestMs = durationMs;
	timing.maxMs = Math.max( timing.maxMs, durationMs );
	timing.count += 1;
	xrFreezeHealthState.stageTimings[ stage ] = timing;

}

function isXrFreezeDiagnosticMode(value: string): value is XrFreezeDiagnosticMode {

	return value === 'baseline'
		|| value === 'depth-session-only'
		|| value === 'depth-hit-test'
		|| value === 'depth-project-frame'
		|| value === 'depth-read-count';

}

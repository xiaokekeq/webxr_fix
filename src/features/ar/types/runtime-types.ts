import type * as THREE from 'three';

export type SetStatus = (message: string) => void;

export interface ArSessionStartResult {
	session: XRSession;
	depthRequested: boolean;
	depthGranted: boolean;
	depthUsage: 'cpu-optimized' | null;
	depthDataFormat: 'luminance-alpha' | null;
	depthActive: boolean | null;
	fallbackUsed: boolean;
	fallbackReason: string | null;
}

export interface ARSceneBundle {
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	renderer: THREE.WebGLRenderer;
	reticle: THREE.Group;
	arPlacementAnchor: THREE.Group;
	arModelAnchor: THREE.Group;
}

export interface XRAnchorHandle {
	anchorSpace: XRSpace;
	delete?(): void;
}

export interface XRAnchorPlacement {
	anchor: XRAnchorHandle;
	initialPoseMatrix: THREE.Matrix4;
}

export type XRAnchorPlacementResult =
	| ( XRAnchorPlacement & { status: 'anchored' } )
	| { status: 'unsupported' }
	| { status: 'timeout' }
	| { status: 'failed'; error: unknown }
	| { status: 'cancelled' };

export type XRTrackingState = 'normal' | 'emulated' | 'unavailable';
export type XRSessionVisibilityState = 'visible' | 'visible-blurred' | 'hidden';
export type XRWorldLockState = 'none' | 'pending' | 'anchored' | 'unanchored' | 'recalibration-required';

export interface XRInteractionState {
	tracking: XRTrackingState;
	visibility: XRSessionVisibilityState;
	worldLock: XRWorldLockState;
	hudPickingLocked: boolean;
}

export type XRWorldLockPreparation =
	| { status: 'anchored'; requestId: number; anchor: XRAnchorHandle; initialPoseMatrix: THREE.Matrix4 }
	| { status: 'unanchored'; requestId: number }
	| { status: 'timeout' | 'cancelled'; requestId: number }
	| { status: 'failed'; requestId: number; error: unknown };

export interface XRHitTestController {
	setup(): void;
	dispose(): void;
	update(frame: XRFrame): void;
	hasGroundHit(): boolean;
	getHitPosition(target: THREE.Vector3): THREE.Vector3 | null;
	getHitTestQuality(): XRHitTestQuality | null;
	createAnchorFromNextHit(): Promise<XRAnchorPlacementResult>;
	cancelPendingAnchorRequest(): void;
	requestSession(): Promise<void>;
}

export interface XRHitTestQuality {
	sampleCount: number;
	jitterMeters: number;
	ageMs: number;
}

export interface CoarsePlacementEstimate {
	position: THREE.Vector3;
	orientation: THREE.Quaternion;
	distanceMeters: number;
	headingDeg: number;
	accuracyMeters: number | null;
	sourceLabel: string;
	groundY: number;
	enuVerticalOffsetApplied: boolean;
}

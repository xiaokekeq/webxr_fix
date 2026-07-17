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

export interface XRHitTestController {
	setup(): void;
	update(frame: XRFrame): void;
	hasGroundHit(): boolean;
	getHitPosition(target: THREE.Vector3): THREE.Vector3 | null;
	getHitTestQuality(): XRHitTestQuality | null;
	createAnchorFromNextHit(): Promise<XRAnchorPlacement | null>;
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

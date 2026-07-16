import type * as THREE from 'three';

export type SetStatus = (message: string) => void;
export type XrTrackingStatus = 'normal' | 'emulated' | 'unavailable';
export type XrSessionVisibilityState = 'visible' | 'visible-blurred' | 'hidden';

export interface ArSessionStartResult {
	session: XRSession;
	domOverlayGranted: boolean;
	domOverlayType: XRDOMOverlayType | null;
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

export interface XRHitTestController {
	setup(): void;
	update(frame: XRFrame): void;
	hasGroundHit(): boolean;
	getHitPosition(target: THREE.Vector3): THREE.Vector3 | null;
	getHitMatrix(target: THREE.Matrix4): THREE.Matrix4 | null;
	getHitTestQuality(): XRHitTestQuality | null;
	supportsAnchors(): boolean;
	createAnchorFromLatestHit(): Promise<XRAnchorHandle | null>;
	requestSession(domOverlayRoot: HTMLElement): Promise<boolean>;
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

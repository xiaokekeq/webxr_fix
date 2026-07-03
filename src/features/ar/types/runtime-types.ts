import type * as THREE from 'three';

export type SetStatus = (message: string) => void;

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

export interface XrTrackedImageDefinition {
	targetId: string;
	siteId?: string;
	markerId?: string;
	imageUrl: string;
	patternUrl?: string;
	widthInMeters: number;
	trackingWidthMeters?: number;
	sizeMeters?: number;
}

export interface XrImageTrackingObservation {
	targetId: string;
	trackingState: string;
	position: [ number, number, number ];
	rotation: [ number, number, number, number ];
	timestamp: number;
}

export interface XrImageTrackingState {
	requested: boolean;
	supported: boolean;
	active: boolean;
	reason: string;
}

export interface XrSessionRequestOptions {
	trackedImages?: XrTrackedImageDefinition[];
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
	requestSession(options?: XrSessionRequestOptions): void;
	getImageTrackingState(): XrImageTrackingState;
	getTrackedImageTargetId(index: number): string | null;
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

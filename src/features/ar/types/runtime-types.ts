import type * as THREE from 'three';

export type SetStatus = (message: string) => void;
export type ArSessionRequestMode = 'normal' | 'cpu-depth-debug';

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
	requestSession(options?: { mode?: ArSessionRequestMode; cpuDepthDebug?: boolean }): void;
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

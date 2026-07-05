import * as THREE from 'three';

export interface MarkerPoseInAr {
	markerId: string;
	matrix: THREE.Matrix4;
	timestamp: number;
}


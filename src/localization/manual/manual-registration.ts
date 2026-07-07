import * as THREE from 'three';
import type { ArLocalizationSource } from '@/localization/core/ar-from-enu-solution.js';

export interface ManualPlacementBase {
	position: THREE.Vector3;
	orientation: THREE.Quaternion;
	scale: number;
	scaleAnchor?: THREE.Vector3;
	siteContext?: {
		siteOriginArPosition: THREE.Vector3;
		headingDeg: number;
		baseScale: number;
		source?: ArLocalizationSource;
		timestamp?: number;
		accuracyMeters?: number;
	};
}

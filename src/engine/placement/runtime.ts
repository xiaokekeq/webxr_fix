import * as THREE from 'three';
import type {
	EngineeringRegistrationSolution
} from '@/localization/coarse/engineering-registration.js';
import type { ArFromEnuSolution } from '@/localization/core/ar-from-enu-solution.js';

export function composeModelRawLocalToArMatrix(options: {
	arFromEnuSolution: ArFromEnuSolution;
	registrationSolution: EngineeringRegistrationSolution;
	target?: THREE.Matrix4;
}): THREE.Matrix4 {

	const target = options.target ?? new THREE.Matrix4();
	return target.multiplyMatrices(
		options.arFromEnuSolution.matrix,
		options.registrationSolution.modelToSite.matrix
	);

}









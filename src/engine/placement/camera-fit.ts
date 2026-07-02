import * as THREE from 'three';

export function getPlacementResidualScale(
	modelTemplateGroup: THREE.Group,
	registrationScale: number
): number {

	// modelTemplate already carries the baked asset scale on its root transform.
	// Placement should only apply the engineering registration scale on top.
	void modelTemplateGroup;
	return registrationScale;

}

import * as THREE from 'three';

type EmissiveMaterial = THREE.Material & {
	emissive: THREE.Color;
	emissiveIntensity: number;
};

type ColorMaterial = THREE.Material & {
	color: THREE.Color;
};

export function createHighlightedMaterial(material: THREE.Material): THREE.Material {

	const cloned = material.clone();
	if ( 'transparent' in cloned ) {
		cloned.transparent = false;
	}

	if ( 'opacity' in cloned && typeof cloned.opacity === 'number' ) {
		cloned.opacity = 1;
	}

	if ( 'depthWrite' in cloned ) {
		cloned.depthWrite = true;
	}

	if ( 'map' in cloned ) {
		cloned.map = null;
	}

	if ( hasEmissive( cloned ) ) {
		cloned.emissive = new THREE.Color( 0xffb300 );
		cloned.emissiveIntensity = 1.9;
	}

	if ( hasColor( cloned ) ) {
		cloned.color = new THREE.Color( 0xffd54f );
	}

	cloned.needsUpdate = true;
	return cloned;

}

export function disposeDynamicMaterials(
	currentMaterial: THREE.Material | THREE.Material[],
	sourceMaterial: THREE.Material | THREE.Material[]
): void {

	const currentMaterials = Array.isArray( currentMaterial ) ? currentMaterial : [ currentMaterial ];
	const sourceMaterials = Array.isArray( sourceMaterial ) ? sourceMaterial : [ sourceMaterial ];

	for ( const material of currentMaterials ) {
		if ( sourceMaterials.includes( material ) === false ) {
			material.dispose();
		}
	}

}

function hasEmissive(material: THREE.Material): material is EmissiveMaterial {

	return 'emissive' in material
		&& material.emissive instanceof THREE.Color
		&& 'emissiveIntensity' in material
		&& typeof material.emissiveIntensity === 'number';

}

function hasColor(material: THREE.Material): material is ColorMaterial {

	return 'color' in material && material.color instanceof THREE.Color;

}


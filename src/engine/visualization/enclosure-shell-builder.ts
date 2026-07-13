import * as THREE from 'three';
import {
	resolveModelBoundarySurfaces,
	type BoundarySurfaceName,
	type ResolvedBoundarySurface
} from './model-boundary-surface-resolver.js';

export type EnclosureFaceName = BoundarySurfaceName;

export type EnclosureShellBuildFailureReason = 'empty-model' | 'missing-boundary-surface';

export type EnclosureShellBuildResult = {
	ok: true;
	root: THREE.Group;
	meshCount: number;
	bounds: THREE.Box3;
	epsilon: number;
	surfaces: ResolvedBoundarySurface[];
} | {
	ok: false;
	reason: EnclosureShellBuildFailureReason;
	bounds: THREE.Box3 | null;
	message: string;
};

type BoundaryReadableMaterial = THREE.Material & {
	map?: THREE.Texture | null;
	alphaMap?: THREE.Texture | null;
	color?: THREE.Color;
	vertexColors?: boolean;
};

export function buildEnclosureShell(modelRoot: THREE.Object3D): EnclosureShellBuildResult {

	const resolved = resolveModelBoundarySurfaces( modelRoot );
	if ( resolved.ok === false ) return { ok: false, reason: resolved.reason, bounds: null, message: resolved.message };

	const root = new THREE.Group();
	root.name = '__model-conforming-shell';
	applyShellFlags( root );
	for ( const surface of resolved.surfaces ) {
		const materials = surface.materials.map( createBoundaryShellMaterial );
		const mesh = new THREE.Mesh( surface.geometry, materials.length === 1 ? materials[ 0 ] : materials );
		mesh.name = `__shell-${surface.face}`;
		applyShellFlags( mesh );
		mesh.userData.boundarySurfaceFace = surface.face;
		root.add( mesh );
	}

	modelRoot.add( root );
	if ( import.meta.env.DEV ) console.info( '[ModelConformingShellReady]', {
		meshCount: root.children.length,
		epsilon: resolved.epsilon,
		faces: resolved.surfaces.map( ( surface ) => ( {
			face: surface.face,
			triangleCount: surface.triangleCount,
			sourceMeshes: surface.sourceMeshes.map( ( mesh ) => mesh.name || mesh.parent?.name || mesh.uuid ),
			sourceMaterials: surface.materials.map( ( material ) => material.name ),
			side: normalizeMaterialSide( ( root.getObjectByName( `__shell-${surface.face}` ) as THREE.Mesh ).material )
		} ) )
	} );
	return { ok: true, root, meshCount: root.children.length, bounds: resolved.bounds, epsilon: resolved.epsilon, surfaces: resolved.surfaces };

}

export function createBoundaryShellMaterial(source: THREE.Material): THREE.MeshBasicMaterial {

	const readable = source as BoundaryReadableMaterial;
	const material = new THREE.MeshBasicMaterial( {
		map: readable.map ?? null,
		alphaMap: readable.alphaMap ?? null,
		color: readable.color?.clone() ?? new THREE.Color( 0xffffff ),
		vertexColors: readable.vertexColors === true,
		transparent: source.transparent || source.opacity < 1 || readable.alphaMap !== null && readable.alphaMap !== undefined,
		opacity: source.opacity,
		alphaTest: source.alphaTest,
		side: THREE.DoubleSide,
		toneMapped: false,
		depthTest: true,
		depthWrite: true,
		polygonOffset: true,
		polygonOffsetFactor: - 1,
		polygonOffsetUnits: - 1
	} );
	material.clippingPlanes = null;
	material.clipIntersection = false;
	material.clipShadows = false;
	return material;

}

function applyShellFlags(object: THREE.Object3D): void {

	object.userData.__modelConformingShell = true;
	object.userData.__enclosureShell = true;
	object.userData.__excludeFromLayerIndex = true;
	object.userData.__excludeFromPicking = true;
	object.userData.__excludeFromSectionCap = true;

}

function normalizeMaterialSide(material: THREE.Material | THREE.Material[]): THREE.Side | null {

	return ( Array.isArray( material ) ? material[ 0 ] : material )?.side ?? null;

}

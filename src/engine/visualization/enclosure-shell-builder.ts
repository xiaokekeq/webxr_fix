import * as THREE from 'three';
import {
	resolveModelConformingSurface,
	type ResolvedConformingSurface
} from './model-boundary-surface-resolver.js';

export type EnclosureShellBuildFailureReason = 'empty-model' | 'no-conforming-surface' | 'invalid-surface';

export type EnclosureShellBuildResult = {
	ok: true;
	root: THREE.Group;
	meshCount: number;
	bounds: THREE.Box3;
	surface: ResolvedConformingSurface;
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

	const resolved = resolveModelConformingSurface( modelRoot );
	if ( resolved.ok === false ) return { ok: false, reason: resolved.reason, bounds: null, message: resolved.message };

	const root = new THREE.Group();
	root.name = '__model-conforming-shell';
	applyShellFlags( root );
	const materials = resolved.surface.materials.map( createBoundaryShellMaterial );
	const mesh = new THREE.Mesh( resolved.surface.geometry, materials.length === 1 ? materials[ 0 ] : materials );
	mesh.name = '__model-conforming-shell-surface';
	applyShellFlags( mesh );
	root.add( mesh );

	modelRoot.add( root );
	if ( import.meta.env.DEV ) console.info( '[ModelConformingShellReady]', {
		meshCount: 1,
		sourceTriangleCount: resolved.surface.sourceTriangleCount,
		shellTriangleCount: resolved.surface.triangleCount,
		excludedTopTriangleCount: resolved.surface.excludedTopTriangleCount,
		excludedInternalBottomTriangleCount: resolved.surface.excludedInternalBottomTriangleCount,
		materialCount: resolved.surface.materials.length,
	} );
	return { ok: true, root, meshCount: 1, bounds: resolved.bounds, surface: resolved.surface };
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
		polygonOffsetFactor: -1,
		polygonOffsetUnits: -1
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

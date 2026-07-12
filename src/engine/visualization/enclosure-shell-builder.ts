import * as THREE from 'three';
import { cloneEnclosureMaterial, resolveEnclosureMaterialSources, type EnclosureFaceName } from './enclosure-material-resolver.js';

export interface EnclosureShellBuildResult { root: THREE.Group; meshCount: number; triangleCount: number; materialCount: number; materialSources: Record<EnclosureFaceName, string>; }

export function buildEnclosureShell(modelRoot: THREE.Object3D): EnclosureShellBuildResult {

	modelRoot.updateWorldMatrix( true, true );
	const bounds = resolveLocalBounds( modelRoot );
	const root = new THREE.Group();
	root.name = '__textured-enclosure-shell';
	root.userData.__enclosureShell = true;
	root.userData.__excludeFromLayerIndex = true;
	if ( bounds.isEmpty() ) return { root, meshCount: 0, triangleCount: 0, materialCount: 0, materialSources: { front: 'none', back: 'none', left: 'none', right: 'none', bottom: 'none' } };
	const sources = resolveEnclosureMaterialSources( modelRoot, bounds );
	const size = bounds.getSize( new THREE.Vector3() );
	const faces: Array<[ EnclosureFaceName, THREE.Vector3[] ]> = [
		[ 'front', quad( bounds.min.x, bounds.max.x, bounds.min.z, bounds.min.z, bounds.min.y, bounds.max.y, 'front' ) ],
		[ 'back', quad( bounds.min.x, bounds.max.x, bounds.max.z, bounds.max.z, bounds.min.y, bounds.max.y, 'back' ) ],
		[ 'left', quad( bounds.min.z, bounds.max.z, bounds.min.x, bounds.min.x, bounds.min.y, bounds.max.y, 'left' ) ],
		[ 'right', quad( bounds.min.z, bounds.max.z, bounds.max.x, bounds.max.x, bounds.min.y, bounds.max.y, 'right' ) ],
		[ 'bottom', quad( bounds.min.x, bounds.max.x, bounds.min.z, bounds.max.z, bounds.min.y, bounds.min.y, 'bottom' ) ]
	];
	for ( const [ name, points ] of faces ) {
		const material = cloneEnclosureMaterial( sources[ name ] );
		const dimensions = name === 'bottom' ? [ size.x, size.z ] : name === 'left' || name === 'right' ? [ size.z, size.y ] : [ size.x, size.y ];
		const mesh = new THREE.Mesh( makeFaceGeometry( points, dimensions[ 0 ] / sources[ name ].metersPerUv, dimensions[ 1 ] / sources[ name ].metersPerUv ), material );
		mesh.name = `__enclosure-${name}`; mesh.userData.__enclosureShell = true; mesh.userData.__excludeFromLayerIndex = true; mesh.userData.enclosureFace = name; mesh.userData.materialSource = sources[ name ].source;
		root.add( mesh );
	}
	modelRoot.add( root );
	return { root, meshCount: 5, triangleCount: 10, materialCount: 5, materialSources: Object.fromEntries( Object.entries( sources ).map( ( [ face, source ] ) => [ face, source.source ] ) ) as Record<EnclosureFaceName, string> };

}

function resolveLocalBounds(root: THREE.Object3D): THREE.Box3 {
	const bounds = new THREE.Box3(); const inverseRoot = root.matrixWorld.clone().invert(); const relative = new THREE.Matrix4(); const point = new THREE.Vector3();
	root.traverse( ( object ) => {
		if ( object instanceof THREE.Mesh === false || object.userData.__visualizationHelper === true || object.userData.__enclosureShell === true ) return;
		if ( object.geometry.boundingBox === null ) object.geometry.computeBoundingBox();
		if ( object.geometry.boundingBox === null ) return;
		relative.multiplyMatrices( inverseRoot, object.matrixWorld );
		const box = object.geometry.boundingBox;
		for ( const x of [ box.min.x, box.max.x ] ) for ( const y of [ box.min.y, box.max.y ] ) for ( const z of [ box.min.z, box.max.z ] ) bounds.expandByPoint( point.set( x, y, z ).applyMatrix4( relative ) );
	} );
	return bounds;
}

function quad(a: number, b: number, fixedA: number, fixedB: number, low: number, high: number, face: EnclosureFaceName): THREE.Vector3[] {
	if ( face === 'front' ) return [ new THREE.Vector3( a, fixedA, low ), new THREE.Vector3( b, fixedA, low ), new THREE.Vector3( b, fixedA, high ), new THREE.Vector3( a, fixedA, high ) ];
	if ( face === 'back' ) return [ new THREE.Vector3( a, fixedA, low ), new THREE.Vector3( a, fixedA, high ), new THREE.Vector3( b, fixedA, high ), new THREE.Vector3( b, fixedA, low ) ];
	if ( face === 'left' ) return [ new THREE.Vector3( fixedA, a, low ), new THREE.Vector3( fixedA, b, low ), new THREE.Vector3( fixedA, b, high ), new THREE.Vector3( fixedA, a, high ) ];
	if ( face === 'right' ) return [ new THREE.Vector3( fixedA, a, low ), new THREE.Vector3( fixedA, a, high ), new THREE.Vector3( fixedA, b, high ), new THREE.Vector3( fixedA, b, low ) ];
	return [ new THREE.Vector3( a, fixedA, low ), new THREE.Vector3( a, fixedB, low ), new THREE.Vector3( b, fixedB, low ), new THREE.Vector3( b, fixedA, low ) ];
}

function makeFaceGeometry(points: THREE.Vector3[], repeatU: number, repeatV: number): THREE.BufferGeometry {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( points.flatMap( ( point ) => point.toArray() ), 3 ) );
	geometry.setIndex( [ 0, 1, 2, 0, 2, 3 ] );
	geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( [ 0, 0, repeatU, 0, repeatU, repeatV, 0, repeatV ], 2 ) );
	geometry.computeVertexNormals();
	return geometry;
}

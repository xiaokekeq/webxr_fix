import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import dz1207Obj from '../../../public/pipe-viewer/dz1207/dizhi1207.obj?raw';
import { resolveModelConformingSurface } from './model-boundary-surface-resolver.js';

describe( 'dz1207 conforming shell coverage', () => {

	it( 'keeps side boundaries and the bottom while removing the upper envelope', () => {

		const model = new OBJLoader().parse( dz1207Obj );
		const sourceTriangles = collectModelTriangles( model );
		const resolved = resolveModelConformingSurface( model );

		expect( resolved.ok ).toBe( true );
		if ( resolved.ok ) {
			const position = resolved.surface.geometry.getAttribute( 'position' );
			const sideTriangles: Array<{ center: THREE.Vector3; normal: THREE.Vector3 }> = [];
			const sideBounds = new THREE.Box3();
			for ( let index = 0; index < position.count; index += 3 ) {
				const a = new THREE.Vector3().fromBufferAttribute( position, index );
				const b = new THREE.Vector3().fromBufferAttribute( position, index + 1 );
				const c = new THREE.Vector3().fromBufferAttribute( position, index + 2 );
				const normal = new THREE.Vector3().crossVectors( b.clone().sub( a ), c.clone().sub( a ) ).normalize();
				const horizontal = Math.max( Math.abs( normal.x ), Math.abs( normal.z ) );
				if ( Math.abs( normal.y ) < horizontal ) {
					const center = a.add( b ).add( c ).multiplyScalar( 1 / 3 );
					sideTriangles.push( { center, normal } );
					sideBounds.expandByPoint( center );
				}
			}
			const width = sideBounds.max.x - sideBounds.min.x;
			const depth = sideBounds.max.z - sideBounds.min.z;
			const rightTolerance = Math.max( width * 0.01, 1e-4 );
			const leftTolerance = Math.max( width * 0.01, 1e-4 );
			const frontTolerance = Math.max( depth * 0.01, 1e-4 );
			const backTolerance = Math.max( depth * 0.01, 1e-4 );
			const bottomTolerance = Math.max( ( resolved.bounds.max.y - resolved.bounds.min.y ) * 1e-4, 1e-5 );
			const coverage = { right: 0, left: 0, front: 0, back: 0, bottom: 0 };
			for ( const triangle of sideTriangles ) {
				if ( triangle.center.x >= sideBounds.max.x - rightTolerance ) coverage.right += 1;
				if ( triangle.center.x <= sideBounds.min.x + leftTolerance ) coverage.left += 1;
				if ( triangle.center.z <= sideBounds.min.z + frontTolerance ) coverage.front += 1;
				if ( triangle.center.z >= sideBounds.max.z - backTolerance ) coverage.back += 1;
			}
			for ( let index = 0; index < position.count; index += 3 ) {
				const a = new THREE.Vector3().fromBufferAttribute( position, index );
				const b = new THREE.Vector3().fromBufferAttribute( position, index + 1 );
				const c = new THREE.Vector3().fromBufferAttribute( position, index + 2 );
				if ( Math.max( a.y, b.y, c.y ) <= resolved.bounds.min.y + bottomTolerance ) coverage.bottom += 1;
			}
			expect( coverage ).toMatchObject( { right: expect.any(Number), left: expect.any(Number), front: expect.any(Number), back: expect.any(Number), bottom: expect.any(Number) } );
			expect( coverage.right ).toBeGreaterThan( 0 );
			expect( coverage.left ).toBeGreaterThan( 0 );
			expect( coverage.front ).toBeGreaterThan( 0 );
			expect( coverage.back ).toBeGreaterThan( 0 );
			expect( coverage.bottom ).toBeGreaterThan( 0 );
			expect( resolved.surface.excludedTopTriangleCount ).toBeGreaterThan( 0 );
			expect( countUnblockedTopTriangles( position, sourceTriangles, resolved.bounds ) ).toBe( 0 );
			expect( resolved.surface.sourceTriangleCount ).toBe( sourceTriangles.length );
			expect( resolved.surface.sourceTriangleCount ).toBe( resolved.surface.excludedTopTriangleCount + resolved.surface.triangleCount );
		}

	} );

} );

type Triangle = [ THREE.Vector3, THREE.Vector3, THREE.Vector3 ];

function collectModelTriangles(modelRoot: THREE.Object3D): Triangle[] {

	modelRoot.updateWorldMatrix( true, true );
	const inverseRoot = modelRoot.matrixWorld.clone().invert();
	const triangles: Triangle[] = [];
	modelRoot.traverse( ( object ) => {
		if ( object instanceof THREE.Mesh === false ) return;
		const position = object.geometry.getAttribute( 'position' );
		if ( position === undefined ) return;
		const index = object.geometry.getIndex();
		const meshToRoot = new THREE.Matrix4().multiplyMatrices( inverseRoot, object.matrixWorld );
		for ( let offset = 0; offset < ( index?.count ?? position.count ); offset += 3 ) {
			const indices = [ index === null ? offset : index.getX( offset ), index === null ? offset + 1 : index.getX( offset + 1 ), index === null ? offset + 2 : index.getX( offset + 2 ) ];
			triangles.push( indices.map( ( vertexIndex ) => new THREE.Vector3().fromBufferAttribute( position, vertexIndex ).applyMatrix4( meshToRoot ) ) as Triangle );
		}
	} );
	return triangles;

}

function countUnblockedTopTriangles(position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, sourceTriangles: readonly Triangle[], bounds: THREE.Box3): number {

	const size = bounds.getSize( new THREE.Vector3() );
	const epsilon = Math.max( size.length() * 1e-5, 1e-5 );
	let count = 0;
	for ( let index = 0; index < position.count; index += 3 ) {
		const triangle = [ new THREE.Vector3().fromBufferAttribute( position, index ), new THREE.Vector3().fromBufferAttribute( position, index + 1 ), new THREE.Vector3().fromBufferAttribute( position, index + 2 ) ] as Triangle;
		const normal = new THREE.Vector3().crossVectors( triangle[ 1 ].clone().sub( triangle[ 0 ] ), triangle[ 2 ].clone().sub( triangle[ 0 ] ) ).normalize();
		if ( Math.abs( normal.y ) < 0.2 ) continue;
		const origin = triangle[ 0 ].clone().add( triangle[ 1 ] ).add( triangle[ 2 ] ).multiplyScalar( 1 / 3 ).addScaledVector( new THREE.Vector3( 0, 1, 0 ), epsilon * 4 );
		const ray = new THREE.Ray( origin, new THREE.Vector3( 0, 1, 0 ) );
		const hit = new THREE.Vector3();
		if ( sourceTriangles.some( ( other ) => ray.intersectTriangle( other[ 0 ], other[ 1 ], other[ 2 ], false, hit ) !== null && hit.distanceTo( origin ) > epsilon && hit.distanceTo( origin ) <= size.y + epsilon ) === false ) count += 1;
	}
	return count;

}

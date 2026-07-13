import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import dz1207Obj from '../../../public/pipe-viewer/dz1207/dizhi1207.obj?raw';
import { resolveModelConformingSurface } from './model-boundary-surface-resolver.js';

describe( 'dz1207 conforming shell coverage', () => {

	it( 'keeps side boundaries and the global bottom while leaving the top open', () => {

		const resolved = resolveModelConformingSurface( new OBJLoader().parse( dz1207Obj ) );

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
			const coverage = { right: 0, left: 0, front: 0, back: 0, topDominant: 0 };
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
				const normal = new THREE.Vector3().crossVectors( b.sub( a ), c.sub( a ) ).normalize();
				const horizontal = Math.max( Math.abs( normal.x ), Math.abs( normal.z ) );
				if ( normal.y > 0 && normal.y > horizontal && Math.max( a.y, b.y, c.y ) > resolved.bounds.min.y + bottomTolerance ) coverage.topDominant += 1;
			}
			expect( coverage ).toMatchObject( { right: expect.any(Number), left: expect.any(Number), front: expect.any(Number), back: expect.any(Number), topDominant: 0 } );
			expect( coverage.right ).toBeGreaterThan( 0 );
			expect( coverage.left ).toBeGreaterThan( 0 );
			expect( coverage.front ).toBeGreaterThan( 0 );
			expect( coverage.back ).toBeGreaterThan( 0 );
			expect( resolved.surface.globalBottomTriangleCount ).toBeGreaterThan( 0 );
		}

	} );

} );

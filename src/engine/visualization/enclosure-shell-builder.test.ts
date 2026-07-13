import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildEnclosureShell, createBoundaryShellMaterial } from './enclosure-shell-builder.js';
import { resolveModelConformingSurface } from './model-boundary-surface-resolver.js';

describe( 'model conforming shell', () => {

	it( 'builds one non-top conforming surface with source material groups, UVs, and colors', () => {

		const geometry = createSlopedPrismGeometry();
		geometry.clearGroups();
		geometry.addGroup( 0, 6, 0 );
		geometry.addGroup( 6, 30, 1 );
		geometry.setAttribute( 'color', new THREE.Float32BufferAttribute( Array.from( { length: 24 }, ( _, index ) => ( index % 3 ) / 2 ), 3 ) );
		const sourceMaterials = [ new THREE.MeshStandardMaterial( { color: 0xff0000, vertexColors: true } ), new THREE.MeshStandardMaterial( { color: 0x00ff00, vertexColors: true } ) ];
		const model = new THREE.Group();
		model.add( new THREE.Mesh( geometry, sourceMaterials ) );
		const resolved = resolveModelConformingSurface( model );
		const result = buildEnclosureShell( model );

		expect( resolved.ok ).toBe( true );
		if ( resolved.ok ) {
			expect( resolved.surface.triangleCount ).toBe( 10 );
			expect( resolved.surface.excludedTopTriangleCount ).toBe( 2 );
			expect( resolved.surface.geometry.getAttribute( 'uv' ).count ).toBe( 30 );
			expect( resolved.surface.geometry.getAttribute( 'color' ).count ).toBe( 30 );
			expect( resolved.surface.geometry.groups ).toHaveLength( 2 );
		}
		expect( result.ok ).toBe( true );
		if ( result.ok ) {
			const mesh = result.root.children[ 0 ] as THREE.Mesh;
			expect( result ).toMatchObject( { meshCount: 1 } );
			expect( mesh.name ).toBe( '__model-conforming-shell-surface' );
			for ( const material of Array.isArray( mesh.material ) ? mesh.material : [ mesh.material ] ) expect( material.side ).toBe( THREE.DoubleSide );
		}

	} );

	it( 'keeps a sloped side regardless of its mixed horizontal normal components', () => {

		const model = new THREE.Group();
		const source = new THREE.Mesh( createSlopedPrismGeometry(), new THREE.MeshBasicMaterial() );
		source.rotation.y = Math.PI / 4;
		model.add( source );
		const resolved = resolveModelConformingSurface( model );

		expect( resolved.ok ).toBe( true );
		if ( resolved.ok ) {
			const normal = resolved.surface.geometry.getAttribute( 'normal' );
			let hasMixedHorizontalNormal = false;
			for ( let index = 0; index < normal.count; index += 1 ) {
				const value = new THREE.Vector3().fromBufferAttribute( normal, index );
				if ( Math.abs( value.x ) > 0.1 && Math.abs( value.z ) > 0.1 ) hasMixedHorizontalNormal = true;
			}
			expect( hasMixedHorizontalNormal ).toBe( true );
		}

	} );

	it( 'corrects inward winding and keeps the shell mesh transform at identity', () => {

		const geometry = createSlopedPrismGeometry();
		geometry.computeVertexNormals();
		const model = new THREE.Group();
		const parent = new THREE.Group();
		parent.position.set( 3, 2, - 4 );
		parent.rotation.set( 0.1, 0.3, 0 );
		parent.scale.set( 2, 3, 4 );
		parent.add( new THREE.Mesh( geometry, new THREE.MeshBasicMaterial() ) );
		model.add( parent );
		const result = buildEnclosureShell( model );

		expect( result.ok ).toBe( true );
		if ( result.ok ) {
			const mesh = result.root.children[ 0 ] as THREE.Mesh;
			const position = mesh.geometry.getAttribute( 'position' );
			const normal = mesh.geometry.getAttribute( 'normal' );
			const a = new THREE.Vector3().fromBufferAttribute( position, 0 );
			const b = new THREE.Vector3().fromBufferAttribute( position, 1 );
			const c = new THREE.Vector3().fromBufferAttribute( position, 2 );
			const winding = new THREE.Vector3().crossVectors( b.sub( a ), c.sub( a ) ).normalize();
			expect( winding.dot( new THREE.Vector3().fromBufferAttribute( normal, 0 ) ) ).toBeGreaterThan( 0 );
			expect( mesh.position ).toEqual( new THREE.Vector3() );
			expect( mesh.quaternion.toArray() ).toEqual( [ 0, 0, 0, 1 ] );
			expect( mesh.scale ).toEqual( new THREE.Vector3( 1, 1, 1 ) );
		}

	} );

	it( 'uses stable base-color materials without clipping or source texture mutation', () => {

		const map = new THREE.Texture();
		const alphaMap = new THREE.Texture();
		const source = new THREE.MeshStandardMaterial( { map, alphaMap, color: 0x7f3210, vertexColors: true } );
		source.clippingPlanes = [ new THREE.Plane() ];
		const material = createBoundaryShellMaterial( source );

		expect( material ).toMatchObject( { map, alphaMap, color: new THREE.Color( 0x7f3210 ), vertexColors: true, clippingPlanes: null, toneMapped: false, side: THREE.DoubleSide } );

	} );

} );

function createSlopedPrismGeometry(): THREE.BufferGeometry {

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [
		- 1, 0, - 1, 1, 0, - 1, - 1, 1, - 1, 1, 3, - 1,
		- 1, 0, 1, 1, 0, 1, - 1, 1, 1, 1, 3, 1
	], 3 ) );
	geometry.setIndex( [
		0, 1, 3, 0, 3, 2,
		4, 7, 5, 4, 6, 7,
		0, 5, 1, 0, 4, 5,
		0, 2, 6, 0, 6, 4,
		1, 5, 7, 1, 7, 3,
		2, 3, 7, 2, 7, 6
	] );
	geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( [ 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 1, 1, 1 ], 2 ) );
	geometry.computeVertexNormals();
	return geometry;

}

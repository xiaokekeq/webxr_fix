import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildEnclosureShell, createBoundaryShellMaterial } from './enclosure-shell-builder.js';
import { resolveModelBoundarySurfaces } from './model-boundary-surface-resolver.js';

describe( 'model conforming shell', () => {

	it( 'uses the five real boundary surfaces of a sloped model instead of Box3 rectangles', () => {

		const model = new THREE.Group();
		model.add( new THREE.Mesh( createSlopedPrismGeometry(), new THREE.MeshStandardMaterial( { color: 0x6f4f35 } ) ) );
		const resolved = resolveModelBoundarySurfaces( model );

		expect( resolved.ok ).toBe( true );
		if ( resolved.ok ) {
			expect( resolved.surfaces.map( ( surface ) => surface.face ) ).toEqual( [ 'front', 'back', 'left', 'right', 'bottom' ] );
			expect( resolved.surfaces.find( ( surface ) => surface.face === 'left' )?.geometry.boundingBox?.max.y ).toBeCloseTo( 1 );
			expect( resolved.bounds.max.y ).toBeCloseTo( 3 );
			for ( const surface of resolved.surfaces ) expect( surface.triangleCount ).toBeGreaterThan( 0 );
		}

	} );

	it( 'creates exactly five double-sided meshes with the original UVs and material groups', () => {

		const geometry = createSlopedPrismGeometry();
		geometry.clearGroups();
		geometry.addGroup( 0, 6, 0 );
		geometry.addGroup( 6, 24, 1 );
		const sourceMaterials = [ new THREE.MeshStandardMaterial( { color: 0xff0000 } ), new THREE.MeshStandardMaterial( { color: 0x00ff00 } ) ];
		const model = new THREE.Group();
		model.add( new THREE.Mesh( geometry, sourceMaterials ) );
		const result = buildEnclosureShell( model );

		expect( result.ok ).toBe( true );
		if ( result.ok ) {
			expect( result.root.name ).toBe( '__model-conforming-shell' );
			expect( result.meshCount ).toBe( 5 );
			expect( result.root.children.map( ( child ) => child.name ) ).toEqual( [ '__shell-front', '__shell-back', '__shell-left', '__shell-right', '__shell-bottom' ] );
			for ( const child of result.root.children ) {
				const mesh = child as THREE.Mesh;
				expect( mesh.userData.__modelConformingShell ).toBe( true );
				expect( mesh.geometry.getAttribute( 'uv' ) ).toBeDefined();
				for ( const material of Array.isArray( mesh.material ) ? mesh.material : [ mesh.material ] ) expect( material.side ).toBe( THREE.DoubleSide );
			}
			expect( result.epsilon ).toBeGreaterThan( 0 );
		}

	} );

	it( 'uses stable base-color materials without clipping or source texture mutation', () => {

		const map = new THREE.Texture();
		const alphaMap = new THREE.Texture();
		const source = new THREE.MeshStandardMaterial( { map, alphaMap, color: 0x7f3210, vertexColors: true } );
		source.clippingPlanes = [ new THREE.Plane() ];
		const material = createBoundaryShellMaterial( source );

		expect( material ).toMatchObject( { map, alphaMap, color: new THREE.Color( 0x7f3210 ), vertexColors: true, clippingPlanes: null, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: - 1, polygonOffsetUnits: - 1 } );

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

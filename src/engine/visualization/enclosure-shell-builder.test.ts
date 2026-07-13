import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
	buildEnclosureShell,
	runEnclosureFaceGeometrySelfCheck,
	validateEnclosureFaceGeometry
} from './enclosure-shell-builder.js';

describe( 'enclosure shell builder', () => {

	it( 'runs the asymmetric five-face geometry check as a test', () => {

		expect( () => runEnclosureFaceGeometrySelfCheck() ).not.toThrow();
		const validation = validateEnclosureFaceGeometry( new THREE.Box3(
			new THREE.Vector3( - 2, - 3, - 5 ),
			new THREE.Vector3( 7, 11, 13 )
		) );
		expect( validation ).toEqual( {
			ok: true,
			triangleCount: 10,
			boundaryCornersConnected: true
		} );

	} );

	it.each( [
		[ 'empty-model', new THREE.Group() ],
		[ 'degenerate-bounds', groupWithMesh( new THREE.PlaneGeometry( 2, 2 ), new THREE.MeshBasicMaterial() ) ],
		[ 'material-source-missing', groupWithMesh( new THREE.BoxGeometry( 2, 3, 4 ), [] ) ]
	] )( 'returns %s instead of throwing', ( reason, model ) => {

		const result = buildEnclosureShell( model );
		expect( result.ok ).toBe( false );
		if ( result.ok === false ) expect( result.reason ).toBe( reason );

	} );

	it( 'builds exactly five faces for a valid model', () => {

		const model = groupWithMesh( new THREE.BoxGeometry( 2, 3, 4 ), new THREE.MeshBasicMaterial() );
		const result = buildEnclosureShell( model );

		expect( result.ok ).toBe( true );
		if ( result.ok === true ) {
			expect( result.meshCount ).toBe( 5 );
			expect( result.renderableCount ).toBe( 1 );
			expect( result.root.children.map( ( child ) => child.name ) ).toEqual( [
				'__enclosure-front',
				'__enclosure-back',
				'__enclosure-left',
				'__enclosure-right',
				'__enclosure-bottom'
			] );
		}

	} );

} );

function groupWithMesh(
	geometry: THREE.BufferGeometry,
	material: THREE.Material | THREE.Material[]
): THREE.Group {

	const group = new THREE.Group();
	group.add( new THREE.Mesh( geometry, material ) );
	return group;

}

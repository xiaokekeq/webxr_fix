import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MaterialStateRuntime } from './material-state-runtime.js';
import { TexturedEnclosureShell } from './textured-enclosure-shell.js';

describe( 'TexturedEnclosureShell', () => {

	it( 'controls the cloned unified shell as one root group', () => {

		const model = new THREE.Group();
		model.add( new THREE.Mesh( new THREE.BoxGeometry( 2, 3, 4 ), new THREE.MeshBasicMaterial() ) );
		const shell = new TexturedEnclosureShell();
		const result = shell.rebuildForModel( { model } );
		expect( result.ok ).toBe( true );

		const placedModel = model.clone( true );
		shell.sync( placedModel, 'complete' );
		expect( placedModel.getObjectByName( '__model-conforming-shell' )?.visible ).toBe( false );
		shell.sync( placedModel, 'layer-peeling' );
		expect( placedModel.getObjectByName( '__model-conforming-shell' )?.visible ).toBe( true );
		shell.sync( placedModel, 'section-cut' );
		expect( placedModel.getObjectByName( '__model-conforming-shell' )?.visible ).toBe( true );
		shell.sync( placedModel, 'complete' );
		expect( placedModel.getObjectByName( '__model-conforming-shell' )?.visible ).toBe( false );
		const materials = new MaterialStateRuntime();
		materials.setRoot( placedModel );
		materials.applySection( new THREE.Plane( new THREE.Vector3( 0, 1, 0 ), 0 ) );
		materials.applyMaterial( 'xray', 50 );
		const surface = placedModel.getObjectByName( '__model-conforming-shell-surface' ) as THREE.Mesh;
		expect( ( surface.material as THREE.MeshBasicMaterial ).opacity ).toBe( 1 );
		expect( ( surface.material as THREE.MeshBasicMaterial ).clippingPlanes ).toBeNull();
		materials.restore();
		shell.dispose();

	} );

	it( 'keeps layer-peeling and section-cut shells free of internal horizontal faces', () => {

		const model = new THREE.Group();
		model.add( new THREE.Mesh( createLayeredBaseGeometry(), new THREE.MeshBasicMaterial() ) );
		const upperLayer = new THREE.Mesh( createTriangleGeometry( [ 0, 2, 0, 0, 2, 1, 1, 2, 0 ] ), new THREE.MeshBasicMaterial() );
		upperLayer.name = 'upper-layer';
		model.add( upperLayer );
		const shell = new TexturedEnclosureShell();

		expect( shell.rebuildForModel( { model } ).ok ).toBe( true );
		const placedModel = model.clone( true );
		const placedUpperLayer = placedModel.getObjectByName( 'upper-layer' );
		placedUpperLayer!.visible = false;
		shell.sync( placedModel, 'layer-peeling' );
		const shellRoot = placedModel.getObjectByName( '__model-conforming-shell' )!;
		const surface = placedModel.getObjectByName( '__model-conforming-shell-surface' ) as THREE.Mesh;

		expect( placedUpperLayer!.visible ).toBe( false );
		expect( shellRoot.visible ).toBe( true );
		expect( hasHorizontalTriangleAtY( surface.geometry, 1 ) ).toBe( false );
		shell.sync( placedModel, 'section-cut' );
		expect( shellRoot.visible ).toBe( true );
		expect( hasHorizontalTriangleAtY( surface.geometry, 1 ) ).toBe( false );
		shell.dispose();

	} );

} );

function createLayeredBaseGeometry(): THREE.BufferGeometry {

	return createTriangleGeometry( [
		0, 0, 0, 1, 0, 0, 0, 0, 1,
		0, 1, 0, 1, 1, 0, 0, 1, 1,
		2, 0, 0, 2, 1, 0, 2, 0, 1
	] );

}

function createTriangleGeometry(positions: number[]): THREE.BufferGeometry {

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	return geometry;

}

function hasHorizontalTriangleAtY(geometry: THREE.BufferGeometry, y: number): boolean {

	const position = geometry.getAttribute( 'position' );
	for ( let index = 0; index < position.count; index += 3 ) {
		if ( [ position.getY( index ), position.getY( index + 1 ), position.getY( index + 2 ) ].every( ( value ) => Math.abs( value - y ) < 1e-5 ) ) return true;
	}
	return false;

}

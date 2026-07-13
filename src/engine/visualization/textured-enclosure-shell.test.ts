import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MaterialStateRuntime } from './material-state-runtime.js';
import { TexturedEnclosureShell } from './textured-enclosure-shell.js';

describe( 'TexturedEnclosureShell', () => {

	it( 'controls the cloned five-face shell as one root group', () => {

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
		expect( ( ( placedModel.getObjectByName( '__shell-front' ) as THREE.Mesh ).material as THREE.MeshBasicMaterial ).opacity ).toBe( 1 );
		expect( ( ( placedModel.getObjectByName( '__shell-front' ) as THREE.Mesh ).material as THREE.MeshBasicMaterial ).clippingPlanes ).toBeNull();
		materials.restore();
		shell.dispose();

	} );

} );

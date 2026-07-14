import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createLayerVisibilityController } from './layer-visibility.js';
import { MaterialStateRuntime } from './material-state-runtime.js';
import { SectionCapRuntime } from './section-cap-runtime.js';
import { TexturedEnclosureShell } from './textured-enclosure-shell.js';

describe( 'TexturedEnclosureShell', () => {

	it( 'does nothing until auto is explicitly enabled', () => {

		const model = new THREE.Group();
		const material = new THREE.MeshBasicMaterial();
		const source = new THREE.Mesh( new THREE.BoxGeometry( 2, 3, 4 ), material );
		model.add( source );
		const shell = new TexturedEnclosureShell();

		const disabled = shell.rebuildForModel( { model } );
		expect( disabled ).toMatchObject( { ok: true, rebuilt: false, source: 'disabled' } );
		expect( model.children ).toEqual( [ source ] );
		expect( source.material ).toBe( material );
		expect( model.getObjectByName( '__model-conforming-shell' ) ).toBeUndefined();

		const auto = shell.rebuildForModel( { model, enclosureShell: { source: 'auto' } } );
		expect( auto ).toMatchObject( { ok: true, rebuilt: true, source: 'auto' } );
		expect( model.getObjectByName( '__model-conforming-shell' ) ).toBeDefined();
		shell.dispose();

	} );

	it( 'controls the explicitly enabled auto shell as one root group', () => {

		const model = new THREE.Group();
		model.add( new THREE.Mesh( new THREE.BoxGeometry( 2, 3, 4 ), new THREE.MeshBasicMaterial() ) );
		const shell = new TexturedEnclosureShell();
		const result = shell.rebuildForModel( { model, enclosureShell: { source: 'auto' } } );
		expect( result.ok ).toBe( true );

		const placedModel = model.clone( true );
		shell.sync( placedModel, 'complete' );
		expect( placedModel.getObjectByName( '__model-conforming-shell' )?.visible ).toBe( false );
		shell.sync( placedModel, 'layer-peeling' );
		expect( placedModel.getObjectByName( '__model-conforming-shell' )?.visible ).toBe( true );
		shell.sync( placedModel, 'section-cut' );
		expect( placedModel.getObjectByName( '__model-conforming-shell' )?.visible ).toBe( true );
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

	it( 'uses the exact Blender object without copying it and excludes it before layer indexing', () => {

		const model = new THREE.Group();
		const layer = new THREE.Mesh( createTriangleGeometry( [ 0, 2, 0, 1, 2, 0, 0, 2, 1 ] ), new THREE.MeshBasicMaterial() );
		layer.userData.__layerSelectable = true;
		layer.userData.__layerId = 'soil';
		const enclosure = new THREE.Group();
		enclosure.name = 'AR_ENCLOSURE_SHELL';
		const enclosureMaterial = new THREE.MeshBasicMaterial();
		const enclosureMesh = new THREE.Mesh( new THREE.BoxGeometry( 2, 2, 2 ), enclosureMaterial );
		enclosure.add( enclosureMesh );
		model.add( layer, enclosure );
		const shell = new TexturedEnclosureShell();

		shell.prepareModel( model, { source: 'model-object', objectName: 'AR_ENCLOSURE_SHELL' } );
		expect( createLayerVisibilityController().rebuild( { modelRoot: model, pipesByName: new Map() } ).map( ( item ) => item.id ) ).toEqual( [ 'soil' ] );
		const result = shell.rebuildForModel( {
			model,
			enclosureShell: { source: 'model-object', objectName: 'AR_ENCLOSURE_SHELL' }
		} );

		expect( result ).toMatchObject( { ok: true, rebuilt: false, source: 'model-object' } );
		expect( model.getObjectByName( 'AR_ENCLOSURE_SHELL' ) ).toBe( enclosure );
		expect( enclosureMesh.material ).toBe( enclosureMaterial );
		expect( model.getObjectByName( '__model-conforming-shell' ) ).toBeUndefined();
		for ( const object of [ enclosure, enclosureMesh ] ) {
			expect( object.userData ).toMatchObject( {
				__modelConformingShell: true,
				__enclosureShell: true,
				__excludeFromLayerIndex: true,
				__excludeFromPicking: true,
				__excludeFromSectionCap: true,
				__excludeFromBoundarySurface: true
			} );
		}

		shell.sync( model, 'complete' );
		expect( enclosure.visible ).toBe( true );
		shell.sync( model, 'layer-peeling' );
		expect( enclosure.visible ).toBe( true );
		shell.sync( model, 'section-cut' );
		expect( enclosure.visible ).toBe( true );
		const caps = new SectionCapRuntime();
		caps.sync( model, new THREE.Plane( new THREE.Vector3( 0, 1, 0 ), 0 ) );
		expect( caps.getDebug().sectionCapExists ).toBe( false );
		caps.dispose();

	} );

	it( 'fails soft when the requested explicit object does not exist', () => {

		const model = new THREE.Group();
		const source = new THREE.Mesh( new THREE.BoxGeometry(), new THREE.MeshBasicMaterial() );
		source.name = 'AR_ENCLOSURE_SHELL_OLD';
		model.add( source );
		const result = new TexturedEnclosureShell().rebuildForModel( {
			model,
			enclosureShell: { source: 'model-object', objectName: 'AR_ENCLOSURE_SHELL' }
		} );

		expect( result ).toMatchObject( { ok: false, reason: 'object-not-found' } );
		expect( source.userData.__enclosureShell ).toBeUndefined();
		expect( model.children ).toEqual( [ source ] );

	} );

	it( 'keeps layer-peeling and section-cut auto shells free of internal horizontal faces', () => {

		const model = new THREE.Group();
		model.add( new THREE.Mesh( createLayeredBaseGeometry(), new THREE.MeshBasicMaterial() ) );
		const upperLayer = new THREE.Mesh( createTriangleGeometry( [ 0, 2, 0, 0, 2, 1, 1, 2, 0 ] ), new THREE.MeshBasicMaterial() );
		upperLayer.name = 'upper-layer';
		model.add( upperLayer );
		const shell = new TexturedEnclosureShell();

		expect( shell.rebuildForModel( { model, enclosureShell: { source: 'auto' } } ).ok ).toBe( true );
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

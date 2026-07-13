import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { MaterialStateRuntime } from './material-state-runtime.js';
import { TexturedEnclosureShell } from './textured-enclosure-shell.js';

describe( 'TexturedEnclosureShell', () => {

	it( 'controls the cloned five-face shell as one root group', () => {

		const model = new THREE.Group();
		model.add( new THREE.Mesh( new THREE.BoxGeometry( 2, 3, 4 ), new THREE.MeshBasicMaterial() ) );
		const shell = new TexturedEnclosureShell();
		const result = shell.rebuildForModel( { model, renderer: createRenderer() } );
		expect( result.ok ).toBe( true );

		const placedModel = model.clone( true );
		shell.sync( placedModel, 'layer-peeling' );
		expect( placedModel.getObjectByName( '__textured-enclosure-shell' )?.visible ).toBe( true );
		shell.sync( placedModel, 'section-cut' );
		expect( placedModel.getObjectByName( '__textured-enclosure-shell' )?.visible ).toBe( false );
		shell.sync( placedModel, 'complete' );
		expect( placedModel.getObjectByName( '__textured-enclosure-shell' )?.visible ).toBe( false );
		const materials = new MaterialStateRuntime();
		materials.setRoot( placedModel );
		materials.applyMaterial( 'xray', 50 );
		expect( ( ( placedModel.getObjectByName( '__enclosure-front' ) as THREE.Mesh ).material as THREE.MeshBasicMaterial ).opacity ).toBe( 1 );
		materials.restore();
		shell.dispose();

	} );

} );

function createRenderer(): THREE.WebGLRenderer {

	let target: THREE.RenderTarget | null = null;
	const color = new THREE.Color();
	return {
		clear: vi.fn(),
		getClearAlpha: () => 0,
		getClearColor: ( next: THREE.Color ) => next.copy( color ),
		getRenderTarget: () => target,
		render: vi.fn(),
		setClearColor: vi.fn(),
		setRenderTarget: ( next: THREE.RenderTarget | null ) => { target = next; }
	} as unknown as THREE.WebGLRenderer;

}

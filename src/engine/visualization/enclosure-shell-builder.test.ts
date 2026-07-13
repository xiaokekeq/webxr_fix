import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
	buildEnclosureShell,
	runEnclosureFaceGeometrySelfCheck,
	validateEnclosureFaceGeometry,
	type EnclosureOffscreenRenderer
} from './enclosure-shell-builder.js';

describe( 'enclosure shell builder', () => {

	it( 'runs the asymmetric five-face geometry check as a test', () => {

		expect( () => runEnclosureFaceGeometrySelfCheck() ).not.toThrow();
		expect( validateEnclosureFaceGeometry( new THREE.Box3( new THREE.Vector3( - 2, - 3, - 5 ), new THREE.Vector3( 7, 11, 13 ) ) ) ).toEqual( {
			ok: true,
			triangleCount: 10,
			boundaryCornersConnected: true
		} );

	} );

	it.each( [
		[ 'empty-model', new THREE.Group() ],
		[ 'degenerate-bounds', groupWithMesh( new THREE.PlaneGeometry( 2, 2 ) ) ]
	] )( 'returns %s instead of rendering', ( reason, model ) => {

		const { renderer, render } = createRenderer();
		const result = buildEnclosureShell( model, { renderer } );
		expect( result.ok ).toBe( false );
		if ( result.ok === false ) expect( result.reason ).toBe( reason );
		expect( render ).not.toHaveBeenCalled();

	} );

	it( 'renders a complete multi-mesh model exactly five times into exactly five fixed faces', () => {

		const model = groupWithMesh( new THREE.BoxGeometry( 2, 3, 4 ) );
		model.add( new THREE.Mesh( new THREE.BoxGeometry( 1, 1, 1 ), new THREE.MeshBasicMaterial() ) );
		const helper = new THREE.Mesh( new THREE.BoxGeometry( 1, 1, 1 ), new THREE.MeshBasicMaterial() );
		helper.name = 'ignored-helper';
		helper.position.x = 100;
		helper.userData.__excludeFromLayerIndex = true;
		model.add( helper );
		const { renderer, render } = createRenderer();
		const result = buildEnclosureShell( model, { renderer } );

		expect( result.ok ).toBe( true );
		if ( result.ok === true ) {
			expect( result.renderableCount ).toBe( 2 );
			expect( result.meshCount ).toBe( 5 );
			expect( render ).toHaveBeenCalledTimes( 5 );
			expect( result.bounds.max.x ).toBe( 1 );
			expect( ( render.mock.calls[ 0 ][ 0 ] as THREE.Scene ).getObjectByName( 'ignored-helper' )?.visible ).toBe( false );
			expect( result.root.children.map( ( child ) => child.name ) ).toEqual( [
				'__enclosure-front', '__enclosure-back', '__enclosure-left', '__enclosure-right', '__enclosure-bottom'
			] );
			expect( Array.from( ( result.root.getObjectByName( '__enclosure-front' ) as THREE.Mesh ).geometry.getAttribute( 'uv' ).array ) ).toEqual( [ 1, 0, 1, 1, 0, 1, 0, 0 ] );
			expect( Array.from( ( result.root.getObjectByName( '__enclosure-bottom' ) as THREE.Mesh ).geometry.getAttribute( 'uv' ).array ) ).toEqual( [ 1, 1, 0, 1, 0, 0, 1, 0 ] );
			expect( ( result.root.getObjectByName( '__enclosure-front' ) as THREE.Mesh ).material ).toMatchObject( { transparent: true, alphaTest: 0.001, depthWrite: false } );
		}

	} );

} );

function createRenderer(): { renderer: EnclosureOffscreenRenderer; render: ReturnType<typeof vi.fn> } {

	let target: THREE.RenderTarget | null = null;
	let clearColor = new THREE.Color();
	let clearAlpha = 0;
	const render = vi.fn();
	return {
		renderer: {
			clear: vi.fn(),
			getClearAlpha: () => clearAlpha,
			getClearColor: ( color: THREE.Color ) => color.copy( clearColor ),
			getRenderTarget: () => target,
			render: ( scene: THREE.Scene, camera: THREE.Camera ) => render( scene, camera ),
			setClearColor: ( color: THREE.ColorRepresentation, alpha = 1 ) => { clearColor = new THREE.Color( color ); clearAlpha = alpha; },
			setRenderTarget: ( nextTarget: THREE.RenderTarget | null ) => { target = nextTarget; }
		} as unknown as EnclosureOffscreenRenderer,
		render
	};

}

function groupWithMesh(geometry: THREE.BufferGeometry): THREE.Group {

	const group = new THREE.Group();
	group.add( new THREE.Mesh( geometry, new THREE.MeshBasicMaterial() ) );
	return group;

}

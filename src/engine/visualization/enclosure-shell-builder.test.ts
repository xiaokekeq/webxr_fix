import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
	analyzeEnclosureCapturePixels,
	buildEnclosureShell,
	createEnclosureBakeMaterial,
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

	it( 'bakes all eligible source meshes into five fixed double-sided faces', () => {

		const model = groupWithMesh( new THREE.BoxGeometry( 2, 3, 4 ) );
		const indexExcludedSurface = new THREE.Mesh( new THREE.BoxGeometry( 1, 1, 1 ), new THREE.MeshBasicMaterial() );
		indexExcludedSurface.position.x = 100;
		indexExcludedSurface.userData.__excludeFromLayerIndex = true;
		model.add( indexExcludedSurface );
		const helper = new THREE.Mesh( new THREE.BoxGeometry( 1, 1, 1 ), new THREE.MeshBasicMaterial() );
		helper.position.x = 200;
		helper.userData.__nonSelectableHelper = true;
		model.add( helper );
		const { renderer, render } = createRenderer();
		const result = buildEnclosureShell( model, { renderer } );

		expect( result.ok ).toBe( true );
		if ( result.ok === true ) {
			expect( result.renderableCount ).toBe( 2 );
			expect( result.meshCount ).toBe( 5 );
			expect( result.bounds.max.x ).toBe( 100.5 );
			expect( render ).toHaveBeenCalledTimes( 5 );
			expect( result.root.children.map( ( child ) => child.name ) ).toEqual( [
				'__enclosure-front', '__enclosure-back', '__enclosure-left', '__enclosure-right', '__enclosure-bottom'
			] );
			for ( const child of result.root.children ) expect( ( child as THREE.Mesh ).material ).toMatchObject( { side: THREE.DoubleSide, transparent: true, alphaTest: 0.001, depthWrite: false, toneMapped: false } );
			expect( Array.from( ( result.root.getObjectByName( '__enclosure-front' ) as THREE.Mesh ).geometry.getAttribute( 'uv' ).array ) ).toEqual( [ 1, 0, 1, 1, 0, 1, 0, 0 ] );
			expect( Array.from( ( result.root.getObjectByName( '__enclosure-bottom' ) as THREE.Mesh ).geometry.getAttribute( 'uv' ).array ) ).toEqual( [ 1, 1, 0, 1, 0, 0, 1, 0 ] );
		}

	} );

	it( 'converts source materials to unlit base-color bake materials without touching textures', () => {

		const map = new THREE.Texture();
		const alphaMap = new THREE.Texture();
		const source = new THREE.MeshStandardMaterial( { map, alphaMap, color: 0x7f3210, vertexColors: true, roughness: 0.2, metalness: 0.8 } );
		source.clippingPlanes = [ new THREE.Plane() ];
		const baked = createEnclosureBakeMaterial( source );

		expect( baked ).toMatchObject( { map, alphaMap, color: new THREE.Color( 0x7f3210 ), vertexColors: true, clippingPlanes: null, toneMapped: false, side: THREE.DoubleSide } );
		expect( ( baked as unknown as { roughness?: number; metalness?: number; envMap?: THREE.Texture | null } ).roughness ).toBeUndefined();
		expect( ( baked as unknown as { roughness?: number; metalness?: number; envMap?: THREE.Texture | null } ).metalness ).toBeUndefined();
		expect( ( baked as unknown as { roughness?: number; metalness?: number; envMap?: THREE.Texture | null } ).envMap ).toBeNull();

	} );

	it( 'keeps material groups when baking a multi-material mesh', () => {

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [ - 1, - 1, - 1, 1, - 1, - 1, 0, 1, - 1, - 1, - 1, 1, 1, - 1, 1, 0, 1, 1 ], 3 ) );
		geometry.addGroup( 0, 3, 0 );
		geometry.addGroup( 3, 3, 1 );
		const model = groupWithMesh( new THREE.BoxGeometry( 2, 2, 2 ) );
		model.add( new THREE.Mesh( geometry, [ new THREE.MeshStandardMaterial( { color: 0xff0000 } ), new THREE.MeshStandardMaterial( { color: 0x00ff00 } ) ] ) );
		const { renderer, render } = createRenderer();

		const result = buildEnclosureShell( model, { renderer } );
		expect( result.ok ).toBe( true );
		const bakedMesh = ( render.mock.calls[ 0 ][ 0 ] as THREE.Scene ).children.find( ( child ) => child instanceof THREE.Mesh && child.geometry === geometry ) as THREE.Mesh;
		expect( bakedMesh.material ).toHaveLength( 2 );
		expect( geometry.groups ).toEqual( [ { start: 0, count: 3, materialIndex: 0 }, { start: 3, count: 3, materialIndex: 1 } ] );

	} );

	it( 'distinguishes transparent background from opaque black capture pixels', () => {

		const stats = analyzeEnclosureCapturePixels( 'front', new Uint8Array( [ 0, 0, 0, 0, 0, 0, 0, 255, 12, 18, 24, 255 ] ) );
		expect( stats.transparentPixelRatio ).toBeCloseTo( 1 / 3 );
		expect( stats.opaquePixelRatio ).toBeCloseTo( 2 / 3 );
		expect( stats.opaqueBlackPixelRatio ).toBeCloseTo( 1 / 3 );

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
			readRenderTargetPixels: ( _target: THREE.WebGLRenderTarget, _x: number, _y: number, _width: number, _height: number, buffer: Uint8Array ) => buffer.fill( 0 ),
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

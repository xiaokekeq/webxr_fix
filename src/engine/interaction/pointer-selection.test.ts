import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { ARSceneBundle } from '@/features/ar/types/runtime-types.js';
import { createPointerSelectionSession } from './pointer-selection.js';
import { createPropertySelectionController } from './property-selection.js';

describe( 'pointer selection', () => {

	it( 'clears a pipe selection when it is tapped twice', () => {

		const camera = new THREE.PerspectiveCamera( 60, 1, 0.1, 100 );
		camera.position.set( 0, 0, 5 );
		camera.lookAt( 0, 0, 0 );
		camera.updateProjectionMatrix();
		camera.updateMatrixWorld();

		const pipe = new THREE.Mesh( new THREE.BoxGeometry( 1, 1, 1 ), new THREE.MeshBasicMaterial() );
		pipe.name = 'Line014';
		const placedModel = new THREE.Group();
		placedModel.add( pipe );
		placedModel.updateMatrixWorld( true );

		const propertySelection = createPropertySelectionController( {} );
		const onSelectionApplied = vi.fn();
		const onSelectionCleared = vi.fn();
		const session = createPointerSelectionSession( {
			sceneBundle: {
				camera,
				renderer: {
					domElement: { getBoundingClientRect: () => ( { left: 0, top: 0, width: 100, height: 100 } ) },
					xr: { isPresenting: false, getCamera: () => camera }
				}
			} as unknown as ARSceneBundle,
			propertySelection,
			setStatus: vi.fn(),
			onInspectSelection: vi.fn(),
			onSelectionApplied,
			onSelectionCleared,
			getPlacedModel: () => placedModel,
			getWorkspaceMode: () => 'browse',
			getPipesByName: () => new Map( [ [ 'Line014', { name: 'Line014' } ] ] )
		} );

		session.handleScreenPointerDown( 50, 50 );
		session.handleScreenPointerUp( 50, 50 );
		expect( onSelectionApplied ).toHaveBeenCalledTimes( 1 );
		expect( propertySelection.isSelectedBusinessObject( pipe ) ).toBe( true );

		session.handleScreenPointerDown( 50, 50 );
		session.handleScreenPointerUp( 50, 50 );
		expect( onSelectionCleared ).toHaveBeenCalledTimes( 1 );
		expect( propertySelection.isSelectedBusinessObject( pipe ) ).toBe( false );

	} );

	it( 'treats separate meshes for one component as the same pipe', () => {

		const camera = new THREE.PerspectiveCamera( 60, 1, 0.1, 100 );
		camera.position.set( 0, 0, 5 );
		camera.lookAt( 0, 0, 0 );
		camera.updateProjectionMatrix();
		camera.updateMatrixWorld();

		const pipeRoot = new THREE.Group();
		pipeRoot.name = 'Line014';
		pipeRoot.userData = { __layerSelectable: true, componentId: 'WN-74-76-001' };
		const leftMesh = new THREE.Mesh( new THREE.BoxGeometry( 0.6, 0.6, 0.6 ), new THREE.MeshBasicMaterial() );
		leftMesh.position.x = -1;
		const rightMesh = new THREE.Mesh( new THREE.BoxGeometry( 0.6, 0.6, 0.6 ), new THREE.MeshBasicMaterial() );
		rightMesh.position.x = 1;
		pipeRoot.add( leftMesh, rightMesh );
		const placedModel = new THREE.Group();
		placedModel.add( pipeRoot );
		placedModel.updateMatrixWorld( true );

		const propertySelection = createPropertySelectionController( {} );
		const onSelectionApplied = vi.fn();
		const onSelectionCleared = vi.fn();
		const session = createPointerSelectionSession( {
			sceneBundle: {
				camera,
				renderer: {
					domElement: { getBoundingClientRect: () => ( { left: 0, top: 0, width: 100, height: 100 } ) },
					xr: { isPresenting: false, getCamera: () => camera }
				}
			} as unknown as ARSceneBundle,
			propertySelection,
			setStatus: vi.fn(),
			onInspectSelection: vi.fn(),
			onSelectionApplied,
			onSelectionCleared,
			getPlacedModel: () => placedModel,
			getWorkspaceMode: () => 'browse',
			getPipesByName: () => new Map( [ [ 'Line014', { name: 'Line014', code: 'WN-74-76-001' } ] ] )
		} );

		session.handleScreenPointerDown( 33, 50 );
		session.handleScreenPointerUp( 33, 50 );
		expect( onSelectionApplied ).toHaveBeenCalledTimes( 1 );

		session.handleScreenPointerDown( 67, 50 );
		session.handleScreenPointerUp( 67, 50 );
		expect( onSelectionCleared ).toHaveBeenCalledTimes( 1 );
		expect( propertySelection.isSelectedComponent( 'WN-74-76-001' ) ).toBe( false );

	} );

	it( 'clears a selection after a blank-scene tap', () => {

		const propertySelection = createPropertySelectionController( {} );
		const selected = new THREE.Mesh( new THREE.BoxGeometry(), new THREE.MeshBasicMaterial() );
		selected.userData.componentId = 'WN-blank-test';
		propertySelection.selectBusinessObject( selected, { name: 'Line014', code: 'WN-blank-test' } );
		propertySelection.clearSelection();

		expect( propertySelection.isSelectedComponent( 'WN-blank-test' ) ).toBe( false );

	} );

	it( 'lets the XR pre-selection branch win before pipe picking', () => {

		const camera = new THREE.PerspectiveCamera( 60, 1, 0.1, 100 );
		camera.position.set( 0, 0, 5 );
		camera.lookAt( 0, 0, 0 );
		camera.updateMatrixWorld();
		const pipe = new THREE.Mesh( new THREE.BoxGeometry(), new THREE.MeshBasicMaterial() );
		const placedModel = new THREE.Group();
		placedModel.add( pipe );
		placedModel.updateMatrixWorld( true );
		const handlePreSelectionRaycast = vi.fn( () => true );
		const onSelectionApplied = vi.fn();
		const session = createPointerSelectionSession( {
			sceneBundle: {
				camera,
				renderer: {
					domElement: { getBoundingClientRect: () => ( { left: 0, top: 0, width: 100, height: 100 } ) },
					xr: { isPresenting: true, getCamera: () => camera }
				}
			} as unknown as ARSceneBundle,
			propertySelection: createPropertySelectionController( {} ),
			setStatus: vi.fn(),
			onInspectSelection: vi.fn(),
			onSelectionApplied,
			handlePreSelectionRaycast,
			getPlacedModel: () => placedModel,
			getWorkspaceMode: () => 'browse',
			getPipesByName: () => new Map()
		} );

		session.handleArSelect();

		expect( handlePreSelectionRaycast ).toHaveBeenCalledOnce();
		expect( handlePreSelectionRaycast ).toHaveBeenCalledWith( expect.objectContaining( { source: 'xr-select' } ) );
		expect( onSelectionApplied ).not.toHaveBeenCalled();

	} );

	it( 'falls back to XR screen select until the pointer path is observed', () => {

		const handlePreSelectionRaycast = vi.fn( () => true );
		const session = createPointerSelectionSession( {
			sceneBundle: {
				camera: new THREE.PerspectiveCamera(),
				renderer: {
					domElement: { getBoundingClientRect: () => ( { left: 0, top: 0, width: 100, height: 100 } ) },
					xr: { isPresenting: true, getCamera: () => new THREE.PerspectiveCamera() }
				}
			} as unknown as ARSceneBundle,
			propertySelection: createPropertySelectionController( {} ),
			setStatus: vi.fn(),
			onInspectSelection: vi.fn(),
			handlePreSelectionRaycast,
			getPlacedModel: () => null,
			getWorkspaceMode: () => 'browse',
			getPipesByName: () => new Map()
		} );

		const screenSelectEvent = {
			inputSource: { targetRayMode: 'screen' }
		} as XRInputSourceEvent;
		session.handleArSelect( screenSelectEvent );
		expect( handlePreSelectionRaycast ).toHaveBeenCalledOnce();

		handlePreSelectionRaycast.mockClear();
		session.handleScreenPointerDown( 50, 50 );
		session.handleArSelect( screenSelectEvent );
		expect( handlePreSelectionRaycast ).not.toHaveBeenCalled();

	} );

} );

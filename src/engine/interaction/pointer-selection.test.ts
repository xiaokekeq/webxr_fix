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
			canPickModel: () => true,
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
			canPickModel: () => true,
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

	it( 'does not use screen Pointer events for world picking during an XR session', () => {

		const camera = new THREE.PerspectiveCamera( 60, 1, 0.1, 100 );
		camera.position.set( 0, 0, 5 );
		camera.lookAt( 0, 0, 0 );
		camera.updateProjectionMatrix();
		camera.updateMatrixWorld();
		const placedModel = new THREE.Group();
		placedModel.add( new THREE.Mesh( new THREE.BoxGeometry(), new THREE.MeshBasicMaterial() ) );
		placedModel.updateMatrixWorld( true );
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
			canPickModel: () => true,
			getPlacedModel: () => placedModel,
			getWorkspaceMode: () => 'browse',
			getPipesByName: () => new Map()
		} );

		session.handleScreenPointerDown( 50, 50 );
		session.handleScreenPointerUp( 50, 50 );

		expect( onSelectionApplied ).not.toHaveBeenCalled();

	} );

	it( 'uses the XR input target ray instead of the camera center', () => {

		const camera = new THREE.PerspectiveCamera( 60, 1, 0.1, 100 );
		camera.position.set( 0, 0, 5 );
		camera.updateMatrixWorld();
		const pipe = new THREE.Mesh( new THREE.BoxGeometry(), new THREE.MeshBasicMaterial() );
		pipe.name = 'OffsetPipe';
		pipe.position.x = 1;
		const placedModel = new THREE.Group();
		placedModel.add( pipe );
		placedModel.updateMatrixWorld( true );
		const referenceSpace = {} as XRReferenceSpace;
		const onSelectionApplied = vi.fn();
		const session = createPointerSelectionSession( {
			sceneBundle: {
				camera,
				renderer: {
					domElement: { getBoundingClientRect: () => ( { left: 0, top: 0, width: 100, height: 100 } ) },
					xr: {
						isPresenting: true,
						getCamera: () => camera,
						getReferenceSpace: () => referenceSpace
					}
				}
			} as unknown as ARSceneBundle,
			propertySelection: createPropertySelectionController( {} ),
			setStatus: vi.fn(),
			onInspectSelection: vi.fn(),
			onSelectionApplied,
			canPickModel: () => true,
			getPlacedModel: () => placedModel,
			getWorkspaceMode: () => 'browse',
			getPipesByName: () => new Map( [ [ 'OffsetPipe', { name: 'OffsetPipe' } ] ] )
		} );
		const transform = {
			position: { x: 1, y: 0, z: 5 },
			orientation: { x: 0, y: 0, z: 0, w: 1 }
		};

		session.handleArSelect( {
			frame: { getPose: () => ( { transform } ) },
			inputSource: { targetRaySpace: {} }
		} as unknown as XRInputSourceEvent );

		expect( onSelectionApplied ).toHaveBeenCalledTimes( 1 );

	} );

} );

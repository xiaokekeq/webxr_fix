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

} );

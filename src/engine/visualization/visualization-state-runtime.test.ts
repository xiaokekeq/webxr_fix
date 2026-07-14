import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { PlacementSession } from '@/engine/placement/session.js';
import type { RegistrationStore, RegistrationStoreState } from '@/localization/core/registration-store.js';
import { createArSectionCutController } from './ar-section-cut.js';
import { createLayerVisibilityController } from './layer-visibility.js';
import { MaterialStateRuntime } from './material-state-runtime.js';
import { SectionCapRuntime } from './section-cap-runtime.js';
import { TexturedEnclosureShell } from './textured-enclosure-shell.js';
import { VisualizationStateRuntime } from './visualization-state-runtime.js';

describe( 'VisualizationStateRuntime section caps', () => {

	it( 'runs cap geometry and material synchronization through the production clipping flow', () => {

		const parent = new THREE.Group();
		const root = new THREE.Group();
		parent.add( root );
		root.add( new THREE.Mesh( new THREE.BoxGeometry( 2, 2, 2 ), new THREE.MeshStandardMaterial( { color: 0x55734d } ) ) );
		const state = {
			appMode: 'ar-session',
			undergroundInspectionTool: 'section-cut',
			sectionCutValue: 50,
			sectionCutPlaneMode: 'horizontal-section',
			undergroundMaterialMode: 'solid',
			transparentXrayValue: 100
		} as unknown as RegistrationStoreState;
		const caps = new SectionCapRuntime();
		const runtime = new VisualizationStateRuntime( {
			store: { getState: () => state } as unknown as RegistrationStore,
			placementSession: { getArPlacedModel: () => root } as unknown as PlacementSession,
			layerVisibility: createLayerVisibilityController(),
			materialStateRuntime: new MaterialStateRuntime(),
			sectionCutController: createArSectionCutController( { localClippingEnabled: false } as unknown as THREE.WebGLRenderer ),
			enclosureShell: new TexturedEnclosureShell(),
			sectionCapRuntime: caps,
			getActiveModelSourceUuid: () => 'test-model',
			getUndergroundModelRoot: () => root,
			syncAttachmentInfoBoardVisibility: () => {}
		} );

		runtime.syncVisualizationState();
		const cap = root.getObjectByName( '__section-cap' ) as THREE.Mesh;
		const geometry = cap.geometry;
		expect( caps.getDebug() ).toMatchObject( { sectionCapExists: true, sectionCapMeshCount: 1 } );

		state.undergroundMaterialMode = 'xray';
		state.transparentXrayValue = 50;
		runtime.syncVisualizationState();
		expect( cap.geometry ).toBe( geometry );
		expect( caps.getDebug().sectionCapRebuildCount ).toBe( 1 );
		expect( cap.material ).toMatchObject( { transparent: true, opacity: 0.525 } );

		parent.position.set( 0.4, 0, 0 );
		runtime.syncVisualizationState();
		expect( caps.getDebug().sectionCapRebuildCount ).toBe( 2 );
		expect( ( root.getObjectByName( '__section-cap' ) as THREE.Mesh ).geometry ).not.toBe( geometry );

		state.undergroundInspectionTool = 'complete';
		runtime.syncVisualizationState();
		expect( root.getObjectByName( '__section-cap' ) ).toBeUndefined();

	} );

} );

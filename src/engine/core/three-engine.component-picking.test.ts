import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { PipeRecord } from '@/models/types/pipe-record.js';
import { ThreeEngine } from './three-engine.js';

describe( 'ThreeEngine component picking', () => {

	it( 'uses layer geometry for split models and keeps proxies for regular pipes', () => {

		const layerRoot = new THREE.Group();
		layerRoot.userData = {
			__businessName: 'dizhi1207__e3yhh',
			__layerId: 'dizhi1207__e3yhh',
			__layerSelectable: true
		};
		const layerMesh = new THREE.Mesh( new THREE.BoxGeometry(), new THREE.MeshBasicMaterial() );
		layerMesh.userData = {
			__businessName: 'dizhi1207__e3yhh',
			__layerId: 'dizhi1207__e3yhh'
		};
		layerRoot.add( layerMesh );

		const waterPipe = new THREE.Mesh( new THREE.BoxGeometry(), new THREE.MeshBasicMaterial() );
		waterPipe.name = 'Line014';
		const model = new THREE.Group();
		model.add( layerRoot, waterPipe );

		const addComponentPickProxy = vi.fn();
		const engine = Object.create( ThreeEngine.prototype ) as {
			prepareComponentPicking(modelTemplate: THREE.Group, pipesByName: Map<string, PipeRecord>): void;
			addComponentPickProxy(root: THREE.Object3D, componentId: string): void;
		};
		engine.addComponentPickProxy = addComponentPickProxy;
		engine.prepareComponentPicking( model, new Map( [
			[ 'dizhi1207__e3yhh', { name: 'dizhi1207__e3yhh', code: 'DAM-LAYER-01' } ],
			[ 'Line014', { name: 'Line014', code: 'WN-74-76-001' } ]
		] ) );

		expect( layerRoot.userData.componentId ).toBe( 'DAM-LAYER-01' );
		expect( layerMesh.userData.componentId ).toBeUndefined();
		expect( addComponentPickProxy ).toHaveBeenCalledOnce();
		expect( addComponentPickProxy ).toHaveBeenCalledWith( waterPipe, 'WN-74-76-001' );

	} );

} );

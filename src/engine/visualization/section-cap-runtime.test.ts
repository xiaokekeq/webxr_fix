import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SectionCapRuntime } from './section-cap-runtime.js';

describe( 'SectionCapRuntime', () => {

	it( 'never builds a section cap from the textured enclosure shell', () => {

		const root = new THREE.Group();
		const shell = new THREE.Mesh( new THREE.BoxGeometry( 2, 2, 2 ), new THREE.MeshBasicMaterial() );
		shell.userData.__enclosureShell = true;
		shell.userData.__excludeFromLayerIndex = true;
		root.add( shell );
		const runtime = new SectionCapRuntime();
		runtime.sync( root, new THREE.Plane( new THREE.Vector3( 0, 1, 0 ), 0 ) );

		expect( runtime.getDebug().sectionCapExists ).toBe( false );

	} );

} );

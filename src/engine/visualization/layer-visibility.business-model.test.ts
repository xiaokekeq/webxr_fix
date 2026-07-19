import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { PipeRecord } from '@/models/types/pipe-record.js';
import { createLayerVisibilityController } from './layer-visibility.js';

function addNamedMesh(parent: THREE.Object3D, name: string, y: number): void {

	const mesh = new THREE.Mesh( new THREE.BoxGeometry( 1, 1, 1 ) );
	mesh.name = name;
	mesh.position.y = y;
	parent.add( mesh );

}

describe( 'business model layer visibility', () => {

	it( 'indexes only named primary meshes and groups duplicate mesh names', () => {

		const root = new THREE.Group();
		const primary = new THREE.Group();
		addNamedMesh( primary, 'road', 2 );
		addNamedMesh( primary, 'soil', 1 );
		addNamedMesh( primary, 'soil', 0 );
		const context = new THREE.Group();
		context.userData.__excludeFromLayerIndex = true;
		addNamedMesh( context, 'context-only', 10 );
		root.add( primary, context );

		const pipes = new Map<string, PipeRecord>( [
			[ 'road', { name: 'road' } ],
			[ 'soil', { name: 'soil' } ],
			[ 'context-only', { name: 'context-only' } ]
		] );
		const layers = createLayerVisibilityController().rebuild( { modelRoot: root, pipesByName: pipes } );

		expect( layers.map( ( layer ) => layer.id ) ).toEqual( [ 'road', 'soil' ] );

	} );

} );

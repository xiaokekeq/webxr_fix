import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MaterialStateRuntime } from '@/engine/visualization/material-state-runtime.js';
import {
	alignSharedCoordinateTemplate,
	clipSharedCoordinateSurfaceToOwnerFootprint,
	shouldSplitAssetIntoBusinessLayers
} from './runtime.js';

function createTemplate(pivotOffset: THREE.Vector3, pointPosition: THREE.Vector3) {

	const template = new THREE.Group();
	template.scale.setScalar( 2 );
	template.userData.__placeableTemplateTransform = {
		unitScale: 2,
		pivotOffset
	};
	const content = new THREE.Group();
	content.position.copy( pivotOffset );
	const point = new THREE.Mesh( new THREE.BoxGeometry( 1, 1, 1 ), new THREE.MeshBasicMaterial() );
	point.position.copy( pointPosition );
	content.add( point );
	template.add( content );
	return { template, point };

}

describe( 'shared-coordinate model assets', () => {

	it( 'keeps context assets out of primary business-layer splitting', () => {

		expect( shouldSplitAssetIntoBusinessLayers( { role: 'context' } ) ).toBe( false );
		expect( shouldSplitAssetIntoBusinessLayers( {} ) ).toBe( true );

	} );

	it( 'keeps a common source point aligned after each asset was independently centered', () => {

		const sourcePoint = new THREE.Vector3( 12, 3, -8 );
		const primary = createTemplate( new THREE.Vector3( -4, 1, 6 ), sourcePoint );
		const context = createTemplate( new THREE.Vector3( 7, -2, -5 ), sourcePoint );
		const root = new THREE.Group();
		root.add( primary.template, context.template );

		alignSharedCoordinateTemplate( primary.template, context.template );
		root.updateMatrixWorld( true );

		expect( context.point.getWorldPosition( new THREE.Vector3() ) )
			.toEqual( primary.point.getWorldPosition( new THREE.Vector3() ) );
		expect( context.template.userData.__excludeFromPicking ).toBe( true );
		expect( context.template.userData.__excludeFromLayerIndex ).toBe( true );
		expect( context.point.userData.__excludeFromPicking ).toBe( true );
		expect( context.point.userData.__excludeFromLayerIndex ).toBe( true );

		const materials = new MaterialStateRuntime();
		materials.setRoot( root );
		materials.applyMaterial( 'xray', 50 );
		materials.applySection( new THREE.Plane( new THREE.Vector3( 1, 0, 0 ), 0 ) );
		expect( primary.point.material.opacity ).toBeLessThan( 1 );
		expect( primary.point.material.clippingPlanes ).toHaveLength( 1 );
		expect( context.point.material.opacity ).toBe( 1 );
		expect( context.point.material.clippingPlanes ).toBeNull();

	} );

	it( 'keeps a side surface inside its matching owner footprint', () => {

		const owner = createTemplate( new THREE.Vector3(), new THREE.Vector3() );
		owner.point.scale.set( 4, 1, 4 );
		const surface = new THREE.Group();
		surface.userData.__placeableTemplateTransform = {
			unitScale: 2,
			pivotOffset: new THREE.Vector3()
		};
		surface.scale.setScalar( 2 );
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [
			- 1, 0, - 1, 1, 0, - 1, 0, 0, 1,
			10, 0, 10, 12, 0, 10, 11, 0, 12
		], 3 ) );
		const mesh = new THREE.Mesh( geometry, new THREE.MeshBasicMaterial() );
		surface.add( mesh );

		clipSharedCoordinateSurfaceToOwnerFootprint( owner.template, surface );

		expect( mesh.geometry.getIndex()?.count ).toBe( 3 );

	} );

} );

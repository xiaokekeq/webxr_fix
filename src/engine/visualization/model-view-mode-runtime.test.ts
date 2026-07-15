import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ModelViewModeRuntime, resolveDefaultModelViewMode } from './model-view-mode-runtime.js';

describe( 'ModelViewModeRuntime', () => {

	it( 'keeps legacy and above-ground models in registered AR mode', () => {

		expect( resolveDefaultModelViewMode( {} ) ).toBe( 'registered-ar' );
		expect( resolveDefaultModelViewMode( { spatialType: 'above-ground' } ) ).toBe( 'registered-ar' );
		expect( resolveDefaultModelViewMode( { spatialType: 'underground', defaultViewMode: 'registered-ar' } ) ).toBe( 'registered-ar' );

	} );

	it( 'translates only the presentation root down by the configured model height', () => {

		const presentationRoot = new THREE.Group();
		presentationRoot.matrixAutoUpdate = false;
		const registrationRoot = new THREE.Group();
		registrationRoot.position.set( 4, 5, 6 );
		registrationRoot.rotation.set( 0.3, 0.7, - 0.2 );
		registrationRoot.scale.set( 2, 3, 4 );
		const model = new THREE.Group();
		model.add( new THREE.Mesh( new THREE.BoxGeometry( 2, 10, 2 ) ) );
		presentationRoot.add( registrationRoot );
		registrationRoot.add( model );
		registrationRoot.updateMatrix();
		model.updateMatrix();
		const registrationMatrix = registrationRoot.matrix.clone();
		const modelMatrix = model.matrix.clone();

		const runtime = new ModelViewModeRuntime( presentationRoot );
		expect( runtime.apply( model, { spatialType: 'underground' } ) ).toBeNull();
		expect( presentationRoot.matrix.elements ).toEqual( new THREE.Matrix4().makeTranslation( 0, - 30, 0 ).elements );
		expect( registrationRoot.matrix.elements ).toEqual( registrationMatrix.elements );
		expect( model.matrix.elements ).toEqual( modelMatrix.elements );

	} );

	it( 'uses explicit height settings, excludes helpers, and resets without drift', () => {

		const presentationRoot = new THREE.Group();
		presentationRoot.matrixAutoUpdate = false;
		const model = new THREE.Group();
		model.add( new THREE.Mesh( new THREE.BoxGeometry( 1, 10, 1 ) ) );
		const helper = new THREE.Mesh( new THREE.BoxGeometry( 1, 100, 1 ) );
		helper.userData.__visualizationHelper = true;
		model.add( helper );
		presentationRoot.add( model );
		const runtime = new ModelViewModeRuntime( presentationRoot );

		const config = {
			spatialType: 'underground' as const,
			cameraHeightOffset: { heightFactor: 0.5, additionalHeightMeters: 1, minimumOffsetMeters: 0.5, maximumOffsetMeters: 30 }
		};
		runtime.apply( model, config );
		expect( presentationRoot.matrix.elements[ 13 ] ).toBe( - 6 );
		runtime.reset();
		expect( presentationRoot.matrix.elements ).toEqual( new THREE.Matrix4().elements );
		runtime.apply( model, config );
		expect( presentationRoot.matrix.elements[ 13 ] ).toBe( - 6 );

	} );

	it( 'fails closed to registered AR for invalid offset settings', () => {

		const presentationRoot = new THREE.Group();
		presentationRoot.matrixAutoUpdate = false;
		const model = new THREE.Mesh( new THREE.BoxGeometry( 1, 10, 1 ) );
		presentationRoot.add( model );
		const runtime = new ModelViewModeRuntime( presentationRoot );

		expect( runtime.apply( model, { spatialType: 'underground', invalidCameraHeightOffset: true } ) ).toBe( 'invalid-config' );
		expect( presentationRoot.matrix.elements ).toEqual( new THREE.Matrix4().elements );

	} );

} );

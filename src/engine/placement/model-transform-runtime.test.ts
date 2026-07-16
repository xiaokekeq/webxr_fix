import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	correctUpsideDownModelMatrix,
	ModelTransformRuntime,
	ModelTransformValidationError
} from './model-transform-runtime.js';

describe( 'ModelTransformRuntime', () => {

	beforeEach( () => {
		vi.spyOn( console, 'info' ).mockImplementation( () => {} );
	} );

	it( 'commits the first placement once and retains its matrix', () => {

		const runtime = new ModelTransformRuntime();
		const parent = new THREE.Group();
		const matrix = new THREE.Matrix4().makeTranslation( 0.5, 0, -1 );
		const model = runtime.commitModelTransform( {
			modelTemplate: new THREE.Group(),
			currentModel: null,
			parent,
			commit: { matrix, reason: 'initial-placement', source: 'test', confirmed: true }
		} );

		expect( parent.children ).toEqual( [ model ] );
		expect( model.matrix.equals( matrix ) ).toBe( true );
		expect( runtime.getCommittedModelMatrix()?.equals( matrix ) ).toBe( true );
		expect( runtime.getPhase() ).toBe( 'placed' );
		expect( runtime.getAudit() ).toHaveLength( 1 );

	} );

	it( 'keeps the committed matrix through tracking loss and recovery', () => {

		const { runtime, model, matrix } = createCommittedRuntime();
		runtime.setTrackingStatus( 'unavailable' );
		expect( runtime.getPhase() ).toBe( 'tracking-lost' );
		expect( model.matrix.equals( matrix ) ).toBe( true );
		expect( runtime.getCommittedModelMatrix()?.equals( matrix ) ).toBe( true );

		runtime.setTrackingStatus( 'normal' );
		expect( runtime.getPhase() ).toBe( 'placed' );
		expect( runtime.getAudit() ).toHaveLength( 1 );

	} );

	it( 'allows an explicit Marker confirmation to update the same root once', () => {

		const { runtime, parent, model } = createCommittedRuntime();
		const next = new THREE.Matrix4().makeTranslation( 3, 0, 0 );
		const updated = runtime.commitModelTransform( {
			modelTemplate: new THREE.Group(),
			currentModel: model,
			parent,
			commit: { matrix: next, reason: 'marker-confirmed', source: 'test-confirm', confirmed: true }
		} );

		expect( updated ).toBe( model );
		expect( parent.children ).toHaveLength( 1 );
		expect( model.matrix.equals( next ) ).toBe( true );
		expect( runtime.getAudit().map( ( entry ) => entry.reason ) ).toEqual( [ 'initial-placement', 'marker-confirmed' ] );

	} );

	it.each( [
		[ 'non-finite', new THREE.Matrix4().set( Number.NaN, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ) ],
		[ 'singular', new THREE.Matrix4().makeScale( 1, 0, 1 ) ]
	] )( 'rejects a %s matrix without replacing the previous commit', (_label, invalid) => {

		const { runtime, parent, model, matrix } = createCommittedRuntime();
		expect( () => runtime.commitModelTransform( {
			modelTemplate: new THREE.Group(),
			currentModel: model,
			parent,
			commit: { matrix: invalid, reason: 'marker-confirmed', source: 'invalid-test', confirmed: true }
		} ) ).toThrow( ModelTransformValidationError );
		expect( model.matrix.equals( matrix ) ).toBe( true );
		expect( runtime.getAudit() ).toHaveLength( 1 );

	} );

	it( 'rejects an unconfirmed automatic jump', () => {

		const { runtime, parent, model, matrix } = createCommittedRuntime();
		expect( () => runtime.commitModelTransform( {
			modelTemplate: new THREE.Group(),
			currentModel: model,
			parent,
			commit: {
				matrix: new THREE.Matrix4().makeTranslation( 2, 0, 0 ),
				reason: 'engineering-registration-confirmed',
				source: 'automatic-test',
				confirmed: false
			}
		} ) ).toThrow( /automatic-transform-jump/ );
		expect( model.matrix.equals( matrix ) ).toBe( true );

	} );

	it( 'rejects an unconfirmed candidate even when the delta is small', () => {

		const { runtime, parent, model, matrix } = createCommittedRuntime();
		expect( () => runtime.commitModelTransform( {
			modelTemplate: new THREE.Group(),
			currentModel: model,
			parent,
			commit: {
				matrix: new THREE.Matrix4().makeTranslation( 0.3, 0, -0.5 ),
				reason: 'marker-confirmed',
				source: 'unconfirmed-candidate-test',
				confirmed: false
			}
		} ) ).toThrow( 'unconfirmed-transform-commit' );
		expect( model.matrix.equals( matrix ) ).toBe( true );

	} );

	it( 'clears the committed state only through reset', () => {

		const { runtime } = createCommittedRuntime();
		runtime.reset();
		expect( runtime.getCommittedModelMatrix() ).toBeNull();
		expect( runtime.getPhase() ).toBe( 'ready' );

	} );

	it( 'folds the former up-axis correction into the matrix before commit', () => {

		const upsideDown = new THREE.Matrix4().compose(
			new THREE.Vector3( 1, 2, 3 ),
			new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 1, 0, 0 ), Math.PI ),
			new THREE.Vector3( 1, 1, 1 )
		);
		const corrected = correctUpsideDownModelMatrix( upsideDown );
		const up = new THREE.Vector3( 0, 1, 0 ).transformDirection( corrected );

		expect( up.y ).toBeGreaterThanOrEqual( 0 );

	} );

} );

function createCommittedRuntime() {

	const runtime = new ModelTransformRuntime();
	const parent = new THREE.Group();
	const matrix = new THREE.Matrix4().makeTranslation( 0.25, 0, -0.5 );
	const model = runtime.commitModelTransform( {
		modelTemplate: new THREE.Group(),
		currentModel: null,
		parent,
		commit: { matrix, reason: 'initial-placement', source: 'test', confirmed: true }
	} );
	return { runtime, parent, model, matrix };

}

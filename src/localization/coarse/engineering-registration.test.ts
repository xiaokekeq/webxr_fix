import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { solveGroundPlaneRigidTransform } from './engineering-registration.js';

describe( 'solveGroundPlaneRigidTransform', () => {

	it( 'moves the formal ENU solution down when source controls move from the model bottom to its top', () => {

		const bottomControls = [
			new THREE.Vector3( -2.1663, 0, -1.1963 ),
			new THREE.Vector3( 2.5463, 0, -1.1963 ),
			new THREE.Vector3( 2.5463, 0, 1.1963 ),
			new THREE.Vector3( -2.1663, 0, 1.1963 )
		];
		const topControls = bottomControls.map( ( point ) => point.clone().setY( 2.787714 ) );
		const surveyedGroundControls = bottomControls.map( ( point ) => new THREE.Vector3( point.x, - point.z, 0 ) );

		const bottomSolution = solveGroundPlaneRigidTransform( bottomControls, surveyedGroundControls );
		const topSolution = solveGroundPlaneRigidTransform( topControls, surveyedGroundControls );

		expect( topSolution.translation.z - bottomSolution.translation.z ).toBeCloseTo( -2.787714, 6 );
		topControls.forEach( ( point, index ) => {
			expect( point.clone().applyMatrix4( topSolution.matrix ).distanceTo( surveyedGroundControls[ index ] ) ).toBeLessThan( 1e-6 );
		} );
		expect( new THREE.Vector3( 0, 0, 0 ).applyMatrix4( topSolution.matrix ).z ).toBeLessThan( 0 );

	} );

	it( 'rejects dz1207 top-cap corners for the current surveyed footprint controls', () => {

		const actualTopCapCorners = [
			new THREE.Vector3( -1.978781, 2.787714, -0.118343 ),
			new THREE.Vector3( 2.259893, 2.787714, -0.043853 ),
			new THREE.Vector3( 2.257645, 2.787714, 0.109602 ),
			new THREE.Vector3( -1.98103, 2.787714, 0.035112 )
		];
		const surveyedGroundControls = [
			new THREE.Vector3( -6.0526, -1.2592, -0.037 ),
			new THREE.Vector3( -2.8461, 1.9322, -0.0899 ),
			new THREE.Vector3( -0.9282, 0.0018, -0.0376 ),
			new THREE.Vector3( -4.1142, -3.1775, -0.0126 )
		];

		const solution = solveGroundPlaneRigidTransform( actualTopCapCorners, surveyedGroundControls );
		expect( solution.rmsErrorMeters ).toBeCloseTo( 1.292886, 6 );
		expect( solution.rmsErrorMeters ).toBeGreaterThan( 0.2 );

	} );

} );

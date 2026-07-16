import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import dz1207ConfigText from '../../../public/projects/dam/configs/dz1207.config.json?raw';
import waterNetworkConfigText from '../../../public/projects/water-network/configs/waternetwork.config.json?raw';
import waterNetworkObjText from '../../../public/projects/water-network/models/SWGX.obj?raw';
import waterNetworkPipesText from '../../../public/projects/water-network/properties/waternetwork.pipes.json?raw';
import { createEnuFrame, geodeticToEnu } from '@/localization/core/geodesy.js';
import { solveEngineeringRegistration, transformSiteEnuToModelLocal } from '@/localization/coarse/engineering-registration.js';
import { normalizeDemoModelConfig } from './demo-model-config.js';

describe( 'RTK control-point normalization', () => {

	it( 'derives ENU from world coordinates and never trusts legacy configured ENU', () => {

		const warn = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		const config = normalizeDemoModelConfig( createRawConfig( {
			enu: [ 999, 999, 999 ]
		} ) as never );
		const point = config.controlPoints[ 'cp-east' ];
		const expected = geodeticToEnu( point.world, createEnuFrame( config.siteFrame.origin ) );

		expect( point.coordinateSource ).toBe( 'geodetic' );
		expect( point.enu[ 0 ] ).toBeCloseTo( expected.x, 8 );
		expect( point.enu[ 1 ] ).toBeCloseTo( expected.y, 8 );
		expect( point.enu[ 2 ] ).toBeCloseTo( expected.z, 8 );
		expect( point.enu ).not.toEqual( [ 999, 999, 999 ] );
		expect( warn ).toHaveBeenCalledTimes( 1 );
		warn.mockRestore();

	} );

	it( 'rejects an invalid RTK longitude before registration can run', () => {

		expect( () => normalizeDemoModelConfig( createRawConfig( {
			world: { lat: 31.94, lng: 181, height: 24 }
		} ) as never ) ).toThrow( 'invalid-control-point-world:cp-east:invalid-longitude' );

	} );

	it( 'keeps production dz1207 control points world-only', () => {

		const raw = JSON.parse( dz1207ConfigText ) as { controlPoints: Record<string, Record<string, unknown>> };
		expect( Object.values( raw.controlPoints ).every( ( point ) => 'world' in point && 'enu' in point === false ) ).toBe( true );

	} );

	it( 'keeps the water-network model registration config valid', () => {

		const config = normalizeDemoModelConfig( JSON.parse( waterNetworkConfigText ) );
		expect( config.modelControlTargetDiagnostics.modelControlTargetValidationState ).toBe( 'ready' );
		expect( Object.keys( config.controlPoints ) ).toHaveLength( 3 );
		expect( config.siteFrame.origin ).toEqual( normalizeDemoModelConfig( JSON.parse( dz1207ConfigText ) ).siteFrame.origin );
		expect( config.markers[ 0 ]?.id ).toBe( 'marker-warning-707' );
		expect( solveEngineeringRegistration( config ).modelToSite.rmsErrorMeters ).toBeLessThan( 0.05 );

	} );

	it( 'anchors water anomalies to configured pipe vertices near the Marker', () => {

		const config = normalizeDemoModelConfig( JSON.parse( waterNetworkConfigText ) );
		const marker = config.markers.find( ( item ) => item.id === 'marker-warning-707' );
		const pipes = JSON.parse( waterNetworkPipesText ) as { pipes: Array<{ code?: string }> };
		const pipeObjectNames: Record<string, string> = {
			'WN-74-76-001': 'Line014',
			'WN-74-76-002': '对象002',
			'WN-74-76-004': '对象004'
		};
		expect( marker?.cornersEnu ).toHaveLength( 4 );
		const markerCenterEnu = marker!.cornersEnu!.reduce(
			( center, corner ) => center.add( new THREE.Vector3( corner[ 0 ], corner[ 1 ], corner[ 2 ] ) ),
			new THREE.Vector3()
		).multiplyScalar( 0.25 );
		const markerCenterModelLocal = transformSiteEnuToModelLocal(
			markerCenterEnu,
			solveEngineeringRegistration( config )
		);
		const anomalies = config.annotations.filter( ( annotation ) => annotation.placement?.mode === 'model-local' );

		expect( anomalies ).toHaveLength( 3 );
		for ( const anomaly of anomalies ) {
			const placement = anomaly.placement!;
			const position = new THREE.Vector3(
				placement.modelLocalPosition.x,
				placement.modelLocalPosition.y,
				placement.modelLocalPosition.z
			);
			expect( anomaly.markerId ).toBe( marker!.id );
			expect( pipes.pipes.some( ( pipe ) => pipe.code === anomaly.pipeId ) ).toBe( true );
			expect( position.distanceTo( markerCenterModelLocal ) ).toBeLessThanOrEqual( anomaly.maxMarkerDistanceMeters! );
			expect( containsModelVertex( waterNetworkObjText, placement.modelLocalPosition, pipeObjectNames[ anomaly.pipeId! ] ) ).toBe( true );
		}

		for ( let index = 0; index < anomalies.length; index += 1 ) {
			for ( let otherIndex = index + 1; otherIndex < anomalies.length; otherIndex += 1 ) {
				const left = anomalies[ index ].placement!.modelLocalPosition;
				const right = anomalies[ otherIndex ].placement!.modelLocalPosition;
				expect( new THREE.Vector3( left.x, left.y, left.z ).distanceTo( new THREE.Vector3( right.x, right.y, right.z ) ) ).toBeGreaterThanOrEqual( 0.25 );
			}
		}

	} );

} );

function containsModelVertex(
	objText: string,
	modelLocal: { x: number; y: number; z: number },
	objectName: string
): boolean {

	const sourceVertex = new THREE.Vector3( modelLocal.x, - modelLocal.z, modelLocal.y );
	const start = objText.indexOf( `# object ${objectName}` );
	const end = objText.indexOf( '# object ', start + 1 );
	if ( start < 0 ) return false;
	return objText.slice( start, end < 0 ? undefined : end ).split( /\r?\n/ ).some( ( line ) => {
		const values = line.trim().split( /\s+/ );
		if ( values[ 0 ] !== 'v' || values.length < 4 ) return false;
		return new THREE.Vector3( Number( values[ 1 ] ), Number( values[ 2 ] ), Number( values[ 3 ] ) )
			.distanceTo( sourceVertex ) < 1e-6;
	} );

}

function createRawConfig(overrides: { enu?: [ number, number, number ]; world?: { lat: number; lng: number; height: number } } = {}) {

	const origin = { lat: 31.94, lng: 118.73, height: 24, coordType: 'WGS84' };
	return {
		modelId: 'rtk-test',
		siteId: 'rtk-test',
		siteFrame: { origin, axes: 'enu', heightDatum: 'ellipsoidal' },
		anchor: origin,
		yaw: 0,
		scale: 1,
		registration: { mode: 'rigid-ground-plane', minControlPoints: 3 },
		modelControlPointOrder: [ 'cp-origin', 'cp-east', 'cp-north' ],
		controlPoints: {
			'cp-origin': { modelLocal: { x: 0, y: 0, z: 0 }, world: origin },
			'cp-east': {
				modelLocal: { x: 1, y: 0, z: 0 },
				world: overrides.world ?? { lat: 31.94, lng: 118.73001, height: 24 },
				...( overrides.enu === undefined ? {} : { enu: overrides.enu } )
			},
			'cp-north': { modelLocal: { x: 0, y: 0, z: 1 }, world: { lat: 31.94001, lng: 118.73, height: 24 } }
		}
	};

}

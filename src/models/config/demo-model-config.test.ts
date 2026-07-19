import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import dz1207ConfigText from '../../../public/projects/dam/configs/dz1207.config.json?raw';
import waterNetworkConfigText from '../../../public/projects/water-network/configs/waternetwork.config.json?raw';
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
		expect( config.siteFrame.origin ).toEqual( {
			lat: 31.9400473778,
			lon: 118.7359443694,
			alt: 24.33046
		} );
		expect( config.markers[ 0 ]?.id ).toBe( 'marker-warning-707' );
		expect( solveEngineeringRegistration( config ).modelToSite.rmsErrorMeters ).toBeLessThan( 0.05 );

	} );

	it( 'keeps water anomalies associated with configured pipes without a default Marker distance limit', () => {

		const config = normalizeDemoModelConfig( JSON.parse( waterNetworkConfigText ) );
		const marker = config.markers.find( ( item ) => item.id === 'marker-warning-707' );
		const pipes = JSON.parse( waterNetworkPipesText ) as { pipes: Array<{ code?: string }> };
		const surfaceEdges: Record<string, [ THREE.Vector3, THREE.Vector3 ]> = {
			'ANOM-001': [
				new THREE.Vector3( -20.5375, -71.8008, -0.344 ),
				new THREE.Vector3( 146.0411, -71.8008, -0.7561 )
			],
			'ANOM-002': [
				new THREE.Vector3( -20.5123, -70.304, -0.0554 ),
				new THREE.Vector3( 146.0101, -70.304, -0.4675 )
			],
			'ANOM-003': [
				new THREE.Vector3( -20.5123, -70.304, -0.6612 ),
				new THREE.Vector3( 146.0101, -70.304, -1.0733 )
			],
			'ANOM-004': [
				new THREE.Vector3( -20.5393, -72.0008, -1.0904 ),
				new THREE.Vector3( 146.0392, -72.0008, -1.5025 )
			]
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

		expect( anomalies ).toHaveLength( 4 );
		for ( const anomaly of anomalies ) {
			expect( anomaly.markerId ).toBe( marker!.id );
			expect( pipes.pipes.some( ( pipe ) => pipe.code === anomaly.pipeId ) ).toBe( true );
			expect( anomaly.maxMarkerDistanceMeters ).toBeUndefined();
			const position = new THREE.Vector3(
				anomaly.placement!.modelLocalPosition.x,
				anomaly.placement!.modelLocalPosition.y,
				anomaly.placement!.modelLocalPosition.z
			);
			const [ edgeStart, edgeEnd ] = surfaceEdges[ anomaly.id ];
			expect( position.distanceTo(
				edgeStart.clone().lerp( edgeEnd, ( position.x - edgeStart.x ) / ( edgeEnd.x - edgeStart.x ) )
			) ).toBeLessThan( 0.0001 );
			expect( position.distanceTo( markerCenterModelLocal ) ).toBeGreaterThan( 3 );
		}
		const danger = anomalies.find( ( anomaly ) => anomaly.id === 'ANOM-004' )!;
		expect( danger.severity ).toBe( 'danger' );

		for ( let index = 0; index < anomalies.length; index += 1 ) {
			for ( let otherIndex = index + 1; otherIndex < anomalies.length; otherIndex += 1 ) {
				const left = anomalies[ index ].placement!.modelLocalPosition;
				const right = anomalies[ otherIndex ].placement!.modelLocalPosition;
				expect( new THREE.Vector3( left.x, left.y, left.z ).distanceTo( new THREE.Vector3( right.x, right.y, right.z ) ) ).toBeGreaterThanOrEqual( 0.25 );
			}
		}

} );

} );

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

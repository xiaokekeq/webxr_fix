import { describe, expect, it, vi } from 'vitest';
import dz1207ConfigText from '../../../public/pipe-viewer/dz1207.config.json?raw';
import { createEnuFrame, geodeticToEnu } from '@/localization/core/geodesy.js';
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

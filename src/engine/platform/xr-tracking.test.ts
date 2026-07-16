import { describe, expect, it } from 'vitest';
import { resolveXrTrackingStatus } from './xr.js';

describe( 'XR tracking status', () => {

	it( 'distinguishes unavailable, emulated and normal viewer poses', () => {

		expect( resolveXrTrackingStatus( null ) ).toBe( 'unavailable' );
		expect( resolveXrTrackingStatus( { emulatedPosition: true } ) ).toBe( 'emulated' );
		expect( resolveXrTrackingStatus( { emulatedPosition: false } ) ).toBe( 'normal' );

	} );

} );

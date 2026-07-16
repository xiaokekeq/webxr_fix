import { describe, expect, it } from 'vitest';
import { damRoutes } from '@/apps/dam/router.js';
import { waterNetworkRoutes } from '@/apps/water-network/router.js';

describe( 'application router boundaries', () => {
	it( 'keeps dam-only pages out of the water router', () => {
		expect( damRoutes.some( ( route ) => route.path === '/risks' ) ).toBe( true );
		expect( waterNetworkRoutes.some( ( route ) => route.path === '/risks' ) ).toBe( false );
	} );

	it( 'uses app-internal paths without cross-project routes', () => {
		for ( const route of [ ...damRoutes, ...waterNetworkRoutes ] ) {
			expect( route.path ).not.toMatch( /^\/(dam|water-network)(\/|$)/ );
		}
	} );
} );

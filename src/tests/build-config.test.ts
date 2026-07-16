import { describe, expect, it } from 'vitest';
import damConfig from '../../vite.config.dam.ts?raw';
import sharedConfig from '../../vite.config.shared.ts?raw';
import waterConfig from '../../vite.config.water-network.ts?raw';

describe( 'independent build configs', () => {
	it( 'uses separate roots, bases and output directories', () => {
		expect( damConfig ).toContain( "createViteConfig( 'dam' )" );
		expect( waterConfig ).toContain( "createViteConfig( 'water-network' )" );
		expect( sharedConfig ).toContain( "base: isDam ? '/dam/' : '/water-network/'" );
		expect( sharedConfig ).toContain( "'dist/dam' : 'dist/water-network'" );
		expect( sharedConfig ).toContain( '`src/apps/${app}`' );
	} );
} );

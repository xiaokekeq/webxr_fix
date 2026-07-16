import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json';
import damTsconfig from '../../tsconfig.dam.json';
import waterTsconfig from '../../tsconfig.water-network.json';
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

	it( 'uses isolated application typecheck configs in each build', () => {
		expect( damTsconfig.exclude ).toContain( 'src/apps/water-network/**' );
		expect( waterTsconfig.exclude ).toContain( 'src/apps/dam/**' );
		expect( damTsconfig.include ).toContain( 'src/**/*.vue' );
		expect( waterTsconfig.include ).toContain( 'src/**/*.vue' );
		expect( packageJson.scripts[ 'build:dam' ] ).toContain( 'npm run typecheck:dam' );
		expect( packageJson.scripts[ 'build:water' ] ).toContain( 'npm run typecheck:water' );
	} );
} );

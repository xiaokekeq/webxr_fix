import { describe, expect, it } from 'vitest';
import { productUis } from './product-ui.js';
import { waterNetworkUi } from './water-network-ui.js';

describe( 'water network UI content', () => {

	it( 'keeps the AR shortcut on the water-network session route', () => {

		expect( waterNetworkUi.application.name ).toBe( '供水管网智慧运维' );
		expect( waterNetworkUi.dashboard.quickMenus.some( ( item ) => item.path === '/water-network/ar?autoStart=1' ) ).toBe( true );

	} );

	it( 'provides separate dam and water-network dashboard content', () => {

		expect( productUis.dam.application.name ).toContain( '堤坝' );
		expect( productUis[ 'water-network' ].application.name ).toContain( '供水管网' );

	} );

} );

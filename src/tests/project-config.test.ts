import { describe, expect, it } from 'vitest';
import { damProjectConfig } from '@/apps/dam/project-config.js';
import { waterNetworkProjectConfig } from '@/apps/water-network/project-config.js';

describe( 'project configs', () => {
	it( 'isolates the dam catalog and enables dam tools', () => {
		expect( damProjectConfig.projectId ).toBe( 'dam' );
		expect( damProjectConfig.defaultModelId ).toBe( 'dz1207' );
		expect( damProjectConfig.dataSource ).toMatchObject( { kind: 'local-json' } );
		if ( damProjectConfig.dataSource.kind !== 'local-json' ) throw new Error( 'Expected local dam config.' );
		expect( damProjectConfig.dataSource.modelCatalogUrl ).toContain( 'projects/dam/models.json' );
		expect( damProjectConfig.dataSource.modelCatalogUrl ).not.toContain( 'water-network' );
		expect( damProjectConfig.capabilities ).toMatchObject( { sectionCut: true, layerControl: true } );
		expect( damProjectConfig.componentPropertyHud ).toBeUndefined();
	} );

	it( 'isolates the water catalog and disables dam-only tools', () => {
		expect( waterNetworkProjectConfig.projectId ).toBe( 'water-network' );
		expect( waterNetworkProjectConfig.defaultModelId ).toBe( 'waternetwork' );
		expect( waterNetworkProjectConfig.dataSource ).toMatchObject( { kind: 'local-json' } );
		if ( waterNetworkProjectConfig.dataSource.kind !== 'local-json' ) throw new Error( 'Expected local water config.' );
		expect( waterNetworkProjectConfig.dataSource.modelCatalogUrl ).toContain( 'projects/water-network/models.json' );
		expect( waterNetworkProjectConfig.dataSource.modelCatalogUrl ).not.toContain( 'projects/dam/' );
		expect( waterNetworkProjectConfig.capabilities ).toMatchObject( { sectionCut: false, layerControl: false, xray: false } );
		expect( waterNetworkProjectConfig.componentPropertyHud?.fields.map( ( field ) => field.key ) ).toContain( 'depth' );
	} );
} );

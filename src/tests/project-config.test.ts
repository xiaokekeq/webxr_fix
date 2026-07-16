import { describe, expect, it } from 'vitest';
import { damProjectConfig } from '@/apps/dam/project-config.js';
import { waterNetworkProjectConfig } from '@/apps/water-network/project-config.js';

describe( 'project configs', () => {
	it( 'isolates the dam catalog and enables dam tools', () => {
		expect( damProjectConfig.projectId ).toBe( 'dam' );
		expect( damProjectConfig.defaultModelId ).toBe( 'dz1207' );
		expect( damProjectConfig.modelCatalogUrl ).toContain( 'projects/dam/models.json' );
		expect( damProjectConfig.modelCatalogUrl ).not.toContain( 'water-network' );
		expect( damProjectConfig.capabilities ).toMatchObject( { sectionCut: true, layerControl: true } );
	} );

	it( 'isolates the water catalog and disables dam-only tools', () => {
		expect( waterNetworkProjectConfig.projectId ).toBe( 'water-network' );
		expect( waterNetworkProjectConfig.defaultModelId ).toBe( 'tongma-74-76-fbx' );
		expect( waterNetworkProjectConfig.modelCatalogUrl ).toContain( 'projects/water-network/models.json' );
		expect( waterNetworkProjectConfig.modelCatalogUrl ).not.toContain( 'projects/dam/' );
		expect( waterNetworkProjectConfig.capabilities ).toMatchObject( { sectionCut: false, layerControl: false, xray: false } );
	} );
} );

import { afterEach, describe, expect, it, vi } from 'vitest';
import damCatalogText from '../../public/projects/dam/models.json?raw';
import waterCatalogText from '../../public/projects/water-network/models.json?raw';
import { normalizeModelCatalogItem } from '@/models/catalog/model-catalog-normalizer.js';
import { LocalJsonModelRepository, resolveModelCatalogItemUrls } from '@/services/repositories/model-repository.js';

const damCatalog = JSON.parse( damCatalogText ) as unknown[];
const waterCatalog = JSON.parse( waterCatalogText ) as unknown[];

afterEach( () => vi.unstubAllGlobals() );

describe( 'model catalog boundaries', () => {
	it( 'keeps each catalog limited to its own default model', () => {
		expect( damCatalog.map( ( item ) => ( item as { id: string } ).id ) ).toEqual( [ 'dz1207' ] );
		expect( waterCatalog.map( ( item ) => ( item as { id: string } ).id ) ).toEqual( [ 'waternetwork' ] );
	} );

	it( 'resolves model, config, material and property URLs below the active base', () => {
		const item = resolveModelCatalogItemUrls(
			normalizeModelCatalogItem( damCatalog[ 0 ] ),
			'https://example.test/dam/projects/dam/models.json'
		);
		expect( item.modelUrl ).toBe( 'https://example.test/dam/projects/dam/models/dz1207/dizhi1207.obj' );
		expect( item.materialUrl ).toBe( 'https://example.test/dam/projects/dam/models/dz1207/dizhi1207.mtl' );
		expect( item.configUrl ).toBe( 'https://example.test/dam/projects/dam/configs/dz1207.config.json' );
		expect( item.pipesUrl ).toBe( 'https://example.test/dam/projects/dam/properties/dz1207.pipes.json' );
	} );

	it( 'resolves water assets below the water deployment base', () => {
		const item = resolveModelCatalogItemUrls(
			normalizeModelCatalogItem( waterCatalog[ 0 ] ),
			'https://example.test/water-network/projects/water-network/models.json'
		);
		expect( item.modelUrl ).toBe( 'https://example.test/water-network/projects/water-network/models/SWGX.obj' );
		expect( item.materialUrl ).toBe( 'https://example.test/water-network/projects/water-network/models/SWGX.mtl' );
		expect( item.configUrl ).toBe( 'https://example.test/water-network/projects/water-network/configs/waternetwork.config.json' );
		expect( item.pipesUrl ).toBe( 'https://example.test/water-network/projects/water-network/properties/waternetwork.pipes.json' );
	} );

	it( 'fails explicitly when a requested model is absent', async () => {
		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( {
			ok: true,
			url: 'https://example.test/dam/projects/dam/models.json',
			json: async () => damCatalog
		} ) );
		const repository = new LocalJsonModelRepository( '/dam/projects/dam/models.json' );
		await expect( repository.getModelDefinition( 'tongma-74-76-fbx' ) ).rejects.toThrow( 'Unknown modelId: tongma-74-76-fbx' );
	} );
} );

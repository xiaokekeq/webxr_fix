import { afterEach, describe, expect, it, vi } from 'vitest';
import { damProjectConfig } from '@/apps/dam/project-config.js';
import { waterNetworkProjectConfig } from '@/apps/water-network/project-config.js';
import { createProjectRepositories } from '@/services/repository-factory.js';
import type { ArProjectConfig } from '@/shared/config/project-config.js';

afterEach( () => {
	vi.unstubAllGlobals();
} );

describe( 'project repository factory', () => {
	it( 'creates independent local containers without catalog crossover', async () => {
		const fetchMock = vi.fn( async (_input: RequestInfo | URL) => new Response( '[]', { status: 200 } ) );
		vi.stubGlobal( 'fetch', fetchMock );
		const damRepositories = createProjectRepositories( damProjectConfig );
		const waterRepositories = createProjectRepositories( waterNetworkProjectConfig );

		expect( damRepositories ).not.toBe( waterRepositories );
		await damRepositories.model.listModels();
		await waterRepositories.model.listModels();

		expect( fetchMock.mock.calls.map( ( call ) => String( call[ 0 ] ) ) ).toEqual( [
			expect.stringContaining( 'projects/dam/models.json' ),
			expect.stringContaining( 'projects/water-network/models.json' )
		] );
	} );

	it( 'keeps API base URLs isolated per container', async () => {
		const fetchMock = vi.fn( async (_input: RequestInfo | URL) => new Response( '[]', { status: 200 } ) );
		vi.stubGlobal( 'fetch', fetchMock );
		const damConfig: ArProjectConfig = {
			...damProjectConfig,
			dataSource: { kind: 'api', apiBaseUrl: 'https://dam-api.example.com/root/' }
		};
		const waterConfig: ArProjectConfig = {
			...waterNetworkProjectConfig,
			dataSource: { kind: 'api', apiBaseUrl: 'https://water-api.example.com/root/' }
		};

		await createProjectRepositories( damConfig ).model.listModels();
		await createProjectRepositories( waterConfig ).model.listModels();

		expect( fetchMock.mock.calls.map( ( call ) => String( call[ 0 ] ) ) ).toEqual( [
			'https://dam-api.example.com/api/models',
			'https://water-api.example.com/api/models'
		] );
	} );

	it( 'fails fast when the selected data source address is missing', () => {
		expect( () => createProjectRepositories( {
			...damProjectConfig,
			dataSource: { kind: 'api', apiBaseUrl: '' }
		} ) ).toThrow( 'apiBaseUrl' );
		expect( () => createProjectRepositories( {
			...damProjectConfig,
			dataSource: { kind: 'local-json', modelCatalogUrl: '' }
		} ) ).toThrow( 'modelCatalogUrl' );
	} );
} );

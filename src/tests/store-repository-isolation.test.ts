import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { damProjectConfig } from '@/apps/dam/project-config.js';
import { waterNetworkProjectConfig } from '@/apps/water-network/project-config.js';
import { createInitialThreeEngineSnapshot } from '@/engine/core/three-engine.js';
import type { ModelRepository } from '@/services/repositories/model-repository.js';
import { createProjectRepositories } from '@/services/repository-factory.js';

const createControllerMock = vi.hoisted( () => vi.fn() );
vi.mock( '@/features/ar/controller/ar-controller.js', () => ( {
	createLoadModelArController: createControllerMock
} ) );

import { useArShellStore } from '@/features/ar/stores/ar-shell.js';

beforeEach( () => {
	createControllerMock.mockReset();
	createControllerMock.mockImplementation( ( config, repositories ) => {
		const state = createInitialThreeEngineSnapshot( config.labels.appTitle );
		return {
			initialize: () => repositories.model.listModels().then( () => undefined ),
			dispose: vi.fn(),
			mountHosts: vi.fn(),
			getEngineState: () => state,
			subscribe: () => vi.fn(),
			actions: {}
		};
	} );
} );

describe( 'AR store repository injection', () => {
	it( 'uses each store instance fake without cross-calling', async () => {
		const damListModels = vi.fn( async () => [] );
		const waterListModels = vi.fn( async () => [] );
		const damRepositories = createProjectRepositories( damProjectConfig );
		const waterRepositories = createProjectRepositories( waterNetworkProjectConfig );
		damRepositories.model = { listModels: damListModels } as unknown as ModelRepository;
		waterRepositories.model = { listModels: waterListModels } as unknown as ModelRepository;

		setActivePinia( createPinia() );
		const damStore = useArShellStore();
		damStore.configure( { projectConfig: damProjectConfig, repositories: damRepositories } );
		await damStore.initialize();

		setActivePinia( createPinia() );
		const waterStore = useArShellStore();
		waterStore.configure( { projectConfig: waterNetworkProjectConfig, repositories: waterRepositories } );
		await waterStore.initialize();

		expect( damListModels ).toHaveBeenCalledTimes( 1 );
		expect( waterListModels ).toHaveBeenCalledTimes( 1 );
		expect( createControllerMock.mock.calls[ 0 ][ 1 ] ).toBe( damRepositories );
		expect( createControllerMock.mock.calls[ 1 ][ 1 ] ).toBe( waterRepositories );
	} );
} );

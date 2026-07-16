import { createPinia, setActivePinia } from 'pinia';
import { describe, expect, it } from 'vitest';
import { damProjectConfig } from '@/apps/dam/project-config.js';
import { waterNetworkProjectConfig } from '@/apps/water-network/project-config.js';
import { assertArCapability } from '@/features/ar/controller/ar-controller.js';
import { useArShellStore } from '@/features/ar/stores/ar-shell.js';
import { createProjectRepositories } from '@/services/repository-factory.js';

const damContext = {
	projectConfig: damProjectConfig,
	repositories: createProjectRepositories( damProjectConfig )
};
const waterContext = {
	projectConfig: waterNetworkProjectConfig,
	repositories: createProjectRepositories( waterNetworkProjectConfig )
};

describe( 'runtime application boundaries', () => {
	it( 'creates independent instances from the shared AR store definition', () => {
		setActivePinia( createPinia() );
		const damStore = useArShellStore();
		damStore.configure( damContext );
		damStore.$patch( { initialized: true } );

		setActivePinia( createPinia() );
		const waterStore = useArShellStore();
		waterStore.configure( waterContext );

		expect( waterStore ).not.toBe( damStore );
		expect( damStore.initialized ).toBe( true );
		expect( waterStore.initialized ).toBe( false );
	} );

	it( 'rejects runtime project switching inside one store instance', () => {
		setActivePinia( createPinia() );
		const store = useArShellStore();
		store.configure( damContext );
		expect( () => store.configure( waterContext ) ).toThrow( 'cannot switch projects' );
	} );

	it( 'rejects disabled water tools at the controller boundary', () => {
		expect( () => assertArCapability( waterNetworkProjectConfig.capabilities, 'sectionCut' ) ).toThrow( 'sectionCut' );
		expect( () => assertArCapability( waterNetworkProjectConfig.capabilities, 'layerControl' ) ).toThrow( 'layerControl' );
		expect( () => assertArCapability( damProjectConfig.capabilities, 'sectionCut' ) ).not.toThrow();
	} );
} );

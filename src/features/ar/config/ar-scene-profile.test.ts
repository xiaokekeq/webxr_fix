import { describe, expect, it } from 'vitest';
import { AR_SCENE_PROFILES, resolveArSceneProfile } from './ar-scene-profile.js';

describe( 'AR scene profiles', () => {

	it( 'uses the fixed catalog water-network model and hides dam-only tools', () => {

		const profile = resolveArSceneProfile( { meta: { arSceneType: 'water-network' } } as never );
		expect( profile ).toBe( AR_SCENE_PROFILES[ 'water-network' ] );
		expect( profile.defaultModelId ).toBe( 'tongma-74-76-fbx' );
		expect( profile.showModelSelector ).toBe( false );
		expect( profile.capabilities ).toMatchObject( { sectionCut: false, layerControl: false, xray: false } );

	} );

} );

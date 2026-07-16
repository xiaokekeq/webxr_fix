import { describe, expect, it } from 'vitest';
import damUi from '@/apps/dam/data/ui.json';
import waterUi from '@/apps/water-network/data/ui.json';
import workspaceSource from '@/shared/ar/views/ArWorkspace.vue?raw';
import calibrationSource from '@/shared/ar/views/ModelCalibration.vue?raw';
import xrSupportSource from '@/engine/platform/xr-support.ts?raw';

describe( 'explicit AR session entry', () => {
	it( 'keeps navigation free of automatic session parameters', () => {
		expect( JSON.stringify( [ damUi, waterUi ] ) ).not.toMatch( /auto[-_]?start/i );
		expect( workspaceSource ).not.toContain( `route.query.${[ 'auto', 'Start' ].join( '' )}` );
		const mountedBlock = workspaceSource.match( /onMounted\([\s\S]*?\n} \);/ )?.[ 0 ] ?? '';
		expect( mountedBlock ).not.toContain( 'actions.enterAr' );
	} );

	it( 'guards both click entry points and the shared XR request', () => {
		for ( const source of [ workspaceSource, calibrationSource ] ) {
			expect( source ).toContain( '@click.stop="startArSession"' );
			expect( source ).toContain( 'isEnteringAr.value || hasArSession.value || sceneReady.value === false' );
		}
		expect( xrSupportSource ).toContain( 'renderer.xr.isPresenting || sessionRequestPending' );
	} );
} );

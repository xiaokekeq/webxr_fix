import { describe, expect, it } from 'vitest';
import guardSource from '@/engine/interaction/ar-dom-overlay-input-guard.ts?raw';
import pointerSelectionSource from '@/engine/interaction/pointer-selection.ts?raw';
import threeEngineSource from '@/engine/core/three-engine.ts?raw';
import sessionLifecycleSource from '@/engine/session/session-lifecycle-runtime.ts?raw';
import xrSupportSource from '@/engine/platform/xr-support.ts?raw';
import workspaceSource from '@/shared/ar/views/ArWorkspace.vue?raw';
import calibrationSource from '@/shared/ar/views/ModelCalibration.vue?raw';
import pipeHudSource from '@/shared/ar/components/PipePropertyHud.vue?raw';
import floatingRailSource from '@/components/ar/ArFloatingValueRail.vue?raw';
import damRouterSource from '@/apps/dam/router.ts?raw';
import waterRouterSource from '@/apps/water-network/router.ts?raw';

const inputSources = import.meta.glob<string>( [
	'/src/engine/**/*.{ts,vue}',
	'/src/shared/ar/**/*.{ts,vue}',
	'/src/components/ar/**/*.{ts,vue}',
	'!/src/**/*.test.ts'
], {
	query: '?raw',
	import: 'default',
	eager: true
} );

describe( 'AR input boundaries', () => {

	it( 'uses one DOM Overlay root and beforexrselect cancellation for marked UI paths', () => {

		expect( threeEngineSource ).toContain( 'const domOverlayRoot = document.body' );
		expect( xrSupportSource.match( /domOverlay: \{ root: domOverlayRoot \}/g ) ).toHaveLength( 2 );
		expect( guardSource ).toContain( "addEventListener( 'beforexrselect'" );
		expect( guardSource ).toContain( 'event.composedPath()' );
		expect( guardSource ).toContain( 'event.preventDefault()' );

	} );

	it( 'uses tap coordinates for immersive screen input and XR select for other input sources', () => {

		expect( threeEngineSource ).toContain( "addEventListener( 'select', this.pointerSelection.handleArSelect )" );
		expect( threeEngineSource ).toContain( "window.addEventListener( 'pointerup', this.handleImmersiveScreenPointerUp, true )" );
		expect( pointerSelectionSource ).toContain( "event?.inputSource.targetRayMode === 'screen'" );
		expect( pointerSelectionSource ).toContain( 'immersiveScreenPointerObserved' );
		expect( pointerSelectionSource ).not.toMatch( /suppressSelection|selectionSuppressed|lastScreenSelectionTime|< 240/ );
		expect( sessionLifecycleSource ).not.toContain( 'suppressSelection' );
		expect( pointerSelectionSource ).not.toContain( 'placeModel' );

	} );

	it( 'contains no fixed UI click-through cooldown or duplicate input guard', () => {

		const combined = Object.values( inputSources ).join( '\n' );
		expect( combined ).not.toMatch( /1400|clickCooldown|ignoreModelClickUntil|disablePickingUntil|suppressPickingFor|lastPanelClickTime/ );
		expect( Object.keys( inputSources ).filter( ( path ) => path.endsWith( '/ar-dom-overlay-input-guard.ts' ) ) ).toHaveLength( 1 );

	} );

	it( 'marks the shared AR controls used by both applications', () => {

		for ( const source of [ workspaceSource, calibrationSource, pipeHudSource, floatingRailSource ] ) {
			expect( source ).toContain( 'data-ar-ui-interactive' );
			expect( source ).not.toContain( 'data-ar-ui="true"' );
		}
		for ( const router of [ damRouterSource, waterRouterSource ] ) {
			expect( router ).toContain( "@/shared/ar/views/ArWorkspace.vue" );
			expect( router ).toContain( "@/shared/ar/views/ModelCalibration.vue" );
		}

	} );

	it( 'keeps close and scroll interactions inside the HUD boundary', () => {

		expect( pipeHudSource ).toContain( '<div class="pipe-property-content" data-ar-ui-interactive>' );
		expect( pipeHudSource ).toContain( `@click.stop="emit('close')"` );
		expect( pipeHudSource.match( /emit\('close'\)/g ) ).toHaveLength( 1 );
		expect( pipeHudSource ).not.toMatch( /pickPipe|pickAnomaly|placeModel|clearSceneSelection/ );

	} );

	it( 'cleans up input listeners at both session and engine lifecycle boundaries', () => {

		expect( threeEngineSource.match( /disposeArDomOverlayInputGuard\(\)/g )?.length ?? 0 ).toBeGreaterThanOrEqual( 3 );
		expect( guardSource ).toContain( "removeEventListener( 'beforexrselect'" );
		expect( guardSource ).toContain( 'uiOwnedPointerIds.clear()' );

	} );

} );

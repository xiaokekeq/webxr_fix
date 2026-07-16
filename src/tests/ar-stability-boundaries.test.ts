import { describe, expect, it } from 'vitest';
import transformRuntimeSource from '@/engine/placement/model-transform-runtime.ts?raw';
import placementSessionSource from '@/engine/placement/session.ts?raw';
import placementWorkflowSource from '@/engine/placement/placement-workflow.ts?raw';
import threeEngineSource from '@/engine/core/three-engine.ts?raw';
import xrRuntimeSource from '@/engine/platform/xr.ts?raw';
import modelSessionSource from '@/engine/model/session.ts?raw';
import workspaceSource from '@/shared/ar/views/ArWorkspace.vue?raw';
import pipeHudSource from '@/shared/ar/components/PipePropertyHud.vue?raw';

describe( 'AR model stability boundaries', () => {

	it( 'keeps the formal root matrix write inside the single commit entry', () => {

		expect( transformRuntimeSource ).toContain( 'commitModelTransform' );
		expect( transformRuntimeSource.match( /model\.matrix\.copy\(/g ) ).toHaveLength( 1 );
		expect( placementSessionSource ).not.toMatch( /arPlacedModel\.(position|quaternion|rotation|scale|matrix)/ );
		expect( threeEngineSource ).not.toMatch( /placedModel\.(position|quaternion|rotation|scale|matrix)\.(copy|set|identity)/ );

	} );

	it( 'has no frame, Marker-apply or model-ready automatic placement path', () => {

		const combined = [ placementWorkflowSource, threeEngineSource, xrRuntimeSource ].join( '\n' );
		expect( combined ).not.toMatch( /tryAutoPlace|attemptAutoPlacement|requestAutoPlacement|onAttemptAutoPlacement/ );
		expect( combined ).not.toContain( 'queueMicrotask' );
		expect( placementWorkflowSource ).toContain( "reason: hadPlacedModel ? 'marker-confirmed' : 'initial-placement'" );

	} );

	it( 'observes XR tracking, visibility and reference-space reset without placement callbacks', () => {

		expect( xrRuntimeSource ).toContain( 'emulatedPosition' );
		expect( xrRuntimeSource ).toContain( "addEventListener( 'visibilitychange'" );
		expect( xrRuntimeSource ).toContain( "addEventListener( 'reset'" );
		expect( threeEngineSource ).toContain( '模型矩阵未被应用层重复补偿' );
		expect( threeEngineSource ).not.toMatch( /handleReferenceSpaceReset[\s\S]{0,500}placeModel/ );

	} );

	it( 'deduplicates an in-flight model and rejects stale async completion', () => {

		expect( modelSessionSource ).toContain( 'loadingModelId === modelDefinition.id' );
		expect( modelSessionSource ).toContain( 'requestId !== modelLoadRequestId' );
		expect( modelSessionSource ).toContain( 'disposeModelRuntimeBundle( bundle )' );

	} );

	it( 'isolates DOM HUD clicks from canvas selection and placement', () => {

		expect( pipeHudSource ).toContain( 'data-ar-ui="true"' );
		expect( pipeHudSource ).toContain( '@pointerdown.stop' );
		expect( workspaceSource ).toContain( 'data-ar-ui="true"' );
		expect( workspaceSource ).toContain( 'trackingNormal.value' );

	} );

} );

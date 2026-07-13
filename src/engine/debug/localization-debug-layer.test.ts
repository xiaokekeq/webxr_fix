import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VisualControlTarget } from '@/features/ar/types/workflow.js';
import type { EngineeringRegistrationSolution } from '@/localization/coarse/engineering-registration.js';
import type { ArFromEnuSolution } from '@/localization/core/ar-from-enu-solution.js';
import { LocalizationDebugLayer, type LocalizationDebugSnapshot } from './localization-debug-layer.js';

describe( 'LocalizationDebugLayer', () => {

	beforeEach( () => {

		vi.stubGlobal( 'document', { createElement: () => createFakeCanvas() } );

	} );

	afterEach( () => {

		vi.unstubAllGlobals();

	} );

	it( 'keeps captured Marker points when registration data is missing', () => {

		const layer = new LocalizationDebugLayer();
		layer.sync( createSnapshot( {
			arFromEnuSolution: null,
			controlTarget: null,
			registrationSolution: null,
			capturedCornersAr: square(),
			layers: { ...defaultLayers, showMarkerCaptured: true }
		} ) );

		expect( countMeshes( layer.root, 'marker-captured-' ) ).toBe( 4 );
		expect( layer.root.getObjectByName( 'site-origin-reference-point' ) ).toBeUndefined();

	} );

	it( 'draws yellow points without requiring purple model points', () => {

		const layer = new LocalizationDebugLayer();
		const result = layer.sync( createSnapshot() );

		expect( result.yellowControlPointCount ).toBe( 4 );
		expect( countMeshes( layer.root, 'model-cp-actual-engineering-' ) ).toBe( 0 );

	} );

	it( 'uses the original engineering sphere sizes', () => {

		const layer = new LocalizationDebugLayer();
		layer.sync( createSnapshot() );

		expect( sphereRadius( layer.root, 'footprint-enu-p1' ) ).toBe( 0.035 );
		expect( sphereRadius( layer.root, 'marker-center' ) ).toBe( 0.045 );
		expect( sphereRadius( layer.root, 'site-origin-reference-point' ) ).toBe( 0.055 );

	} );

} );

const defaultLayers = {
	showMarkerExpected: false,
	showMarkerCaptured: false,
	showModelActualControlPoints: true,
	showModelBoundingBox: false
};

function createSnapshot(overrides: Partial<LocalizationDebugSnapshot> = {}): LocalizationDebugSnapshot {

	return {
		arFromEnuSolution: { matrix: new THREE.Matrix4(), source: 'marker-corners-4' } as unknown as ArFromEnuSolution,
		controlTarget: {
			id: 'marker-1',
			cornersEnu: square().map( ( point ) => point.toArray() )
		} as unknown as VisualControlTarget,
		registrationSolution: {
			controlPoints: square().map( ( point, index ) => ( { id: `p${index + 1}`, worldEnu: point } ) )
		} as unknown as EngineeringRegistrationSolution,
		capturedCornersAr: [],
		actualModelControlPoints: null,
		showCurrentModelControlPoints: false,
		showSiteOriginDetail: false,
		layers: defaultLayers,
		...overrides
	};

}

function square(): THREE.Vector3[] {

	return [
		new THREE.Vector3( 0, 0, 0 ),
		new THREE.Vector3( 1, 0, 0 ),
		new THREE.Vector3( 1, 0, 1 ),
		new THREE.Vector3( 0, 0, 1 )
	];

}

function countMeshes(root: THREE.Object3D, prefix: string): number {

	return root.children.filter( ( child ) => child instanceof THREE.Mesh && child.name.startsWith( prefix ) ).length;

}

function sphereRadius(root: THREE.Object3D, name: string): number {

	const mesh = root.getObjectByName( name ) as THREE.Mesh<THREE.SphereGeometry>;
	return mesh.geometry.parameters.radius;

}

function createFakeCanvas(): HTMLCanvasElement {

	const context = {
		clearRect: vi.fn(),
		fillRect: vi.fn(),
		strokeRect: vi.fn(),
		fillText: vi.fn(),
		measureText: ( text: string ) => ( { width: text.length * 20 } )
	};
	return { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;

}

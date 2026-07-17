import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createXRHitTestController } from './xr-support.js';
import { composeWorldLockCorrection } from './xr.js';

async function createHitTestController() {

	let handleSessionStart!: () => Promise<void>;
	const referenceSpace = {} as XRReferenceSpace;
	const hitTestSource = {} as XRHitTestSource;
	const session = {
		requestReferenceSpace: vi.fn().mockResolvedValue( {} ),
		requestHitTestSource: vi.fn().mockResolvedValue( hitTestSource ),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn()
	} as unknown as XRSession;
	const renderer = {
		xr: {
			isPresenting: true,
			addEventListener: vi.fn( ( type: string, listener: () => Promise<void> ) => {
				if ( type === 'sessionstart' ) handleSessionStart = listener;
			} ),
			getSession: () => session,
			getReferenceSpace: () => referenceSpace
		}
	} as unknown as THREE.WebGLRenderer;
	const controller = createXRHitTestController( {
		renderer,
		reticle: new THREE.Group(),
		xrButtonWrap: { replaceChildren: vi.fn() } as unknown as HTMLElement,
		setStatus: vi.fn()
	} );
	controller.setup();
	await handleSessionStart();
	return controller;

}

function createHitFrame(createAnchor: () => Promise<{ anchorSpace: XRSpace }>): XRFrame {

	const hitResult = {
		getPose: () => ( {
			transform: { matrix: new THREE.Matrix4().makeTranslation( 1, 2, 3 ).toArray() }
		} ),
		createAnchor
	} as unknown as XRHitTestResult;
	return { getHitTestResults: () => [ hitResult ] } as unknown as XRFrame;

}

describe( 'composeWorldLockCorrection', () => {

	it( 'maps the original anchor pose to its latest tracked pose', () => {

		const initialPose = new THREE.Matrix4().compose(
			new THREE.Vector3( 2, 0, -1 ),
			new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), Math.PI / 4 ),
			new THREE.Vector3( 1, 1, 1 )
		);
		const currentPose = new THREE.Matrix4().compose(
			new THREE.Vector3( -1, 0.5, 3 ),
			new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), - Math.PI / 3 ),
			new THREE.Vector3( 1, 1, 1 )
		);
		const correctedInitialPose = composeWorldLockCorrection(
			currentPose,
			initialPose.clone().invert()
		).multiply( initialPose );

		expect( correctedInitialPose.elements ).toEqual(
			currentPose.elements.map( ( value ) => expect.closeTo( value, 10 ) )
		);

	} );

} );

describe( 'XR hit-test anchor creation', () => {

	it( 'starts createAnchor while the hit-test XRFrame is active', async () => {

		const controller = await createHitTestController();
		let frameActive = false;
		const anchor = { anchorSpace: {} as XRSpace };
		const createAnchor = vi.fn( () => {
			if ( frameActive === false ) throw new DOMException( 'inactive frame', 'InvalidStateError' );
			return Promise.resolve( anchor );
		} );
		const placementPromise = controller.createAnchorFromNextHit();
		frameActive = true;
		controller.update( createHitFrame( createAnchor ) );
		frameActive = false;
		const placement = await placementPromise;

		expect( createAnchor ).toHaveBeenCalledOnce();
		expect( placement?.anchor ).toBe( anchor );
		expect( new THREE.Vector3().setFromMatrixPosition( placement!.initialPoseMatrix ).toArray() ).toEqual( [ 1, 2, 3 ] );

	} );

	it( 'cancels an in-flight native anchor request immediately and deletes a late anchor', async () => {

		const controller = await createHitTestController();
		let resolveNative!: (anchor: { anchorSpace: XRSpace; delete(): void }) => void;
		const nativePromise = new Promise<{ anchorSpace: XRSpace; delete(): void }>( ( resolve ) => {
			resolveNative = resolve;
		} );
		const placementPromise = controller.createAnchorFromNextHit();
		controller.update( createHitFrame( () => nativePromise ) );
		controller.cancelPendingAnchorRequest();

		expect( await placementPromise ).toBeNull();
		const lateAnchor = { anchorSpace: {} as XRSpace, delete: vi.fn() };
		resolveNative( lateAnchor );
		await Promise.resolve();
		expect( lateAnchor.delete ).toHaveBeenCalledOnce();

	} );

} );

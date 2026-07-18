import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createXRHitTestController, shouldPreventXRSelect } from './xr-support.js';
import {
	composeReferenceSpaceResetCompensation,
	composeWorldLockCorrection,
	createXRSessionRuntime
} from './xr.js';

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

describe( 'XR interaction isolation', () => {

	it( 'cancels XR selection for AR UI or while the HUD lock is active', () => {

		const uiTarget = { closest: vi.fn().mockReturnValue( {} ) } as unknown as EventTarget;
		const worldTarget = { closest: vi.fn().mockReturnValue( null ) } as unknown as EventTarget;

		expect( shouldPreventXRSelect( uiTarget, false ) ).toBe( true );
		expect( shouldPreventXRSelect( worldTarget, false ) ).toBe( false );
		expect( shouldPreventXRSelect( worldTarget, true ) ).toBe( true );

	} );

} );

describe( 'reference-space reset compensation', () => {

	it( 'left-multiplies the full inverse reset transform', () => {

		const current = new THREE.Matrix4().compose(
			new THREE.Vector3( 4, 2, -3 ),
			new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), Math.PI / 5 ),
			new THREE.Vector3( 1, 1, 1 )
		);
		const reset = new THREE.Matrix4().compose(
			new THREE.Vector3( 1, -0.5, 2 ),
			new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), - Math.PI / 3 ),
			new THREE.Vector3( 1, 1, 1 )
		);
		const expected = reset.clone().invert().multiply( current );
		const actual = composeReferenceSpaceResetCompensation( current, reset );

		expect( actual.elements ).toEqual(
			expected.elements.map( ( value ) => expect.closeTo( value, 10 ) )
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
		expect( placement.status ).toBe( 'anchored' );
		if ( placement.status !== 'anchored' ) throw new Error( 'Expected an anchored placement.' );
		expect( placement.anchor ).toBe( anchor );
		expect( new THREE.Vector3().setFromMatrixPosition( placement.initialPoseMatrix ).toArray() ).toEqual( [ 1, 2, 3 ] );

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

		expect( await placementPromise ).toEqual( { status: 'cancelled' } );
		const lateAnchor = { anchorSpace: {} as XRSpace, delete: vi.fn() };
		resolveNative( lateAnchor );
		await Promise.resolve();
		expect( lateAnchor.delete ).toHaveBeenCalledOnce();

	} );

	it( 'reports unsupported when the hit result cannot create anchors', async () => {

		const controller = await createHitTestController();
		const placementPromise = controller.createAnchorFromNextHit();
		controller.update( {
			getHitTestResults: () => [ {
				getPose: () => ( {
					transform: { matrix: new THREE.Matrix4().toArray() }
				} )
			} ]
		} as unknown as XRFrame );

		expect( await placementPromise ).toEqual( { status: 'unsupported' } );

	} );

} );

describe( 'XR tracking recovery', () => {

	it( 'keeps the same placed model and does not replay auto placement', async () => {

		let handleSessionStart!: () => Promise<void>;
		const referenceSpace = {
			addEventListener: vi.fn(),
			removeEventListener: vi.fn()
		} as unknown as XRReferenceSpace;
		const hitTestSource = {} as XRHitTestSource;
		const session = {
			visibilityState: 'visible',
			requestReferenceSpace: vi.fn().mockResolvedValue( {} ),
			requestHitTestSource: vi.fn().mockResolvedValue( hitTestSource ),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn()
		} as unknown as XRSession;
		const renderer = {
			render: vi.fn(),
			xr: {
				isPresenting: true,
				addEventListener: vi.fn( ( type: string, listener: () => Promise<void> ) => {
					if ( type === 'sessionstart' ) handleSessionStart = listener;
				} ),
				getSession: () => session,
				getReferenceSpace: () => referenceSpace
			}
		} as unknown as THREE.WebGLRenderer;
		const arPlacementAnchor = new THREE.Group();
		const arModelAnchor = new THREE.Group();
		const placedModel = new THREE.Group();
		arModelAnchor.add( placedModel );
		arPlacementAnchor.add( arModelAnchor );
		const onAttemptAutoPlacement = vi.fn();
		const runtime = createXRSessionRuntime( {
			sceneBundle: {
				scene: new THREE.Scene(),
				camera: new THREE.PerspectiveCamera(),
				renderer,
				reticle: new THREE.Group(),
				arPlacementAnchor,
				arModelAnchor
			},
			xrButtonWrap: { replaceChildren: vi.fn() } as unknown as HTMLElement,
			setStatus: vi.fn(),
			onSessionStart: vi.fn(),
			onSessionEnd: vi.fn(),
			canReportStatus: () => false,
			isHudPickingLocked: () => false,
			onInteractionStateChange: vi.fn(),
			onAttemptAutoPlacement,
			onFrameUpdate: vi.fn()
		} );
		runtime.setup();
		await handleSessionStart();

		const trackingSequence: Array<XRViewerPose | null> = [
			{ emulatedPosition: false } as XRViewerPose,
			{ emulatedPosition: true } as XRViewerPose,
			null,
			{ emulatedPosition: false } as XRViewerPose
		];
		for ( const pose of trackingSequence ) {
			runtime.renderFrame( 0, {
				getViewerPose: () => pose,
				getHitTestResults: () => []
			} as unknown as XRFrame );
		}

		expect( arModelAnchor.children[ 0 ] ).toBe( placedModel );
		expect( arPlacementAnchor.visible ).toBe( true );
		expect( runtime.getInteractionState().tracking ).toBe( 'normal' );
		expect( onAttemptAutoPlacement ).not.toHaveBeenCalled();

	} );

} );

describe( 'XR world-lock transaction', () => {

	it( 'keeps the committed anchor when a replacement anchor fails', async () => {

		let handleSessionStart!: () => Promise<void>;
		const referenceSpace = {
			addEventListener: vi.fn(),
			removeEventListener: vi.fn()
		} as unknown as XRReferenceSpace;
		const session = {
			visibilityState: 'visible',
			requestReferenceSpace: vi.fn().mockResolvedValue( {} ),
			requestHitTestSource: vi.fn().mockResolvedValue( {} ),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn()
		} as unknown as XRSession;
		const renderer = {
			render: vi.fn(),
			xr: {
				isPresenting: true,
				addEventListener: vi.fn( ( type: string, listener: () => Promise<void> ) => {
					if ( type === 'sessionstart' ) handleSessionStart = listener;
				} ),
				getSession: () => session,
				getReferenceSpace: () => referenceSpace
			}
		} as unknown as THREE.WebGLRenderer;
		const arModelAnchor = new THREE.Group();
		arModelAnchor.add( new THREE.Group() );
		const runtime = createXRSessionRuntime( {
			sceneBundle: {
				scene: new THREE.Scene(),
				camera: new THREE.PerspectiveCamera(),
				renderer,
				reticle: new THREE.Group(),
				arPlacementAnchor: new THREE.Group(),
				arModelAnchor
			},
			xrButtonWrap: { replaceChildren: vi.fn() } as unknown as HTMLElement,
			setStatus: vi.fn(),
			onSessionStart: vi.fn(),
			onSessionEnd: vi.fn(),
			canReportStatus: () => false,
			isHudPickingLocked: () => false,
			onInteractionStateChange: vi.fn(),
			onAttemptAutoPlacement: vi.fn(),
			onFrameUpdate: vi.fn()
		} );
		runtime.setup();
		await handleSessionStart();
		const viewerPose = { emulatedPosition: false } as XRViewerPose;
		runtime.renderFrame( 0, {
			getViewerPose: () => viewerPose,
			getHitTestResults: () => []
		} as unknown as XRFrame );

		const firstAnchor = { anchorSpace: {} as XRSpace, delete: vi.fn() };
		const firstPreparationPromise = runtime.prepareModelWorldLock();
		runtime.renderFrame( 0, createRuntimeHitFrame( firstAnchor, viewerPose ) );
		const firstPreparation = await firstPreparationPromise;
		expect( firstPreparation.status ).toBe( 'anchored' );
		expect( runtime.commitModelWorldLock( firstPreparation ) ).toBe( true );

		const replacementPromise = runtime.prepareModelWorldLock();
		runtime.renderFrame( 0, createRuntimeHitFrame( null, viewerPose, new Error( 'anchor failed' ) ) );
		const replacement = await replacementPromise;

		expect( replacement.status ).toBe( 'failed' );
		expect( firstAnchor.delete ).not.toHaveBeenCalled();
		expect( runtime.getInteractionState().worldLock ).toBe( 'anchored' );

	} );

} );

function createRuntimeHitFrame(
	anchor: { anchorSpace: XRSpace; delete(): void } | null,
	viewerPose: XRViewerPose,
	error?: Error
): XRFrame {

	const hitResult = {
		getPose: () => ( {
			transform: { matrix: new THREE.Matrix4().makeTranslation( 1, 0, -1 ).toArray() }
		} ),
		createAnchor: () => error === undefined ? Promise.resolve( anchor! ) : Promise.reject( error )
	} as unknown as XRHitTestResult;
	return {
		getViewerPose: () => viewerPose,
		getHitTestResults: () => [ hitResult ],
		getPose: () => ( {
			transform: { matrix: new THREE.Matrix4().toArray() }
		} )
	} as unknown as XRFrame;

}

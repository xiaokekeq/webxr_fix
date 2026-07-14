import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { getSectionCapFacingNormal, SectionCapRuntime } from './section-cap-runtime.js';

describe( 'SectionCapRuntime', () => {

	it( 'builds FrontSide caps toward the clipped-away half-space on every axis', () => {

		for ( const normal of [ new THREE.Vector3( 1, 0, 0 ), new THREE.Vector3( 0, 1, 0 ), new THREE.Vector3( 0, 0, 1 ) ] ) {
			const root = createBoxRoot();
			const plane = new THREE.Plane( normal, 0 );
			const runtime = new SectionCapRuntime();
			runtime.sync( root, plane, { geometryDirty: true } );

			const cap = getCap( root );
			expect( ( cap.material as THREE.MeshStandardMaterial ).side ).toBe( THREE.FrontSide );
			expect( runtime.getDiagnostics() ).toMatchObject( { loopCount: 1, capMeshCount: 1 } );
			expect( runtime.getDiagnostics().triangleCount ).toBeGreaterThan( 0 );
			expectCapToFaceOpening( root, cap, plane );
			runtime.dispose();
		}

	} );

	it( 'keeps the cap facing correct with a rotated and non-uniformly scaled parent', () => {

		const parent = new THREE.Group();
		parent.rotation.set( 0.3, - 0.7, 0.2 );
		parent.scale.set( 1.5, 0.7, 2.1 );
		const root = createBoxRoot();
		parent.add( root );
		const plane = new THREE.Plane( new THREE.Vector3( 0.2, 1, - 0.3 ).normalize(), 0 );
		const runtime = new SectionCapRuntime();
		runtime.sync( root, plane, { geometryDirty: true } );

		expectCapToFaceOpening( root, getCap( root ), plane );
		runtime.dispose();

	} );

	it( 'preserves the hollow center of a pipe section', () => {

		const root = new THREE.Group();
		root.add( new THREE.Mesh( createHollowPipeGeometry(), new THREE.MeshStandardMaterial() ) );
		const runtime = new SectionCapRuntime();
		runtime.sync( root, new THREE.Plane( new THREE.Vector3( 0, 1, 0 ), 0 ), { geometryDirty: true } );

		const cap = getCap( root );
		expect( runtime.getDiagnostics().triangleCount ).toBeGreaterThan( 0 );
		expect( hasTriangleCoveringOrigin( cap.geometry ) ).toBe( false );
		runtime.dispose();

	} );

	it( 'never builds a section cap from the textured enclosure shell', () => {

		const root = new THREE.Group();
		const shell = new THREE.Mesh( new THREE.BoxGeometry( 2, 2, 2 ), new THREE.MeshBasicMaterial() );
		shell.userData.__enclosureShell = true;
		shell.userData.__excludeFromLayerIndex = true;
		root.add( shell );
		const runtime = new SectionCapRuntime();
		runtime.sync( root, new THREE.Plane( new THREE.Vector3( 0, 1, 0 ), 0 ), { geometryDirty: true } );

		expect( runtime.getDebug().sectionCapExists ).toBe( false );
		expect( runtime.getDiagnostics() ).toMatchObject( { sourceMeshCount: 0, capMeshCount: 0 } );

	} );

	it( 'updates the isolated cap material for xray without rebuilding geometry', () => {

		const root = new THREE.Group();
		const source = new THREE.MeshStandardMaterial( {
			color: 0x2468ac,
			map: new THREE.Texture(),
			alphaMap: new THREE.Texture(),
			alphaTest: 0.5,
			transparent: true,
			opacity: 0.25,
			clippingPlanes: [ new THREE.Plane( new THREE.Vector3( 1, 0, 0 ), 0 ) ]
		} );
		root.add( new THREE.Mesh( new THREE.BoxGeometry( 2, 2, 2 ), source ) );
		const plane = new THREE.Plane( new THREE.Vector3( 0, 1, 0 ), 0 );
		const runtime = new SectionCapRuntime();
		runtime.sync( root, plane, { geometryDirty: true, materialMode: 'solid', opacity: 100 } );

		const cap = getCap( root );
		const material = cap.material as THREE.MeshStandardMaterial;
		const geometry = cap.geometry;
		const rebuildCount = runtime.getDebug().sectionCapRebuildCount;
		expect( material ).not.toBe( source );
			expect( material ).toMatchObject( {
			map: null,
			alphaMap: null,
			alphaTest: 0,
			clippingPlanes: null,
			transparent: false,
			opacity: 1,
			depthTest: true,
			depthWrite: true,
			side: THREE.FrontSide,
			polygonOffset: true
		} );

		runtime.sync( root, plane, { materialDirty: true, materialMode: 'xray', opacity: 50 } );
		expect( cap.geometry ).toBe( geometry );
		expect( runtime.getDebug().sectionCapRebuildCount ).toBe( rebuildCount );
		expect( material ).toMatchObject( { transparent: true, opacity: 0.525, depthWrite: false, clippingPlanes: null } );

		source.color.set( 0xd15a28 );
		runtime.sync( root, plane, { materialMode: 'solid', opacity: 100 } );
		expect( cap.geometry ).toBe( geometry );
		expect( material ).toMatchObject( { transparent: false, opacity: 1, depthWrite: true, color: new THREE.Color( 0xd15a28 ) } );
		runtime.dispose();

	} );

	it( 'removes and disposes caps when clipping is disabled or the source root changes', () => {

		const firstRoot = createBoxRoot();
		const plane = new THREE.Plane( new THREE.Vector3( 0, 1, 0 ), 0 );
		const runtime = new SectionCapRuntime();
		runtime.sync( firstRoot, plane, { geometryDirty: true, sourceModelUuid: 'first' } );
		const firstCap = getCap( firstRoot );
		let geometryDisposed = false;
		let materialDisposed = false;
		firstCap.geometry.addEventListener( 'dispose', () => { geometryDisposed = true; } );
		( firstCap.material as THREE.Material ).addEventListener( 'dispose', () => { materialDisposed = true; } );

		runtime.sync( firstRoot, null );
		expect( firstRoot.getObjectByName( '__section-cap' ) ).toBeUndefined();
		expect( geometryDisposed ).toBe( true );
		expect( materialDisposed ).toBe( true );
		expect( runtime.getDebug().sectionCapExists ).toBe( false );

		const secondRoot = createBoxRoot();
		runtime.sync( secondRoot, plane, { geometryDirty: true, sourceModelUuid: 'second' } );
		expect( firstRoot.getObjectByName( '__section-cap' ) ).toBeUndefined();
		expect( secondRoot.getObjectByName( '__section-cap-root' ) ).toBeDefined();
		runtime.dispose( 'test-cleanup' );
		expect( secondRoot.getObjectByName( '__section-cap' ) ).toBeUndefined();

	} );

	it( 'records open-chain diagnostics without generating a malformed cap', () => {

		const root = new THREE.Group();
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [ - 1, - 1, 0, 1, 1, 0, - 1, 1, 0 ], 3 ) );
		root.add( new THREE.Mesh( geometry, new THREE.MeshBasicMaterial() ) );
		const runtime = new SectionCapRuntime();
		runtime.sync( root, new THREE.Plane( new THREE.Vector3( 0, 1, 0 ), 0 ), { geometryDirty: true } );

		expect( runtime.getDiagnostics() ).toMatchObject( {
			segmentCount: 1,
			loopCount: 0,
			skippedOpenChainCount: 1,
			lastFailureReason: 'no-closed-loops'
		} );
		expect( runtime.getDebug().sectionCapExists ).toBe( false );

	} );

} );

function createBoxRoot(): THREE.Group {

	const root = new THREE.Group();
	root.add( new THREE.Mesh( new THREE.BoxGeometry( 2, 2, 2 ), new THREE.MeshStandardMaterial( { color: 0x55734d } ) ) );
	return root;

}

function getCap(root: THREE.Object3D): THREE.Mesh {

	const cap = root.getObjectByName( '__section-cap' );
	expect( cap ).toBeInstanceOf( THREE.Mesh );
	return cap as THREE.Mesh;

}

function expectCapToFaceOpening(root: THREE.Object3D, cap: THREE.Mesh, plane: THREE.Plane): void {

	root.updateWorldMatrix( true, true );
	const position = cap.geometry.getAttribute( 'position' );
	const facing = getSectionCapFacingNormal( plane ).normalize();
	for ( let index = 0; index < position.count; index += 3 ) {
		const a = new THREE.Vector3().fromBufferAttribute( position, index ).applyMatrix4( cap.matrixWorld );
		const b = new THREE.Vector3().fromBufferAttribute( position, index + 1 ).applyMatrix4( cap.matrixWorld );
		const c = new THREE.Vector3().fromBufferAttribute( position, index + 2 ).applyMatrix4( cap.matrixWorld );
		const normal = b.sub( a ).cross( c.sub( a ) ).normalize();
		expect( normal.dot( facing ) ).toBeGreaterThan( 0.99 );
	}

}

function createHollowPipeGeometry(): THREE.BufferGeometry {

	const positions: number[] = [];
	const outerRadius = 2;
	const innerRadius = 1;
	const halfHeight = 1;
	const segments = 16;
	for ( let index = 0; index < segments; index += 1 ) {
		const angleA = index / segments * Math.PI * 2;
		const angleB = ( index + 1 ) / segments * Math.PI * 2;
		const outerLowerA = pointOnCylinder( outerRadius, - halfHeight, angleA );
		const outerUpperA = pointOnCylinder( outerRadius, halfHeight, angleA );
		const outerLowerB = pointOnCylinder( outerRadius, - halfHeight, angleB );
		const outerUpperB = pointOnCylinder( outerRadius, halfHeight, angleB );
		appendQuad( positions, outerLowerA, outerUpperA, outerUpperB, outerLowerB );
		const innerLowerA = pointOnCylinder( innerRadius, - halfHeight, angleA );
		const innerUpperA = pointOnCylinder( innerRadius, halfHeight, angleA );
		const innerLowerB = pointOnCylinder( innerRadius, - halfHeight, angleB );
		const innerUpperB = pointOnCylinder( innerRadius, halfHeight, angleB );
		appendQuad( positions, innerLowerB, innerUpperB, innerUpperA, innerLowerA );
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	return geometry;

}

function pointOnCylinder(radius: number, y: number, angle: number): THREE.Vector3 {

	return new THREE.Vector3( Math.cos( angle ) * radius, y, Math.sin( angle ) * radius );

}

function appendQuad(positions: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): void {

	positions.push( a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z );

}

function hasTriangleCoveringOrigin(geometry: THREE.BufferGeometry): boolean {

	const position = geometry.getAttribute( 'position' );
	for ( let index = 0; index < position.count; index += 3 ) {
		const a = new THREE.Vector2( position.getX( index ), position.getZ( index ) );
		const b = new THREE.Vector2( position.getX( index + 1 ), position.getZ( index + 1 ) );
		const c = new THREE.Vector2( position.getX( index + 2 ), position.getZ( index + 2 ) );
		if ( containsPoint( new THREE.Vector2(), a, b, c ) ) return true;
	}
	return false;

}

function containsPoint(point: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2): boolean {

	const denominator = ( b.y - c.y ) * ( a.x - c.x ) + ( c.x - b.x ) * ( a.y - c.y );
	if ( Math.abs( denominator ) < 1e-8 ) return false;
	const first = ( ( b.y - c.y ) * ( point.x - c.x ) + ( c.x - b.x ) * ( point.y - c.y ) ) / denominator;
	const second = ( ( c.y - a.y ) * ( point.x - c.x ) + ( a.x - c.x ) * ( point.y - c.y ) ) / denominator;
	const third = 1 - first - second;
	return first >= 0 && second >= 0 && third >= 0;

}

import * as THREE from 'three';
import {
	cloneEnclosureMaterial,
	resolveEnclosureMaterialSources,
	type EnclosureFaceName
} from './enclosure-material-resolver.js';

type FixedAxis = 'x' | 'y' | 'z';

interface EnclosureFaceDefinition {
	name: EnclosureFaceName;
	fixedAxis: FixedAxis;
	fixedValue: number;
	expectedNormal: THREE.Vector3;
	dimensions: THREE.Vector2;
	points: THREE.Vector3[];
}

export interface EnclosureFaceDiagnostic {
	faceName: EnclosureFaceName;
	fixedAxis: FixedAxis;
	fixedValue: number;
	bounds: { min: number[]; max: number[] };
	averageNormal: number[];
	expectedNormal: number[];
	normalDot: number;
	visible: boolean;
	materialSource: string;
}

export interface EnclosureGeometryValidation {
	ok: boolean;
	faceDiagnostics: EnclosureFaceDiagnostic[];
	triangleCount: number;
	boundaryCornersConnected: boolean;
}

export type EnclosureShellBuildFailureReason =
	| 'empty-model'
	| 'invalid-bounds'
	| 'degenerate-bounds'
	| 'invalid-face-geometry'
	| 'material-source-missing';

export type EnclosureShellBuildResult = {
	ok: true;
	root: THREE.Group;
	meshCount: number;
	triangleCount: number;
	materialCount: number;
	materialSources: Record<EnclosureFaceName, string>;
	bounds: THREE.Box3;
	renderableCount: number;
	axisU: THREE.Vector3;
	axisV: THREE.Vector3;
	axisUp: THREE.Vector3;
	faceDiagnostics: EnclosureFaceDiagnostic[];
} | {
	ok: false;
	reason: EnclosureShellBuildFailureReason;
	bounds: THREE.Box3 | null;
	message: string;
};

const ENCLOSURE_BOUNDS_EPSILON = 1e-6;

export function buildEnclosureShell(modelRoot: THREE.Object3D): EnclosureShellBuildResult {

	modelRoot.updateWorldMatrix( true, true );
	const bounds = resolveLocalBounds( modelRoot );
	const renderableCount = countRenderableMeshes( modelRoot );
	if ( renderableCount === 0 || bounds.isEmpty() ) {
		return buildFailure( 'empty-model', null, 'Model has no renderable geometry.' );
	}
	if ( [ ...bounds.min.toArray(), ...bounds.max.toArray() ].every( Number.isFinite ) === false ) {
		return buildFailure( 'invalid-bounds', null, 'Model bounds contain non-finite values.' );
	}
	const size = bounds.getSize( new THREE.Vector3() );
	if ( size.toArray().some( ( value ) => value <= ENCLOSURE_BOUNDS_EPSILON ) ) {
		return buildFailure( 'degenerate-bounds', bounds, 'Model bounds are degenerate.' );
	}

	const validation = validateEnclosureFaceGeometry( bounds );
	if ( validation.ok === false ) {
		return buildFailure( 'invalid-face-geometry', bounds, 'Invalid five-face enclosure geometry.' );
	}

	const sources = resolveEnclosureMaterialSources( modelRoot, bounds );
	if ( sources === null ) {
		return buildFailure( 'material-source-missing', bounds, 'No enclosure material source is available.' );
	}
	const root = new THREE.Group();
	root.name = '__textured-enclosure-shell';
	root.userData.__enclosureShell = true;
	root.userData.__excludeFromLayerIndex = true;
	const faceDefinitions = createFaceDefinitions( bounds );
	for ( const face of faceDefinitions ) {
		const source = sources[ face.name ];
		const material = cloneEnclosureMaterial( source );
		const mesh = new THREE.Mesh(
			makeFaceGeometry(
				face.points,
				face.dimensions.x / source.metersPerUv,
				face.dimensions.y / source.metersPerUv
			),
			material
		);
		mesh.name = `__enclosure-${face.name}`;
		mesh.userData.__enclosureShell = true;
		mesh.userData.__excludeFromLayerIndex = true;
		mesh.userData.enclosureFace = face.name;
		mesh.userData.materialSource = source.source;
		root.add( mesh );
	}

	modelRoot.add( root );
	return {
		ok: true,
		root,
		meshCount: 5,
		triangleCount: validation.triangleCount,
		materialCount: 5,
		materialSources: Object.fromEntries(
			Object.entries( sources ).map( ( [ face, source ] ) => [ face, source.source ] )
		) as Record<EnclosureFaceName, string>,
		bounds,
		renderableCount,
		axisU: new THREE.Vector3( 1, 0, 0 ),
		axisV: new THREE.Vector3( 0, 0, 1 ),
		axisUp: new THREE.Vector3( 0, 1, 0 ),
		faceDiagnostics: validation.faceDiagnostics.map( ( diagnostic ) => ( {
			...diagnostic,
			materialSource: sources[ diagnostic.faceName ].source
		} ) )
	};

}

/** Pure geometry check; the asymmetric box catches accidental Y/Z swaps. */
export function runEnclosureFaceGeometrySelfCheck(): void {

	const bounds = new THREE.Box3(
		new THREE.Vector3( - 2, - 3, - 5 ),
		new THREE.Vector3( 7, 11, 13 )
	);
	const validation = validateEnclosureFaceGeometry( bounds );
	if ( validation.ok === false ) {
		throw new Error( 'Five-face enclosure geometry self-check failed.' );
	}

}

export function validateEnclosureFaceGeometry(bounds: THREE.Box3): EnclosureGeometryValidation {

	const faces = createFaceDefinitions( bounds );
	const faceDiagnostics = faces.map( ( face ) => validateFaceGeometry( face ) );
	const triangleCount = faces.reduce( ( total, face ) => total + faceTriangleCount( face.points ), 0 );
	const boundaryCornersConnected = hasConnectedBoundaryCorners( faces, bounds );
	return {
		ok: faceDiagnostics.every( ( diagnostic ) => diagnostic.normalDot > 0.99 )
			&& triangleCount === 10
			&& boundaryCornersConnected,
		faceDiagnostics,
		triangleCount,
		boundaryCornersConnected
	};

}

function buildFailure(reason: EnclosureShellBuildFailureReason, bounds: THREE.Box3 | null, message: string): EnclosureShellBuildResult {

	return { ok: false, reason, bounds: bounds?.clone() ?? null, message };

}

function createFaceDefinitions(bounds: THREE.Box3): EnclosureFaceDefinition[] {

	const size = bounds.getSize( new THREE.Vector3() );
	return [
		createFrontFace( bounds, size ),
		createBackFace( bounds, size ),
		createLeftFace( bounds, size ),
		createRightFace( bounds, size ),
		createBottomFace( bounds, size )
	];

}

function createFrontFace(bounds: THREE.Box3, size: THREE.Vector3): EnclosureFaceDefinition {

	const z = bounds.min.z;
	return {
		name: 'front',
		fixedAxis: 'z',
		fixedValue: z,
		expectedNormal: new THREE.Vector3( 0, 0, - 1 ),
		dimensions: new THREE.Vector2( size.x, size.y ),
		points: [
			new THREE.Vector3( bounds.min.x, bounds.min.y, z ),
			new THREE.Vector3( bounds.min.x, bounds.max.y, z ),
			new THREE.Vector3( bounds.max.x, bounds.max.y, z ),
			new THREE.Vector3( bounds.max.x, bounds.min.y, z )
		]
	};

}

function createBackFace(bounds: THREE.Box3, size: THREE.Vector3): EnclosureFaceDefinition {

	const z = bounds.max.z;
	return {
		name: 'back',
		fixedAxis: 'z',
		fixedValue: z,
		expectedNormal: new THREE.Vector3( 0, 0, 1 ),
		dimensions: new THREE.Vector2( size.x, size.y ),
		points: [
			new THREE.Vector3( bounds.min.x, bounds.min.y, z ),
			new THREE.Vector3( bounds.max.x, bounds.min.y, z ),
			new THREE.Vector3( bounds.max.x, bounds.max.y, z ),
			new THREE.Vector3( bounds.min.x, bounds.max.y, z )
		]
	};

}

function createLeftFace(bounds: THREE.Box3, size: THREE.Vector3): EnclosureFaceDefinition {

	const x = bounds.min.x;
	return {
		name: 'left',
		fixedAxis: 'x',
		fixedValue: x,
		expectedNormal: new THREE.Vector3( - 1, 0, 0 ),
		dimensions: new THREE.Vector2( size.z, size.y ),
		points: [
			new THREE.Vector3( x, bounds.min.y, bounds.min.z ),
			new THREE.Vector3( x, bounds.min.y, bounds.max.z ),
			new THREE.Vector3( x, bounds.max.y, bounds.max.z ),
			new THREE.Vector3( x, bounds.max.y, bounds.min.z )
		]
	};

}

function createRightFace(bounds: THREE.Box3, size: THREE.Vector3): EnclosureFaceDefinition {

	const x = bounds.max.x;
	return {
		name: 'right',
		fixedAxis: 'x',
		fixedValue: x,
		expectedNormal: new THREE.Vector3( 1, 0, 0 ),
		dimensions: new THREE.Vector2( size.z, size.y ),
		points: [
			new THREE.Vector3( x, bounds.min.y, bounds.min.z ),
			new THREE.Vector3( x, bounds.max.y, bounds.min.z ),
			new THREE.Vector3( x, bounds.max.y, bounds.max.z ),
			new THREE.Vector3( x, bounds.min.y, bounds.max.z )
		]
	};

}

function createBottomFace(bounds: THREE.Box3, size: THREE.Vector3): EnclosureFaceDefinition {

	const y = bounds.min.y;
	return {
		name: 'bottom',
		fixedAxis: 'y',
		fixedValue: y,
		expectedNormal: new THREE.Vector3( 0, - 1, 0 ),
		dimensions: new THREE.Vector2( size.x, size.z ),
		points: [
			new THREE.Vector3( bounds.min.x, y, bounds.min.z ),
			new THREE.Vector3( bounds.max.x, y, bounds.min.z ),
			new THREE.Vector3( bounds.max.x, y, bounds.max.z ),
			new THREE.Vector3( bounds.min.x, y, bounds.max.z )
		]
	};

}

function validateFaceGeometry(face: EnclosureFaceDefinition): EnclosureFaceDiagnostic {

	const geometry = makeFaceGeometry( face.points, 1, 1 );
	const normal = geometry.getAttribute( 'normal' );
	const faceBounds = new THREE.Box3().setFromPoints( face.points );
	const averageNormal = new THREE.Vector3();
	for ( let index = 0; index < normal.count; index += 1 ) {
		averageNormal.add( new THREE.Vector3().fromBufferAttribute( normal, index ) );
	}
	averageNormal.normalize();
	const expected = face.expectedNormal;
	const fixedPlaneMatches = face.points.every( ( point ) => Math.abs( point[ face.fixedAxis ] - face.fixedValue ) < 1e-6 );
	const dimensionsMatch = faceBounds.getSize( new THREE.Vector3() )
		.distanceTo( expectedFaceSize( face ) ) < 1e-6;
	const normalDot = averageNormal.dot( expected );
	geometry.dispose();
	return {
		faceName: face.name,
		fixedAxis: face.fixedAxis,
		fixedValue: face.fixedValue,
		bounds: { min: faceBounds.min.toArray(), max: faceBounds.max.toArray() },
		averageNormal: averageNormal.toArray(),
		expectedNormal: expected.toArray(),
		normalDot: fixedPlaneMatches && dimensionsMatch ? normalDot : - 1,
		visible: true,
		materialSource: 'none'
	};

}

function expectedFaceSize(face: EnclosureFaceDefinition): THREE.Vector3 {

	if ( face.fixedAxis === 'x' ) return new THREE.Vector3( 0, face.dimensions.y, face.dimensions.x );
	if ( face.fixedAxis === 'y' ) return new THREE.Vector3( face.dimensions.x, 0, face.dimensions.y );
	return new THREE.Vector3( face.dimensions.x, face.dimensions.y, 0 );

}

function faceTriangleCount(points: THREE.Vector3[]): number {

	const geometry = makeFaceGeometry( points, 1, 1 );
	const triangleCount = ( geometry.getIndex()?.count ?? 0 ) / 3;
	geometry.dispose();
	return triangleCount;

}

function hasConnectedBoundaryCorners(faces: EnclosureFaceDefinition[], bounds: THREE.Box3): boolean {

	const counts = new Map<string, number>();
	faces.flatMap( ( face ) => face.points ).forEach( ( point ) => {
		const key = point.toArray().join( ',' );
		counts.set( key, ( counts.get( key ) ?? 0 ) + 1 );
	} );
	for ( const x of [ bounds.min.x, bounds.max.x ] ) {
		for ( const y of [ bounds.min.y, bounds.max.y ] ) {
			for ( const z of [ bounds.min.z, bounds.max.z ] ) {
				const count = counts.get( [ x, y, z ].join( ',' ) ) ?? 0;
				const expectedCount = y === bounds.min.y ? 3 : 2;
				if ( count !== expectedCount ) return false;
			}
		}
	}
	return true;

}

function countRenderableMeshes(root: THREE.Object3D): number {

	let count = 0;
	root.traverse( ( object ) => {
		if ( object instanceof THREE.Mesh && object.userData.__visualizationHelper !== true && object.userData.__enclosureShell !== true ) count += 1;
	} );
	return count;

}

function resolveLocalBounds(root: THREE.Object3D): THREE.Box3 {

	const bounds = new THREE.Box3();
	const inverseRoot = root.matrixWorld.clone().invert();
	const relative = new THREE.Matrix4();
	const point = new THREE.Vector3();
	root.traverse( ( object ) => {
		if ( object instanceof THREE.Mesh === false || object.userData.__visualizationHelper === true || object.userData.__enclosureShell === true ) return;
		if ( object.geometry.boundingBox === null ) object.geometry.computeBoundingBox();
		if ( object.geometry.boundingBox === null ) return;
		relative.multiplyMatrices( inverseRoot, object.matrixWorld );
		const box = object.geometry.boundingBox;
		for ( const x of [ box.min.x, box.max.x ] ) {
			for ( const y of [ box.min.y, box.max.y ] ) {
				for ( const z of [ box.min.z, box.max.z ] ) {
					bounds.expandByPoint( point.set( x, y, z ).applyMatrix4( relative ) );
				}
			}
		}
	} );
	return bounds;

}

function makeFaceGeometry(points: THREE.Vector3[], repeatU: number, repeatV: number): THREE.BufferGeometry {

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		'position',
		new THREE.Float32BufferAttribute( points.flatMap( ( point ) => point.toArray() ), 3 )
	);
	geometry.setIndex( [ 0, 1, 2, 0, 2, 3 ] );
	geometry.setAttribute(
		'uv',
		new THREE.Float32BufferAttribute( [ 0, 0, repeatU, 0, repeatU, repeatV, 0, repeatV ], 2 )
	);
	geometry.computeVertexNormals();
	return geometry;

}

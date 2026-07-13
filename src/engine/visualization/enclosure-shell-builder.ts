import * as THREE from 'three';
import { computeModelBusinessLocalBounds } from '@/engine/core/model.js';

type FixedAxis = 'x' | 'y' | 'z';
export type EnclosureFaceName = 'front' | 'back' | 'left' | 'right' | 'bottom';

interface EnclosureFaceDefinition {
	name: EnclosureFaceName;
	fixedAxis: FixedAxis;
	fixedValue: number;
	expectedNormal: THREE.Vector3;
	dimensions: THREE.Vector2;
	points: THREE.Vector3[];
	uvs: number[];
}

export interface EnclosureGeometryValidation {
	ok: boolean;
	triangleCount: number;
	boundaryCornersConnected: boolean;
}

export type EnclosureOffscreenRenderer = Pick<THREE.WebGLRenderer,
	'clear' | 'getClearAlpha' | 'getClearColor' | 'getRenderTarget' | 'render' | 'setClearColor' | 'setRenderTarget'>;

export interface EnclosureShellBuildOptions {
	renderer: EnclosureOffscreenRenderer;
	lightingScene?: THREE.Scene;
}

export type EnclosureShellBuildFailureReason =
	| 'empty-model'
	| 'invalid-bounds'
	| 'degenerate-bounds'
	| 'invalid-face-geometry'
	| 'capture-failed';

export type EnclosureShellBuildResult = {
	ok: true;
	root: THREE.Group;
	meshCount: number;
	bounds: THREE.Box3;
	renderableCount: number;
	renderTargets: THREE.WebGLRenderTarget[];
} | {
	ok: false;
	reason: EnclosureShellBuildFailureReason;
	bounds: THREE.Box3 | null;
	message: string;
};

const ENCLOSURE_BOUNDS_EPSILON = 1e-6;
const ENCLOSURE_CAPTURE_SIZE = 1024;
const faceNames: EnclosureFaceName[] = [ 'front', 'back', 'left', 'right', 'bottom' ];

export function buildEnclosureShell(modelRoot: THREE.Object3D, options: EnclosureShellBuildOptions): EnclosureShellBuildResult {

	modelRoot.updateWorldMatrix( true, true );
	const bounds = computeModelBusinessLocalBounds( modelRoot );
	const renderableCount = countRenderableMeshes( modelRoot );
	if ( renderableCount === 0 || bounds.isEmpty() ) return buildFailure( 'empty-model', null, 'Model has no renderable geometry.' );
	if ( [ ...bounds.min.toArray(), ...bounds.max.toArray() ].every( Number.isFinite ) === false ) return buildFailure( 'invalid-bounds', null, 'Model bounds contain non-finite values.' );
	const size = bounds.getSize( new THREE.Vector3() );
	if ( size.toArray().some( ( value ) => value <= ENCLOSURE_BOUNDS_EPSILON ) ) return buildFailure( 'degenerate-bounds', bounds, 'Model bounds are degenerate.' );
	if ( validateEnclosureFaceGeometry( bounds ).ok === false ) return buildFailure( 'invalid-face-geometry', bounds, 'Invalid five-face enclosure geometry.' );

	let captures: Record<EnclosureFaceName, THREE.WebGLRenderTarget>;
	try {
		captures = captureCompleteModel( modelRoot, bounds, options );
	} catch ( error ) {
		return buildFailure( 'capture-failed', bounds, error instanceof Error ? error.message : String( error ) );
	}

	const root = new THREE.Group();
	root.name = '__textured-enclosure-shell';
	root.userData.__enclosureShell = true;
	root.userData.__excludeFromLayerIndex = true;
	for ( const face of createFaceDefinitions( bounds ) ) {
		const mesh = new THREE.Mesh( makeFaceGeometry( face.points, face.uvs ), new THREE.MeshBasicMaterial( { map: captures[ face.name ].texture, side: THREE.FrontSide, polygonOffset: true, polygonOffsetFactor: - 1, polygonOffsetUnits: - 1 } ) );
		mesh.name = `__enclosure-${face.name}`;
		mesh.userData.__enclosureShell = true;
		mesh.userData.__excludeFromLayerIndex = true;
		mesh.userData.enclosureFace = face.name;
		root.add( mesh );
	}

	modelRoot.add( root );
	return { ok: true, root, meshCount: root.children.length, bounds, renderableCount, renderTargets: Object.values( captures ) };

}

/** Pure geometry check; the asymmetric box catches accidental Y/Z swaps. */
export function runEnclosureFaceGeometrySelfCheck(): void {

	const bounds = new THREE.Box3( new THREE.Vector3( - 2, - 3, - 5 ), new THREE.Vector3( 7, 11, 13 ) );
	if ( validateEnclosureFaceGeometry( bounds ).ok === false ) throw new Error( 'Five-face enclosure geometry self-check failed.' );

}

export function validateEnclosureFaceGeometry(bounds: THREE.Box3): EnclosureGeometryValidation {

	const faces = createFaceDefinitions( bounds );
	const triangleCount = faces.reduce( ( total, face ) => total + faceTriangleCount( face.points ), 0 );
	const boundaryCornersConnected = hasConnectedBoundaryCorners( faces, bounds );
	return { ok: faces.every( validateFaceGeometry ) && triangleCount === 10 && boundaryCornersConnected, triangleCount, boundaryCornersConnected };

}

function captureCompleteModel(modelRoot: THREE.Object3D, bounds: THREE.Box3, options: EnclosureShellBuildOptions): Record<EnclosureFaceName, THREE.WebGLRenderTarget> {

	const scene = new THREE.Scene();
	if ( options.lightingScene !== undefined ) {
		options.lightingScene.traverse( ( object ) => {
			if ( object instanceof THREE.Light ) scene.add( object.clone() );
		} );
		scene.environment = options.lightingScene.environment;
	}
	const bakedModel = modelRoot.clone( true );
	bakedModel.position.set( 0, 0, 0 );
	bakedModel.quaternion.identity();
	bakedModel.scale.setScalar( 1 );
	bakedModel.traverse( ( object ) => {
		if ( object.userData.__nonSelectableHelper === true || object.userData.__excludeFromLayerIndex === true || object.userData.__visualizationHelper === true ) object.visible = false;
	} );
	scene.add( bakedModel );

	const targets = Object.fromEntries( faceNames.map( ( face ) => [ face, new THREE.WebGLRenderTarget( ENCLOSURE_CAPTURE_SIZE, ENCLOSURE_CAPTURE_SIZE, { depthBuffer: true } ) ] ) ) as Record<EnclosureFaceName, THREE.WebGLRenderTarget>;
	const previousTarget = options.renderer.getRenderTarget();
	const previousClearColor = options.renderer.getClearColor( new THREE.Color() ).clone();
	const previousClearAlpha = options.renderer.getClearAlpha();
	try {
		options.renderer.setClearColor( 0x000000, 0 );
		for ( const face of faceNames ) {
			options.renderer.setRenderTarget( targets[ face ] );
			options.renderer.clear();
			options.renderer.render( scene, createCaptureCamera( face, bounds ) );
		}
		return targets;
	} catch ( error ) {
		Object.values( targets ).forEach( ( target ) => target.dispose() );
		throw error;
	} finally {
		options.renderer.setRenderTarget( previousTarget );
		options.renderer.setClearColor( previousClearColor, previousClearAlpha );
	}

}

function createCaptureCamera(face: EnclosureFaceName, bounds: THREE.Box3): THREE.OrthographicCamera {

	const size = bounds.getSize( new THREE.Vector3() );
	const center = bounds.getCenter( new THREE.Vector3() );
	const margin = Math.max( size.length() * 0.01, 0.01 );
	const distance = size.length() + margin * 2;
	const horizontal = face === 'left' || face === 'right' ? size.z : size.x;
	const vertical = face === 'bottom' ? size.z : size.y;
	const camera = new THREE.OrthographicCamera( - horizontal / 2, horizontal / 2, vertical / 2, - vertical / 2, Math.max( margin * 0.01, 0.001 ), distance );
	if ( face === 'front' ) camera.position.set( center.x, center.y, bounds.min.z - margin );
	if ( face === 'back' ) camera.position.set( center.x, center.y, bounds.max.z + margin );
	if ( face === 'left' ) camera.position.set( bounds.min.x - margin, center.y, center.z );
	if ( face === 'right' ) camera.position.set( bounds.max.x + margin, center.y, center.z );
	if ( face === 'bottom' ) {
		camera.position.set( center.x, bounds.min.y - margin, center.z );
		camera.up.set( 0, 0, - 1 );
	}
	camera.lookAt( center );
	camera.updateProjectionMatrix();
	return camera;

}

function buildFailure(reason: EnclosureShellBuildFailureReason, bounds: THREE.Box3 | null, message: string): EnclosureShellBuildResult {

	return { ok: false, reason, bounds: bounds?.clone() ?? null, message };

}

function createFaceDefinitions(bounds: THREE.Box3): EnclosureFaceDefinition[] {

	const size = bounds.getSize( new THREE.Vector3() );
	return [ createFrontFace( bounds, size ), createBackFace( bounds, size ), createLeftFace( bounds, size ), createRightFace( bounds, size ), createBottomFace( bounds, size ) ];

}

function createFrontFace(bounds: THREE.Box3, size: THREE.Vector3): EnclosureFaceDefinition {

	const z = bounds.min.z;
	return { name: 'front', fixedAxis: 'z', fixedValue: z, expectedNormal: new THREE.Vector3( 0, 0, - 1 ), dimensions: new THREE.Vector2( size.x, size.y ), points: [ new THREE.Vector3( bounds.min.x, bounds.min.y, z ), new THREE.Vector3( bounds.min.x, bounds.max.y, z ), new THREE.Vector3( bounds.max.x, bounds.max.y, z ), new THREE.Vector3( bounds.max.x, bounds.min.y, z ) ], uvs: [ 1, 0, 1, 1, 0, 1, 0, 0 ] };

}

function createBackFace(bounds: THREE.Box3, size: THREE.Vector3): EnclosureFaceDefinition {

	const z = bounds.max.z;
	return { name: 'back', fixedAxis: 'z', fixedValue: z, expectedNormal: new THREE.Vector3( 0, 0, 1 ), dimensions: new THREE.Vector2( size.x, size.y ), points: [ new THREE.Vector3( bounds.min.x, bounds.min.y, z ), new THREE.Vector3( bounds.max.x, bounds.min.y, z ), new THREE.Vector3( bounds.max.x, bounds.max.y, z ), new THREE.Vector3( bounds.min.x, bounds.max.y, z ) ], uvs: [ 0, 0, 1, 0, 1, 1, 0, 1 ] };

}

function createLeftFace(bounds: THREE.Box3, size: THREE.Vector3): EnclosureFaceDefinition {

	const x = bounds.min.x;
	return { name: 'left', fixedAxis: 'x', fixedValue: x, expectedNormal: new THREE.Vector3( - 1, 0, 0 ), dimensions: new THREE.Vector2( size.z, size.y ), points: [ new THREE.Vector3( x, bounds.min.y, bounds.min.z ), new THREE.Vector3( x, bounds.min.y, bounds.max.z ), new THREE.Vector3( x, bounds.max.y, bounds.max.z ), new THREE.Vector3( x, bounds.max.y, bounds.min.z ) ], uvs: [ 0, 0, 1, 0, 1, 1, 0, 1 ] };

}

function createRightFace(bounds: THREE.Box3, size: THREE.Vector3): EnclosureFaceDefinition {

	const x = bounds.max.x;
	return { name: 'right', fixedAxis: 'x', fixedValue: x, expectedNormal: new THREE.Vector3( 1, 0, 0 ), dimensions: new THREE.Vector2( size.z, size.y ), points: [ new THREE.Vector3( x, bounds.min.y, bounds.min.z ), new THREE.Vector3( x, bounds.max.y, bounds.min.z ), new THREE.Vector3( x, bounds.max.y, bounds.max.z ), new THREE.Vector3( x, bounds.min.y, bounds.max.z ) ], uvs: [ 1, 0, 1, 1, 0, 1, 0, 0 ] };

}

function createBottomFace(bounds: THREE.Box3, size: THREE.Vector3): EnclosureFaceDefinition {

	const y = bounds.min.y;
	return { name: 'bottom', fixedAxis: 'y', fixedValue: y, expectedNormal: new THREE.Vector3( 0, - 1, 0 ), dimensions: new THREE.Vector2( size.x, size.z ), points: [ new THREE.Vector3( bounds.min.x, y, bounds.min.z ), new THREE.Vector3( bounds.max.x, y, bounds.min.z ), new THREE.Vector3( bounds.max.x, y, bounds.max.z ), new THREE.Vector3( bounds.min.x, y, bounds.max.z ) ], uvs: [ 1, 1, 0, 1, 0, 0, 1, 0 ] };

}

function validateFaceGeometry(face: EnclosureFaceDefinition): boolean {

	const geometry = makeFaceGeometry( face.points, face.uvs );
	const normal = geometry.getAttribute( 'normal' );
	const faceBounds = new THREE.Box3().setFromPoints( face.points );
	const averageNormal = new THREE.Vector3();
	for ( let index = 0; index < normal.count; index += 1 ) averageNormal.add( new THREE.Vector3().fromBufferAttribute( normal, index ) );
	averageNormal.normalize();
	const valid = face.points.every( ( point ) => Math.abs( point[ face.fixedAxis ] - face.fixedValue ) < 1e-6 ) && faceBounds.getSize( new THREE.Vector3() ).distanceTo( expectedFaceSize( face ) ) < 1e-6 && averageNormal.dot( face.expectedNormal ) > 0.99;
	geometry.dispose();
	return valid;

}

function expectedFaceSize(face: EnclosureFaceDefinition): THREE.Vector3 {

	if ( face.fixedAxis === 'x' ) return new THREE.Vector3( 0, face.dimensions.y, face.dimensions.x );
	if ( face.fixedAxis === 'y' ) return new THREE.Vector3( face.dimensions.x, 0, face.dimensions.y );
	return new THREE.Vector3( face.dimensions.x, face.dimensions.y, 0 );

}

function faceTriangleCount(points: THREE.Vector3[]): number {

	const geometry = makeFaceGeometry( points, [ 0, 0, 0, 1, 1, 1, 1, 0 ] );
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
	for ( const x of [ bounds.min.x, bounds.max.x ] ) for ( const y of [ bounds.min.y, bounds.max.y ] ) for ( const z of [ bounds.min.z, bounds.max.z ] ) if ( ( counts.get( [ x, y, z ].join( ',' ) ) ?? 0 ) !== ( y === bounds.min.y ? 3 : 2 ) ) return false;
	return true;

}

function countRenderableMeshes(root: THREE.Object3D): number {

	let count = 0;
	root.traverse( ( object ) => {
		if ( object instanceof THREE.Mesh && object.userData.__nonSelectableHelper !== true && object.userData.__excludeFromLayerIndex !== true && object.userData.__visualizationHelper !== true && object.userData.__enclosureShell !== true ) count += 1;
	} );
	return count;

}

function makeFaceGeometry(points: THREE.Vector3[], uvs: number[]): THREE.BufferGeometry {

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( points.flatMap( ( point ) => point.toArray() ), 3 ) );
	geometry.setIndex( [ 0, 1, 2, 0, 2, 3 ] );
	geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );
	geometry.computeVertexNormals();
	return geometry;

}

import * as THREE from 'three';

export type EnclosureFaceName = 'front' | 'back' | 'left' | 'right' | 'bottom';

export interface EnclosureMaterialSource {
	material: THREE.Material;
	source: string;
	metersPerUv: number;
}

interface Candidate extends EnclosureMaterialSource { area: number; }

const directions: Record<EnclosureFaceName, THREE.Vector3> = {
	front: new THREE.Vector3( 0, 0, - 1 ), back: new THREE.Vector3( 0, 0, 1 ),
	left: new THREE.Vector3( - 1, 0, 0 ), right: new THREE.Vector3( 1, 0, 0 ), bottom: new THREE.Vector3( 0, - 1, 0 )
};

export function resolveEnclosureMaterialSources(modelRoot: THREE.Object3D, bounds: THREE.Box3): Record<EnclosureFaceName, EnclosureMaterialSource> | null {

	const candidates = new Map<EnclosureFaceName, Candidate[]>();
	( Object.keys( directions ) as EnclosureFaceName[] ).forEach( ( face ) => candidates.set( face, [] ) );
	const tolerance = Math.max( 0.003, bounds.getSize( new THREE.Vector3() ).length() * 0.005 );
	const inverseRoot = modelRoot.matrixWorld.clone().invert();
	const relative = new THREE.Matrix4();
	const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), center = new THREE.Vector3(), normal = new THREE.Vector3();

	modelRoot.traverse( ( object ) => {
		if ( object instanceof THREE.Mesh === false || isHelper( object ) ) return;
		const position = object.geometry.getAttribute( 'position' );
		if ( position === undefined ) return;
		const index = object.geometry.getIndex();
		const uv = object.geometry.getAttribute( 'uv' );
		relative.multiplyMatrices( inverseRoot, object.matrixWorld );
		const triangleCount = index === null ? Math.floor( position.count / 3 ) : Math.floor( index.count / 3 );
		for ( let triangle = 0; triangle < triangleCount; triangle += 1 ) {
			const offset = triangle * 3;
			const ids = [ index === null ? offset : index.getX( offset ), index === null ? offset + 1 : index.getX( offset + 1 ), index === null ? offset + 2 : index.getX( offset + 2 ) ];
			a.fromBufferAttribute( position, ids[ 0 ] ).applyMatrix4( relative ); b.fromBufferAttribute( position, ids[ 1 ] ).applyMatrix4( relative ); c.fromBufferAttribute( position, ids[ 2 ] ).applyMatrix4( relative );
			normal.crossVectors( b.clone().sub( a ), c.clone().sub( a ) );
			const area = normal.length() / 2;
			if ( area < 1e-8 ) continue;
			normal.normalize(); center.addVectors( a, b ).add( c ).multiplyScalar( 1 / 3 );
			for ( const face of Object.keys( directions ) as EnclosureFaceName[] ) {
				if ( normal.dot( directions[ face ] ) < 0.45 || isNearFace( face, center, bounds, tolerance ) === false ) continue;
				const material = getTriangleMaterial( object, offset );
				if ( material === null ) continue;
				candidates.get( face )!.push( { material, area, metersPerUv: estimateMetersPerUv( a, b, c, uv, ids ), source: `${object.name || object.uuid}:${getMaterialIndex( object.geometry, offset )}` } );
			}
		}
	} );

	const fallback = largestMaterial( modelRoot );
	if ( fallback === null ) return null;
	const pick = ( face: EnclosureFaceName ): EnclosureMaterialSource => candidates.get( face )!.sort( ( a, b ) => b.area - a.area )[ 0 ] ?? { material: fallback, source: 'model-fallback', metersPerUv: 1 };
	return { front: pick( 'front' ), back: pick( 'back' ), left: pick( 'left' ), right: pick( 'right' ), bottom: pick( 'bottom' ) };

}

export function cloneEnclosureMaterial(source: EnclosureMaterialSource): THREE.Material {

	const material = source.material.clone();
	material.side = THREE.FrontSide;
	material.polygonOffset = true;
	material.polygonOffsetFactor = - 1;
	material.polygonOffsetUnits = - 1;
	const textured = material as THREE.Material & { map?: THREE.Texture };
	if ( textured.map != null ) {
		textured.map = textured.map.clone();
		textured.map.wrapS = THREE.RepeatWrapping;
		textured.map.wrapT = THREE.RepeatWrapping;
		textured.map.userData.__enclosureOwnedTexture = true;
		textured.map.needsUpdate = true;
	}
	material.needsUpdate = true;
	return material;

}

function isNearFace(face: EnclosureFaceName, point: THREE.Vector3, bounds: THREE.Box3, tolerance: number): boolean {
	if ( face === 'front' ) return Math.abs( point.z - bounds.min.z ) <= tolerance;
	if ( face === 'back' ) return Math.abs( point.z - bounds.max.z ) <= tolerance;
	if ( face === 'left' ) return Math.abs( point.x - bounds.min.x ) <= tolerance;
	if ( face === 'right' ) return Math.abs( point.x - bounds.max.x ) <= tolerance;
	return Math.abs( point.y - bounds.min.y ) <= tolerance;
}

function estimateMetersPerUv(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, uv: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined, ids: number[]): number {
	if ( uv === undefined ) return 1;
	const points = [ a, b, c ]; const pairs = [ [ 0, 1 ], [ 1, 2 ], [ 2, 0 ] ];
	let meters = 0; let units = 0;
	for ( const [ from, to ] of pairs ) {
		const du = uv.getX( ids[ from ] ) - uv.getX( ids[ to ] ); const dv = uv.getY( ids[ from ] ) - uv.getY( ids[ to ] ); const length = Math.hypot( du, dv );
		if ( length > 1e-5 ) { meters += points[ from ].distanceTo( points[ to ] ); units += length; }
	}
	return units > 0 ? Math.max( meters / units, 0.001 ) : 1;
}

function getTriangleMaterial(mesh: THREE.Mesh, offset: number): THREE.Material | null {
	const materials = Array.isArray( mesh.material ) ? mesh.material : [ mesh.material ];
	return materials[ getMaterialIndex( mesh.geometry, offset ) ] ?? materials[ 0 ] ?? null;
}

function getMaterialIndex(geometry: THREE.BufferGeometry, offset: number): number {
	return geometry.groups.find( ( group ) => offset >= group.start && offset < group.start + group.count )?.materialIndex ?? 0;
}

function largestMaterial(root: THREE.Object3D): THREE.Material | null {
	let result: THREE.Material | null = null;
	root.traverse( ( object ) => { if ( result === null && object instanceof THREE.Mesh && isHelper( object ) === false ) result = Array.isArray( object.material ) ? object.material[ 0 ] ?? null : object.material; } );
	return result;
}

function isHelper(object: THREE.Object3D): boolean { return object.userData.__visualizationHelper === true || object.userData.__enclosureShell === true; }

import * as THREE from 'three';

export type BoundarySurfaceName = 'front' | 'back' | 'left' | 'right' | 'bottom';

export interface ResolvedBoundarySurface {
	face: BoundarySurfaceName;
	sourceMeshes: THREE.Mesh[];
	geometry: THREE.BufferGeometry;
	materials: THREE.Material[];
	triangleCount: number;
	debug: BoundarySurfaceDebugCounts;
}

export interface BoundarySurfaceDebugCounts {
	candidateTriangleCount: number;
	acceptedTriangleCount: number;
	rejectedByNormalCount: number;
	rejectedByPositionCount: number;
}

export type BoundarySurfaceResolveResult = {
	ok: true;
	surfaces: ResolvedBoundarySurface[];
	bounds: THREE.Box3;
	epsilon: number;
} | {
	ok: false;
	reason: 'empty-model' | 'required-boundary-surface-missing' | 'invalid-boundary-surface';
	message: string;
	missingFaces?: BoundarySurfaceName[];
	invalidFaces?: BoundarySurfaceName[];
};

interface SurfaceTriangle {
	positions: [ THREE.Vector3, THREE.Vector3, THREE.Vector3 ];
	normals: [ THREE.Vector3, THREE.Vector3, THREE.Vector3 ];
	uvs: [ THREE.Vector2, THREE.Vector2, THREE.Vector2 ] | null;
	colors: [ THREE.Color, THREE.Color, THREE.Color ] | null;
	material: THREE.Material;
	sourceMesh: THREE.Mesh;
	center: THREE.Vector3;
	averageNormal: THREE.Vector3;
	explicitFace: BoundarySurfaceName | null;
}

const faceNames: BoundarySurfaceName[] = [ 'front', 'back', 'left', 'right', 'bottom' ];

export function resolveModelBoundarySurfaces(modelRoot: THREE.Object3D): BoundarySurfaceResolveResult {

	modelRoot.updateWorldMatrix( true, true );
	const sourceMeshes = listBoundarySurfaceSourceMeshes( modelRoot );
	if ( sourceMeshes.length === 0 ) return { ok: false, reason: 'empty-model', message: 'Model has no eligible boundary surface meshes.' };
	if ( import.meta.env.DEV ) console.info( '[ModelSurfaceCandidates]', { meshes: sourceMeshes.map( describeSourceMesh ) } );

	const inverseRoot = modelRoot.matrixWorld.clone().invert();
	const triangles = sourceMeshes.flatMap( ( mesh ) => collectMeshTriangles( mesh, inverseRoot ) );
	const bounds = new THREE.Box3().setFromPoints( triangles.flatMap( ( triangle ) => triangle.positions ) );
	if ( triangles.length === 0 || bounds.isEmpty() ) return { ok: false, reason: 'empty-model', message: 'Eligible model meshes have no triangles.' };
	const epsilon = Math.max( bounds.getSize( new THREE.Vector3() ).length() * 1e-5, 1e-5 );
	const center = bounds.getCenter( new THREE.Vector3() );
	triangles.forEach( ( triangle ) => orientTriangleOutward( triangle, center ) );

	const hasExplicitFaces = faceNames.every( ( face ) => triangles.some( ( triangle ) => triangle.explicitFace === face ) );
	const resolved = new Map<BoundarySurfaceName, SurfaceTriangle[]>();
	const debug = new Map<BoundarySurfaceName, BoundarySurfaceDebugCounts>();
	faceNames.forEach( ( face ) => {
		resolved.set( face, [] );
		debug.set( face, { candidateTriangleCount: 0, acceptedTriangleCount: 0, rejectedByNormalCount: 0, rejectedByPositionCount: 0 } );
	} );
	for ( const triangle of triangles ) {
		const classification = hasExplicitFaces
			? { face: triangle.explicitFace, rejectedByNormal: false, rejectedByPosition: false }
			: classifyExposedTriangle( triangle, triangles, bounds, epsilon );
		if ( classification.face === null ) continue;
		const counts = debug.get( classification.face )!;
		counts.candidateTriangleCount += 1;
		if ( classification.rejectedByNormal ) counts.rejectedByNormalCount += 1;
		if ( classification.rejectedByPosition ) counts.rejectedByPositionCount += 1;
		if ( classification.rejectedByNormal || classification.rejectedByPosition ) continue;
		orientTriangleForFace( triangle, classification.face );
		resolved.get( classification.face )!.push( triangle );
		counts.acceptedTriangleCount += 1;
	}
	const missing = faceNames.filter( ( face ) => resolved.get( face )!.length === 0 );
	if ( missing.length > 0 ) return { ok: false, reason: 'required-boundary-surface-missing', missingFaces: missing, message: `Could not resolve required boundary surfaces: ${missing.join( ', ' )}.` };
	const invalid = faceNames.filter( ( face ) => isValidSurfaceTriangles( resolved.get( face )! ) === false );
	if ( invalid.length > 0 ) return { ok: false, reason: 'invalid-boundary-surface', invalidFaces: invalid, message: `Resolved boundary surfaces are invalid: ${invalid.join( ', ' )}.` };
	return {
		ok: true,
		bounds,
		epsilon,
		surfaces: faceNames.map( ( face ) => createResolvedSurface( face, resolved.get( face )!, epsilon, debug.get( face )! ) )
	};

}

export function isBoundarySurfaceSourceMesh(object: THREE.Object3D): object is THREE.Mesh {

	const name = object.name.toLowerCase();
	return object instanceof THREE.Mesh
		&& object.visible !== false
		&& object.userData.__nonSelectableHelper !== true
		&& object.userData.__visualizationHelper !== true
		&& object.userData.__enclosureShell !== true
		&& object.userData.__modelConformingShell !== true
		&& object.userData.__excludeFromBoundarySurface !== true
		&& object.userData.__sectionCap !== true
		&& object.userData.__annotationItem === undefined
		&& name.includes( 'marker' ) === false
		&& name.includes( 'annotation' ) === false
		&& name.includes( 'debug' ) === false
		&& name.includes( 'picking' ) === false
		&& name.includes( 'selection' ) === false
		&& name.includes( 'measure' ) === false;

}

function listBoundarySurfaceSourceMeshes(root: THREE.Object3D): THREE.Mesh[] {

	const meshes: THREE.Mesh[] = [];
	root.traverse( ( object ) => { if ( isBoundarySurfaceSourceMesh( object ) ) meshes.push( object ); } );
	return meshes;

}

function describeSourceMesh(mesh: THREE.Mesh): Record<string, unknown> {

	mesh.geometry.computeBoundingBox();
	const normals = mesh.geometry.getAttribute( 'normal' );
	const averageNormal = new THREE.Vector3();
	if ( normals !== undefined ) for ( let index = 0; index < normals.count; index += 1 ) averageNormal.add( new THREE.Vector3().fromBufferAttribute( normals, index ) );
	if ( averageNormal.lengthSq() > 0 ) averageNormal.normalize();
	const materials = Array.isArray( mesh.material ) ? mesh.material : [ mesh.material ];
	return {
		name: mesh.name,
		parentName: mesh.parent?.name ?? '',
		materialName: materials.map( ( material ) => material.name ).join( '|' ),
		layerId: mesh.userData.__layerId ?? null,
		triangleCount: ( mesh.geometry.getIndex()?.count ?? mesh.geometry.getAttribute( 'position' ).count ) / 3,
		localBounds: mesh.geometry.boundingBox === null ? null : { min: mesh.geometry.boundingBox.min.toArray(), max: mesh.geometry.boundingBox.max.toArray() },
		averageNormal: averageNormal.toArray(),
		hasUv: mesh.geometry.getAttribute( 'uv' ) !== undefined,
		hasMap: materials.some( ( material ) => ( material as THREE.Material & { map?: THREE.Texture | null } ).map !== null && ( material as THREE.Material & { map?: THREE.Texture | null } ).map !== undefined )
	};

}

function collectMeshTriangles(mesh: THREE.Mesh, inverseRoot: THREE.Matrix4): SurfaceTriangle[] {

	const geometry = mesh.geometry;
	const position = geometry.getAttribute( 'position' );
	if ( position === undefined ) return [];
	const normal = geometry.getAttribute( 'normal' );
	const uv = geometry.getAttribute( 'uv' );
	const color = geometry.getAttribute( 'color' );
	const index = geometry.getIndex();
	const meshToRoot = new THREE.Matrix4().multiplyMatrices( inverseRoot, mesh.matrixWorld );
	const normalMatrix = new THREE.Matrix3().getNormalMatrix( meshToRoot );
	const materials = Array.isArray( mesh.material ) ? mesh.material : [ mesh.material ];
	const triangleCount = ( index?.count ?? position.count ) / 3;
	const explicitFace = normalizeBoundarySurfaceName( mesh.userData.boundarySurfaceFace );
	const triangles: SurfaceTriangle[] = [];
	for ( let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1 ) {
		const offset = triangleIndex * 3;
		const indices = [ index === null ? offset : index.getX( offset ), index === null ? offset + 1 : index.getX( offset + 1 ), index === null ? offset + 2 : index.getX( offset + 2 ) ];
		const positions = indices.map( ( vertexIndex ) => new THREE.Vector3().fromBufferAttribute( position, vertexIndex ).applyMatrix4( meshToRoot ) ) as SurfaceTriangle['positions'];
		const faceNormal = new THREE.Vector3().crossVectors( positions[ 1 ].clone().sub( positions[ 0 ] ), positions[ 2 ].clone().sub( positions[ 0 ] ) ).normalize();
		if ( faceNormal.lengthSq() === 0 ) continue;
		const normals = indices.map( ( vertexIndex ) => normal === undefined ? faceNormal.clone() : new THREE.Vector3().fromBufferAttribute( normal, vertexIndex ).applyMatrix3( normalMatrix ).normalize() ) as SurfaceTriangle['normals'];
		const averageNormal = normals.reduce( ( sum, value ) => sum.add( value ), new THREE.Vector3() ).normalize();
		const materialIndex = geometry.groups.find( ( group ) => offset >= group.start && offset < group.start + group.count )?.materialIndex ?? 0;
		triangles.push( {
			positions,
			normals,
			uvs: uv === undefined ? null : indices.map( ( vertexIndex ) => new THREE.Vector2( uv.getX( vertexIndex ), uv.getY( vertexIndex ) ) ) as SurfaceTriangle['uvs'],
			colors: color === undefined ? null : indices.map( ( vertexIndex ) => new THREE.Color().fromBufferAttribute( color, vertexIndex ) ) as SurfaceTriangle['colors'],
			material: materials[ materialIndex ] ?? materials[ 0 ],
			sourceMesh: mesh,
			center: positions[ 0 ].clone().add( positions[ 1 ] ).add( positions[ 2 ] ).multiplyScalar( 1 / 3 ),
			averageNormal,
			explicitFace
		} );
	}
	return triangles;

}

function orientTriangleOutward(triangle: SurfaceTriangle, modelCenter: THREE.Vector3): void {

	if ( triangle.averageNormal.dot( triangle.center.clone().sub( modelCenter ) ) >= 0 ) return;
	triangle.averageNormal.negate();
	triangle.normals.forEach( ( normal ) => normal.negate() );

}

function classifyExposedTriangle(triangle: SurfaceTriangle, allTriangles: SurfaceTriangle[], bounds: THREE.Box3, epsilon: number): { face: BoundarySurfaceName | null; rejectedByNormal: boolean; rejectedByPosition: boolean } {

	if ( isOccludedAlongOutwardNormal( triangle, allTriangles, epsilon ) ) return { face: null, rejectedByNormal: false, rejectedByPosition: false };
	const normal = triangle.averageNormal;
	const horizontal = Math.max( Math.abs( normal.x ), Math.abs( normal.z ) );
	if ( normal.y < - 0.5 && - normal.y >= horizontal ) return { face: 'bottom', rejectedByNormal: false, rejectedByPosition: false };
	if ( normal.y > 0.5 && normal.y > horizontal ) return { face: null, rejectedByNormal: false, rejectedByPosition: false };
	const directions: Record<Exclude<BoundarySurfaceName, 'bottom'>, THREE.Vector3> = {
		front: new THREE.Vector3( 0, 0, - 1 ), back: new THREE.Vector3( 0, 0, 1 ), left: new THREE.Vector3( - 1, 0, 0 ), right: new THREE.Vector3( 1, 0, 0 )
	};
	const horizontalFaces: readonly Exclude<BoundarySurfaceName, 'bottom'>[] = [ 'front', 'back', 'left', 'right' ];
	let face: Exclude<BoundarySurfaceName, 'bottom'> = 'front';
	for ( const candidate of horizontalFaces ) if ( normal.dot( directions[ candidate ] ) > normal.dot( directions[ face ] ) ) face = candidate;
	if ( normal.dot( directions[ face ] ) <= 0 ) return { face, rejectedByNormal: true, rejectedByPosition: false };
	const size = bounds.getSize( new THREE.Vector3() );
	const positionScore = face === 'right' ? ( triangle.center.x - bounds.min.x ) / Math.max( size.x, epsilon )
		: face === 'left' ? ( bounds.max.x - triangle.center.x ) / Math.max( size.x, epsilon )
			: face === 'back' ? ( triangle.center.z - bounds.min.z ) / Math.max( size.z, epsilon )
				: ( bounds.max.z - triangle.center.z ) / Math.max( size.z, epsilon );
	return { face, rejectedByNormal: false, rejectedByPosition: positionScore < 0.5 };

}

function orientTriangleForFace(triangle: SurfaceTriangle, face: BoundarySurfaceName): void {

	const expected = face === 'front' ? new THREE.Vector3( 0, 0, - 1 ) : face === 'back' ? new THREE.Vector3( 0, 0, 1 ) : face === 'left' ? new THREE.Vector3( - 1, 0, 0 ) : face === 'right' ? new THREE.Vector3( 1, 0, 0 ) : new THREE.Vector3( 0, - 1, 0 );
	const geometricNormal = new THREE.Vector3().crossVectors( triangle.positions[ 1 ].clone().sub( triangle.positions[ 0 ] ), triangle.positions[ 2 ].clone().sub( triangle.positions[ 0 ] ) ).normalize();
	if ( geometricNormal.dot( expected ) < 0 ) {
		[ triangle.positions[ 1 ], triangle.positions[ 2 ] ] = [ triangle.positions[ 2 ], triangle.positions[ 1 ] ];
		[ triangle.normals[ 1 ], triangle.normals[ 2 ] ] = [ triangle.normals[ 2 ], triangle.normals[ 1 ] ];
		if ( triangle.uvs !== null ) [ triangle.uvs[ 1 ], triangle.uvs[ 2 ] ] = [ triangle.uvs[ 2 ], triangle.uvs[ 1 ] ];
		if ( triangle.colors !== null ) [ triangle.colors[ 1 ], triangle.colors[ 2 ] ] = [ triangle.colors[ 2 ], triangle.colors[ 1 ] ];
		geometricNormal.negate();
	}
	triangle.normals.forEach( ( normal ) => { if ( normal.dot( geometricNormal ) < 0 ) normal.negate(); } );
	triangle.averageNormal.copy( geometricNormal );

}

function isValidSurfaceTriangles(triangles: SurfaceTriangle[]): boolean {

	return triangles.length > 0 && triangles.every( ( triangle ) => triangle.positions.every( ( position ) => Number.isFinite( position.x ) && Number.isFinite( position.y ) && Number.isFinite( position.z ) ) );

}

function isOccludedAlongOutwardNormal(triangle: SurfaceTriangle, allTriangles: SurfaceTriangle[], epsilon: number): boolean {

	const ray = new THREE.Ray( triangle.center.clone().addScaledVector( triangle.averageNormal, epsilon * 2 ), triangle.averageNormal );
	const hit = new THREE.Vector3();
	const maxDistance = 1e6;
	for ( const other of allTriangles ) {
		if ( other === triangle ) continue;
		if ( ray.intersectTriangle( other.positions[ 0 ], other.positions[ 1 ], other.positions[ 2 ], false, hit ) !== null && hit.distanceTo( ray.origin ) > epsilon && hit.distanceTo( ray.origin ) < maxDistance ) return true;
	}
	return false;

}

function createResolvedSurface(face: BoundarySurfaceName, triangles: SurfaceTriangle[], epsilon: number, debug: BoundarySurfaceDebugCounts): ResolvedBoundarySurface {

	const materials: THREE.Material[] = [];
	const sourceMeshes: THREE.Mesh[] = [];
	const grouped = new Map<THREE.Material, SurfaceTriangle[]>();
	for ( const triangle of triangles ) {
		if ( sourceMeshes.includes( triangle.sourceMesh ) === false ) sourceMeshes.push( triangle.sourceMesh );
		const byMaterial = grouped.get( triangle.material ) ?? [];
		byMaterial.push( triangle );
		grouped.set( triangle.material, byMaterial );
	}
	const positions: number[] = [];
	const normals: number[] = [];
	const uvs: number[] = [];
	const colors: number[] = [];
	const geometry = new THREE.BufferGeometry();
	for ( const [ material, materialTriangles ] of grouped ) {
		const materialIndex = materials.push( material ) - 1;
		const start = positions.length / 3;
		for ( const triangle of materialTriangles ) for ( let index = 0; index < 3; index += 1 ) {
			const normal = triangle.normals[ index ].lengthSq() === 0 ? triangle.averageNormal : triangle.normals[ index ];
			const position = triangle.positions[ index ].clone().addScaledVector( normal, epsilon );
			positions.push( position.x, position.y, position.z );
			normals.push( normal.x, normal.y, normal.z );
			uvs.push( triangle.uvs?.[ index ].x ?? 0, triangle.uvs?.[ index ].y ?? 0 );
			colors.push( triangle.colors?.[ index ].r ?? 1, triangle.colors?.[ index ].g ?? 1, triangle.colors?.[ index ].b ?? 1 );
		}
		geometry.addGroup( start, positions.length / 3 - start, materialIndex );
	}
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );
	geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );
	geometry.setAttribute( 'color', new THREE.Float32BufferAttribute( colors, 3 ) );
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
	return { face, sourceMeshes, geometry, materials, triangleCount: positions.length / 9, debug };

}

function normalizeBoundarySurfaceName(value: unknown): BoundarySurfaceName | null {

	return faceNames.includes( value as BoundarySurfaceName ) ? value as BoundarySurfaceName : null;

}

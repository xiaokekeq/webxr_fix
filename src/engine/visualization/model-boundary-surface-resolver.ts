import * as THREE from 'three';

export interface ResolvedConformingSurface {
	sourceMeshes: THREE.Mesh[];
	geometry: THREE.BufferGeometry;
	materials: THREE.Material[];
	triangleCount: number;
	excludedTopTriangleCount: number;
}

export type ConformingSurfaceResolveResult = {
	ok: true;
	surface: ResolvedConformingSurface;
	bounds: THREE.Box3;
	epsilon: number;
} | {
	ok: false;
	reason: 'empty-model' | 'no-exposed-surface' | 'invalid-surface';
	message: string;
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
}

export function resolveModelConformingSurface(modelRoot: THREE.Object3D): ConformingSurfaceResolveResult {

	modelRoot.updateWorldMatrix( true, true );
	const sourceMeshes = listConformingSurfaceSourceMeshes( modelRoot );
	if ( sourceMeshes.length === 0 ) return { ok: false, reason: 'empty-model', message: 'Model has no eligible conforming surface meshes.' };

	const inverseRoot = modelRoot.matrixWorld.clone().invert();
	const triangles = sourceMeshes.flatMap( ( mesh ) => collectMeshTriangles( mesh, inverseRoot ) );
	const bounds = new THREE.Box3().setFromPoints( triangles.flatMap( ( triangle ) => triangle.positions ) );
	if ( triangles.length === 0 || bounds.isEmpty() ) return { ok: false, reason: 'empty-model', message: 'Eligible model meshes have no triangles.' };
	const epsilon = Math.max( bounds.getSize( new THREE.Vector3() ).length() * 1e-5, 1e-5 );
	const center = bounds.getCenter( new THREE.Vector3() );
	triangles.forEach( ( triangle ) => orientTriangleOutward( triangle, center ) );

	const exposedTriangles = triangles.filter( ( triangle ) => isExposedTriangle( triangle, triangles, epsilon ) );
	if ( exposedTriangles.length === 0 ) return { ok: false, reason: 'no-exposed-surface', message: 'Model has no exposed boundary triangles.' };
	const shellTriangles = exposedTriangles.filter( ( triangle ) => isTopFacingTriangle( triangle ) === false );
	if ( shellTriangles.length === 0 ) return { ok: false, reason: 'no-exposed-surface', message: 'All exposed triangles were classified as top-facing.' };

	const surface = createResolvedConformingSurface( shellTriangles, epsilon, exposedTriangles.length - shellTriangles.length );
	if ( isValidSurface( surface ) === false ) {
		surface.geometry.dispose();
		return { ok: false, reason: 'invalid-surface', message: 'Resolved conforming surface geometry is invalid.' };
	}
	return { ok: true, surface, bounds, epsilon };

}

export function isConformingSurfaceSourceMesh(object: THREE.Object3D): object is THREE.Mesh {

	const name = object.name.toLowerCase();
	return object instanceof THREE.Mesh
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

function listConformingSurfaceSourceMeshes(root: THREE.Object3D): THREE.Mesh[] {

	const meshes: THREE.Mesh[] = [];
	root.traverse( ( object ) => { if ( isConformingSurfaceSourceMesh( object ) ) meshes.push( object ); } );
	return meshes;

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
	const triangleCount = Math.floor( ( index?.count ?? position.count ) / 3 );
	const triangles: SurfaceTriangle[] = [];
	for ( let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1 ) {
		const offset = triangleIndex * 3;
		const indices = [ index === null ? offset : index.getX( offset ), index === null ? offset + 1 : index.getX( offset + 1 ), index === null ? offset + 2 : index.getX( offset + 2 ) ];
		const positions = indices.map( ( vertexIndex ) => new THREE.Vector3().fromBufferAttribute( position, vertexIndex ).applyMatrix4( meshToRoot ) ) as SurfaceTriangle['positions'];
		const faceNormal = new THREE.Vector3().crossVectors( positions[ 1 ].clone().sub( positions[ 0 ] ), positions[ 2 ].clone().sub( positions[ 0 ] ) ).normalize();
		if ( faceNormal.lengthSq() === 0 ) continue;
		const normals = indices.map( ( vertexIndex ) => normal === undefined ? faceNormal.clone() : new THREE.Vector3().fromBufferAttribute( normal, vertexIndex ).applyMatrix3( normalMatrix ).normalize() ) as SurfaceTriangle['normals'];
		const materialIndex = geometry.groups.find( ( group ) => offset >= group.start && offset < group.start + group.count )?.materialIndex ?? 0;
		const triangle: SurfaceTriangle = {
			positions,
			normals,
			uvs: uv === undefined ? null : indices.map( ( vertexIndex ) => new THREE.Vector2( uv.getX( vertexIndex ), uv.getY( vertexIndex ) ) ) as SurfaceTriangle['uvs'],
			colors: color === undefined ? null : indices.map( ( vertexIndex ) => new THREE.Color().fromBufferAttribute( color, vertexIndex ) ) as SurfaceTriangle['colors'],
			material: materials[ materialIndex ] ?? materials[ 0 ],
			sourceMesh: mesh,
			center: new THREE.Vector3(),
			averageNormal: new THREE.Vector3()
		};
		refreshTriangleMetrics( triangle );
		triangles.push( triangle );
	}
	return triangles;

}

function orientTriangleOutward(triangle: SurfaceTriangle, modelCenter: THREE.Vector3): void {

	if ( triangle.averageNormal.dot( triangle.center.clone().sub( modelCenter ) ) < 0 ) reverseTriangleWinding( triangle );

}

function reverseTriangleWinding(triangle: SurfaceTriangle): void {

	[ triangle.positions[ 1 ], triangle.positions[ 2 ] ] = [ triangle.positions[ 2 ], triangle.positions[ 1 ] ];
	[ triangle.normals[ 1 ], triangle.normals[ 2 ] ] = [ triangle.normals[ 2 ], triangle.normals[ 1 ] ];
	if ( triangle.uvs !== null ) [ triangle.uvs[ 1 ], triangle.uvs[ 2 ] ] = [ triangle.uvs[ 2 ], triangle.uvs[ 1 ] ];
	if ( triangle.colors !== null ) [ triangle.colors[ 1 ], triangle.colors[ 2 ] ] = [ triangle.colors[ 2 ], triangle.colors[ 1 ] ];
	triangle.normals.forEach( ( normal ) => normal.negate() );
	refreshTriangleMetrics( triangle );

}

function refreshTriangleMetrics(triangle: SurfaceTriangle): void {

	triangle.center.copy( triangle.positions[ 0 ] ).add( triangle.positions[ 1 ] ).add( triangle.positions[ 2 ] ).multiplyScalar( 1 / 3 );
	triangle.averageNormal.copy( triangle.normals[ 0 ] ).add( triangle.normals[ 1 ] ).add( triangle.normals[ 2 ] ).normalize();

}

function isExposedTriangle(triangle: SurfaceTriangle, allTriangles: readonly SurfaceTriangle[], epsilon: number): boolean {

	return isOccludedAlongOutwardNormal( triangle, allTriangles, epsilon ) === false;

}

function isTopFacingTriangle(triangle: SurfaceTriangle): boolean {

	const normal = triangle.averageNormal;
	const horizontalDominance = Math.max( Math.abs( normal.x ), Math.abs( normal.z ) );
	return normal.y > 0.5 && normal.y > horizontalDominance;

}

function isOccludedAlongOutwardNormal(triangle: SurfaceTriangle, allTriangles: readonly SurfaceTriangle[], epsilon: number): boolean {

	const ray = new THREE.Ray( triangle.center.clone().addScaledVector( triangle.averageNormal, epsilon * 2 ), triangle.averageNormal );
	const hit = new THREE.Vector3();
	for ( const other of allTriangles ) {
		if ( other === triangle ) continue;
		if ( ray.intersectTriangle( other.positions[ 0 ], other.positions[ 1 ], other.positions[ 2 ], false, hit ) !== null && hit.distanceTo( ray.origin ) > epsilon ) return true;
	}
	return false;

}

function createResolvedConformingSurface(triangles: SurfaceTriangle[], epsilon: number, excludedTopTriangleCount: number): ResolvedConformingSurface {

	const materials: THREE.Material[] = [];
	const sourceMeshes: THREE.Mesh[] = [];
	const grouped = new Map<THREE.Material, SurfaceTriangle[]>();
	for ( const triangle of triangles ) {
		if ( sourceMeshes.includes( triangle.sourceMesh ) === false ) sourceMeshes.push( triangle.sourceMesh );
		const materialTriangles = grouped.get( triangle.material ) ?? [];
		materialTriangles.push( triangle );
		grouped.set( triangle.material, materialTriangles );
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
	return { sourceMeshes, geometry, materials, triangleCount: positions.length / 9, excludedTopTriangleCount };

}

function isValidSurface(surface: ResolvedConformingSurface): boolean {

	const position = surface.geometry.getAttribute( 'position' );
	const normal = surface.geometry.getAttribute( 'normal' );
	return position !== undefined && position.count >= 3 && normal !== undefined && normal.count === position.count
		&& Array.from( position.array ).every( Number.isFinite ) && Array.from( normal.array ).every( Number.isFinite )
		&& surface.geometry.boundingBox !== null && surface.geometry.boundingBox.isEmpty() === false
		&& surface.geometry.boundingSphere !== null && Number.isFinite( surface.geometry.boundingSphere.radius );

}

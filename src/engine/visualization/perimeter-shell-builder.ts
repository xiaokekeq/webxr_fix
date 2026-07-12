import * as THREE from 'three';

export interface PerimeterShellBuildResult {
	root: THREE.Group;
	meshCount: number;
	triangleCount: number;
	materialCount: number;
}

// Keeps only near-vertical triangles on the projected outer bounds. This is built
// once from the complete template; layer visibility never mutates it.
export function buildPerimeterShell(modelRoot: THREE.Object3D, surfaceUpNormal: THREE.Vector3): PerimeterShellBuildResult {

	modelRoot.updateWorldMatrix( true, true );
	const up = surfaceUpNormal.clone().normalize();
	const tangent = new THREE.Vector3( 1, 0, 0 ).addScaledVector( up, - up.x ).normalize();
	if ( tangent.lengthSq() < 1e-6 ) tangent.set( 0, 0, 1 ).addScaledVector( up, - up.z ).normalize();
	const bitangent = new THREE.Vector3().crossVectors( up, tangent );
	const bounds = { minU: Infinity, maxU: - Infinity, minV: Infinity, maxV: - Infinity };
	modelRoot.traverse( ( object ) => {
		if ( object instanceof THREE.Mesh === false || object.userData.__visualizationHelper === true ) return;
		const position = object.geometry.getAttribute( 'position' );
		if ( position === undefined ) return;
		const vertex = new THREE.Vector3();
		for ( let i = 0; i < position.count; i += 1 ) {
			vertex.fromBufferAttribute( position, i ).applyMatrix4( object.matrixWorld );
			const u = vertex.dot( tangent ); const v = vertex.dot( bitangent );
			bounds.minU = Math.min( bounds.minU, u ); bounds.maxU = Math.max( bounds.maxU, u );
			bounds.minV = Math.min( bounds.minV, v ); bounds.maxV = Math.max( bounds.maxV, v );
		}
	} );
	const tolerance = Math.max( 0.003, Math.max( bounds.maxU - bounds.minU, bounds.maxV - bounds.minV ) * 0.01 );
	const root = new THREE.Group();
	root.name = '__perimeter-shell';
	root.userData.__perimeterShell = true;
	root.userData.__excludeFromLayerIndex = true;
	let triangleCount = 0;
	const materials = new Set<THREE.Material>();
	modelRoot.traverse( ( object ) => {
		if ( object instanceof THREE.Mesh === false || object.userData.__visualizationHelper === true ) return;
		const position = object.geometry.getAttribute( 'position' );
		if ( position === undefined ) return;
		const index = object.geometry.getIndex(); const normal = object.geometry.getAttribute( 'normal' ); const uv = object.geometry.getAttribute( 'uv' );
		const out: number[] = []; const outNormals: number[] = []; const outUvs: number[] = [];
		const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), center = new THREE.Vector3();
		const normalMatrix = new THREE.Matrix3().getNormalMatrix( object.matrixWorld );
		const count = index === null ? Math.floor( position.count / 3 ) : Math.floor( index.count / 3 );
		for ( let t = 0; t < count; t += 1 ) {
			const ids = [ index === null ? t * 3 : index.getX( t * 3 ), index === null ? t * 3 + 1 : index.getX( t * 3 + 1 ), index === null ? t * 3 + 2 : index.getX( t * 3 + 2 ) ];
			a.fromBufferAttribute( position, ids[ 0 ] ).applyMatrix4( object.matrixWorld ); b.fromBufferAttribute( position, ids[ 1 ] ).applyMatrix4( object.matrixWorld ); c.fromBufferAttribute( position, ids[ 2 ] ).applyMatrix4( object.matrixWorld );
			n.crossVectors( b.clone().sub( a ), c.clone().sub( a ) ).normalize(); center.addVectors( a, b ).add( c ).multiplyScalar( 1 / 3 );
			const nearEdge = Math.min( Math.abs( center.dot( tangent ) - bounds.minU ), Math.abs( center.dot( tangent ) - bounds.maxU ), Math.abs( center.dot( bitangent ) - bounds.minV ), Math.abs( center.dot( bitangent ) - bounds.maxV ) ) <= tolerance;
			if ( Math.abs( n.dot( up ) ) > 0.35 || nearEdge === false ) continue;
			for ( const id of ids ) { const p = new THREE.Vector3().fromBufferAttribute( position, id ); out.push( p.x, p.y, p.z ); if ( normal !== undefined ) { const q = new THREE.Vector3().fromBufferAttribute( normal, id ).applyMatrix3( normalMatrix ).normalize(); outNormals.push( q.x, q.y, q.z ); } if ( uv !== undefined ) outUvs.push( uv.getX( id ), uv.getY( id ) ); }
			triangleCount += 1;
		}
		if ( out.length === 0 ) return;
		const geometry = new THREE.BufferGeometry(); geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( out, 3 ) ); if ( outNormals.length > 0 ) geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( outNormals, 3 ) ); else geometry.computeVertexNormals(); if ( outUvs.length > 0 ) geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( outUvs, 2 ) );
		const source = Array.isArray( object.material ) ? object.material[ 0 ] : object.material; const material = source.clone(); material.polygonOffset = true; material.polygonOffsetFactor = - 1; material.polygonOffsetUnits = - 1; material.needsUpdate = true; materials.add( material );
		const shell = new THREE.Mesh( geometry, material ); shell.userData.__perimeterShell = true; shell.userData.__excludeFromLayerIndex = true; root.add( shell );
	} );
	modelRoot.add( root );
	return { root, meshCount: root.children.length, triangleCount, materialCount: materials.size };
}

import * as THREE from 'three';

export interface PortalElevationRange {
	minSignedHeightMeters: number;
	maxSignedHeightMeters: number;
	minDepthMeters: number;
	maxDepthMeters: number;
	depthRangeMeters: number;
	valid: boolean;
}

export function getPortalElevationRange(root: THREE.Object3D, center: THREE.Vector3, normal: THREE.Vector3): PortalElevationRange {

	let minSignedHeightMeters = Infinity;
	let maxSignedHeightMeters = -Infinity;
	root.traverseVisible( ( object ) => {
		if ( object instanceof THREE.Mesh === false ) return;
		const geometry = object.geometry;
		geometry.computeBoundingBox();
		const box = geometry.boundingBox;
		if ( box === null ) return;
		for ( const x of [ box.min.x, box.max.x ] ) for ( const y of [ box.min.y, box.max.y ] ) for ( const z of [ box.min.z, box.max.z ] ) {
			const signedHeight = new THREE.Vector3( x, y, z ).applyMatrix4( object.matrixWorld ).sub( center ).dot( normal );
			minSignedHeightMeters = Math.min( minSignedHeightMeters, signedHeight );
			maxSignedHeightMeters = Math.max( maxSignedHeightMeters, signedHeight );
		}
	} );
	if ( Number.isFinite( minSignedHeightMeters ) === false ) return { minSignedHeightMeters: 0, maxSignedHeightMeters: 0, minDepthMeters: 0, maxDepthMeters: 0, depthRangeMeters: 0, valid: false };
	const minDepthMeters = Math.max( 0, -maxSignedHeightMeters );
	const maxDepthMeters = Math.max( 0, -minSignedHeightMeters );
	return { minSignedHeightMeters, maxSignedHeightMeters, minDepthMeters, maxDepthMeters, depthRangeMeters: maxDepthMeters - minDepthMeters, valid: true };

}

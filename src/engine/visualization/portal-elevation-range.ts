import * as THREE from 'three';

export interface PortalElevationRange {
	minSignedHeightMeters: number;
	maxSignedHeightMeters: number;
	minDepthMeters: number;
	maxDepthMeters: number;
	depthRangeMeters: number;
	sampleCount: number;
	aboveSurfaceSampleCount: number;
	belowSurfaceSampleCount: number;
	onSurfaceSampleCount: number;
	valid: boolean;
}

export function getPortalElevationRange(root: THREE.Object3D, portalPlaneCenter: THREE.Vector3, surfaceUpNormal: THREE.Vector3): PortalElevationRange {

	let minSignedHeightMeters = Infinity;
	let maxSignedHeightMeters = -Infinity;
	let sampleCount = 0, aboveSurfaceSampleCount = 0, belowSurfaceSampleCount = 0, onSurfaceSampleCount = 0;
	root.traverseVisible( ( object ) => {
		if ( object instanceof THREE.Mesh === false ) return;
		const geometry = object.geometry;
		geometry.computeBoundingBox();
		const box = geometry.boundingBox;
		if ( box === null ) return;
		for ( const x of [ box.min.x, box.max.x ] ) for ( const y of [ box.min.y, box.max.y ] ) for ( const z of [ box.min.z, box.max.z ] ) {
			const signedHeight = new THREE.Vector3( x, y, z ).applyMatrix4( object.matrixWorld ).sub( portalPlaneCenter ).dot( surfaceUpNormal );
			minSignedHeightMeters = Math.min( minSignedHeightMeters, signedHeight );
			maxSignedHeightMeters = Math.max( maxSignedHeightMeters, signedHeight );
			sampleCount += 1;
			if ( signedHeight > 0.001 ) aboveSurfaceSampleCount += 1;
			else if ( signedHeight < -0.001 ) belowSurfaceSampleCount += 1;
			else onSurfaceSampleCount += 1;
		}
	} );
	if ( Number.isFinite( minSignedHeightMeters ) === false ) return { minSignedHeightMeters: 0, maxSignedHeightMeters: 0, minDepthMeters: 0, maxDepthMeters: 0, depthRangeMeters: 0, sampleCount: 0, aboveSurfaceSampleCount: 0, belowSurfaceSampleCount: 0, onSurfaceSampleCount: 0, valid: false };
	const minDepthMeters = Math.max( 0, -maxSignedHeightMeters );
	const maxDepthMeters = Math.max( 0, -minSignedHeightMeters );
	return { minSignedHeightMeters, maxSignedHeightMeters, minDepthMeters, maxDepthMeters, depthRangeMeters: maxDepthMeters - minDepthMeters, sampleCount, aboveSurfaceSampleCount, belowSurfaceSampleCount, onSurfaceSampleCount, valid: true };

}

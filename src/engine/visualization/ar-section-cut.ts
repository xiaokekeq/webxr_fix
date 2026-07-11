import * as THREE from 'three';
import type { SectionCutPlaneMode } from '@/localization/core/registration-store.js';

export const SECTION_CUT_SEMANTICS = 'open-clipping' as const;

export interface ArSectionCutController {
	setPlaneMode(mode: SectionCutPlaneMode): void;
	apply(modelRoot: THREE.Object3D | null, value: number): THREE.Plane | null;
	restore(): void;
	dispose(): void;
}

const worldBounds = new THREE.Box3();
const localBounds = new THREE.Box3();
const geometryBounds = new THREE.Box3();
const boundsCorner = new THREE.Vector3();
const boundsSize = new THREE.Vector3();
const worldNormal = new THREE.Vector3();
const worldPoint = new THREE.Vector3();
const worldQuaternion = new THREE.Quaternion();
const inverseRootMatrixWorld = new THREE.Matrix4();
const relativeMatrix = new THREE.Matrix4();

export function createArSectionCutController(renderer: THREE.WebGLRenderer): ArSectionCutController {

	const plane = new THREE.Plane();
	let planeMode: SectionCutPlaneMode = 'horizontal-section';

	function apply(modelRoot: THREE.Object3D | null, value: number): THREE.Plane | null {

		if ( modelRoot === null ) {
			renderer.localClippingEnabled = false;
			return null;
		}
		modelRoot.updateWorldMatrix( true, true );
		worldBounds.setFromObject( modelRoot );
		resolveModelLocalBounds( modelRoot );
		const axis = resolvePlaneAxis( planeMode );
		worldNormal.set( 0, 0, 0 ).setComponent( axisToIndex( axis ), -1 )
			.applyQuaternion( modelRoot.getWorldQuaternion( worldQuaternion ) ).normalize();
		const range = resolveProjectedBoundsRange( worldNormal );
		worldPoint.copy( worldNormal ).multiplyScalar( THREE.MathUtils.lerp( range.min, range.max, THREE.MathUtils.clamp( value, 0, 100 ) / 100 ) );
		plane.setFromNormalAndCoplanarPoint( worldNormal, worldPoint );
		renderer.localClippingEnabled = true;
		return plane;

	}

	function restore(): void { renderer.localClippingEnabled = false; }

	return {
		setPlaneMode(mode) { planeMode = mode; },
		apply,
		restore,
		dispose: restore
	};

}

function resolveModelLocalBounds(modelRoot: THREE.Object3D): void {

	localBounds.makeEmpty();
	inverseRootMatrixWorld.copy( modelRoot.matrixWorld ).invert();
	modelRoot.traverse( ( child ) => {
		if ( child instanceof THREE.Mesh === false || child.userData.__visualizationHelper === true || child.userData.__nonSelectableHelper === true || child.userData.__excludeFromLayerIndex === true ) return;
		if ( child.geometry.boundingBox === null ) child.geometry.computeBoundingBox();
		if ( child.geometry.boundingBox === null ) return;
		relativeMatrix.multiplyMatrices( inverseRootMatrixWorld, child.matrixWorld );
		geometryBounds.copy( child.geometry.boundingBox ).applyMatrix4( relativeMatrix );
		localBounds.union( geometryBounds );
	} );

}

function resolvePlaneAxis(mode: SectionCutPlaneMode): 'x' | 'y' | 'z' {

	localBounds.getSize( boundsSize );
	const mainAxis = boundsSize.x >= boundsSize.z ? 'x' : 'z';
	if ( mode === 'horizontal-section' ) return 'y';
	return mode === 'cross-section' ? mainAxis : mainAxis === 'x' ? 'z' : 'x';

}

function resolveProjectedBoundsRange(normal: THREE.Vector3): { min: number; max: number } {

	let min = Infinity;
	let max = -Infinity;
	for ( const x of [ worldBounds.min.x, worldBounds.max.x ] ) for ( const y of [ worldBounds.min.y, worldBounds.max.y ] ) for ( const z of [ worldBounds.min.z, worldBounds.max.z ] ) {
		const projection = normal.dot( boundsCorner.set( x, y, z ) );
		min = Math.min( min, projection );
		max = Math.max( max, projection );
	}
	return Number.isFinite( min ) && Number.isFinite( max ) ? { min, max } : { min: 0, max: 0 };

}

function axisToIndex(axis: 'x' | 'y' | 'z'): 0 | 1 | 2 {

	return axis === 'x' ? 0 : axis === 'y' ? 1 : 2;

}

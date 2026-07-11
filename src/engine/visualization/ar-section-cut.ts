import * as THREE from 'three';
import type { SectionCutPlaneMode } from '@/localization/core/registration-store.js';

export const SECTION_CUT_SEMANTICS = 'open-clipping' as const;

export interface ArSectionCutController {
	setPlaneMode(mode: SectionCutPlaneMode): void;
	apply(modelRoot: THREE.Object3D | null, value: number): THREE.Plane | null;
	markBoundsDirty(): void;
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
	const matrixValues = new Float32Array( 16 );
	let planeMode: SectionCutPlaneMode = 'horizontal-section';
	let diagnosticsMode: SectionCutPlaneMode | null = null;
	let cachedRoot: THREE.Object3D | null = null;
	let boundsDirty = true;

	function apply(modelRoot: THREE.Object3D | null, value: number): THREE.Plane | null {

		if ( modelRoot === null ) {
			renderer.localClippingEnabled = false;
			return null;
		}
		modelRoot.updateWorldMatrix( true, true );
		const matrixChanged = copyChangedMatrix( modelRoot.matrixWorld.elements, matrixValues );
		if ( cachedRoot !== modelRoot || boundsDirty || matrixChanged ) {
			cachedRoot = modelRoot;
			resolveModelLocalBounds( modelRoot );
			worldBounds.copy( localBounds ).applyMatrix4( modelRoot.matrixWorld );
			boundsDirty = false;
		}
		const axis = resolvePlaneAxis( planeMode );
		worldNormal.set( 0, 0, 0 ).setComponent( axisToIndex( axis ), -1 )
			.applyQuaternion( modelRoot.getWorldQuaternion( worldQuaternion ) ).normalize();
		const range = resolveProjectedBoundsRange( worldNormal );
		const extent = Math.max( 0, range.max - range.min );
		const padding = Math.max( 0.01, extent * 0.01 );
		const hiddenEndpoint = range.max + padding;
		const visibleEndpoint = range.min - padding;
		if ( import.meta.env.DEV && diagnosticsMode !== planeMode ) {
			diagnosticsMode = planeMode;
			const hiddenCornerCountAt0 = countCorners( worldNormal, hiddenEndpoint, false );
			const visibleCornerCountAt100 = countCorners( worldNormal, visibleEndpoint, true );
			console.info( '[SectionEndpointDiagnostic]', { planeMode, range, padding, hiddenEndpoint, visibleEndpoint, hiddenCornerCountAt0, visibleCornerCountAt100 } );
			console.assert( hiddenCornerCountAt0 === 8, 'Section value 0 must clip every bounds corner.' );
			console.assert( visibleCornerCountAt100 === 8, 'Section value 100 must retain every bounds corner.' );
		}
		worldPoint.copy( worldNormal ).multiplyScalar( mapSectionRevealValue( value, hiddenEndpoint, visibleEndpoint ) );
		plane.setFromNormalAndCoplanarPoint( worldNormal, worldPoint );
		renderer.localClippingEnabled = true;
		return plane;

	}

	function restore(): void { renderer.localClippingEnabled = false; }
	function markBoundsDirty(): void { boundsDirty = true; diagnosticsMode = null; }

	return {
		setPlaneMode(mode) { planeMode = mode; },
		apply,
		markBoundsDirty,
		restore,
		dispose() {
			restore();
			cachedRoot = null;
			boundsDirty = true;
			diagnosticsMode = null;
			matrixValues.fill( Number.NaN );
		}
	};

}

function countCorners(normal: THREE.Vector3, planePosition: number, countVisible: boolean): number {
	let count = 0;
	for ( const x of [ worldBounds.min.x, worldBounds.max.x ] ) for ( const y of [ worldBounds.min.y, worldBounds.max.y ] ) for ( const z of [ worldBounds.min.z, worldBounds.max.z ] ) {
		const visible = normal.dot( boundsCorner.set( x, y, z ) ) - planePosition >= 0;
		if ( visible === countVisible ) count += 1;
	}
	return count;
}

function mapSectionRevealValue(value: number, hiddenEndpoint: number, visibleEndpoint: number): number {
	return THREE.MathUtils.lerp( hiddenEndpoint, visibleEndpoint, THREE.MathUtils.clamp( value, 0, 100 ) / 100 );
}

function copyChangedMatrix(elements: ArrayLike<number>, previous: Float32Array): boolean {

	let changed = false;
	for ( let index = 0; index < 16; index += 1 ) {
		const value = Math.fround( elements[ index ] );
		if ( previous[ index ] !== value ) changed = true;
		previous[ index ] = value;
	}
	return changed;

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

import * as THREE from 'three';
import type { SectionCutPlaneMode } from '@/localization/core/registration-store.js';

export interface ArSectionCutApplyResult {
	value: number;
	planeMode: SectionCutPlaneMode;
	axis: 'x' | 'y' | 'z';
	affectedMeshCount: number;
	affectedMaterialCount: number;
	cutPosition: number;
	axisMin: number;
	axisMax: number;
	meaning: string;
	plane: THREE.Plane | null;
}

export interface ArSectionCutController {
	setPlaneMode(mode: SectionCutPlaneMode): void;
	apply(modelRoot: THREE.Object3D | null, value: number): ArSectionCutApplyResult;
	restore(): void;
	dispose(): void;
}

const tempBounds = new THREE.Box3();
const tempLocalBounds = new THREE.Box3();
const tempGeometryBounds = new THREE.Box3();
const tempWorldBoundsCorner = new THREE.Vector3();
const tempBoundsSize = new THREE.Vector3();
const tempPlaneNormal = new THREE.Vector3();
const tempWorldQuaternion = new THREE.Quaternion();
const tempInverseRootMatrixWorld = new THREE.Matrix4();
const tempRelativeMatrix = new THREE.Matrix4();

export function createArSectionCutController(renderer: THREE.WebGLRenderer): ArSectionCutController {

	let currentPlaneMode: SectionCutPlaneMode = 'horizontal-section';

	function setPlaneMode(mode: SectionCutPlaneMode): void {

		currentPlaneMode = mode;

	}

	function apply(modelRoot: THREE.Object3D | null, value: number): ArSectionCutApplyResult {

		const nextValue = THREE.MathUtils.clamp( Math.round( value ), 0, 100 );
		if ( modelRoot === null ) {
			renderer.localClippingEnabled = false;
			return {
				value: nextValue,
				planeMode: currentPlaneMode,
				axis: 'y',
				affectedMeshCount: 0,
				affectedMaterialCount: 0,
				cutPosition: 0,
				axisMin: 0,
				axisMax: 0,
				meaning: 'move cutting plane to inspect section'
				,plane: null
			};
		}

		tempBounds.setFromObject( modelRoot );
		const localBounds = resolveModelLocalBounds( modelRoot );
		const axis = resolvePlaneAxis( localBounds, currentPlaneMode );
		const axisMin = localBounds.min[ axis ];
		const axisMax = localBounds.max[ axis ];
		const cutPosition = THREE.MathUtils.lerp( axisMin, axisMax, nextValue / 100 );
		const plane = createWorldSectionPlane( modelRoot, tempBounds, axis, nextValue / 100 );

		renderer.localClippingEnabled = true;
		let affectedMeshCount = 0;
		let affectedMaterialCount = 0;

		modelRoot.traverse( ( child ) => {
			if ( child instanceof THREE.Mesh === false || shouldProcessSectionCutMesh( child ) === false ) {
				return;
			}

			affectedMeshCount += 1;

		} );

		return {
			value: nextValue,
			planeMode: currentPlaneMode,
			axis,
			affectedMeshCount,
			affectedMaterialCount,
			cutPosition,
			axisMin,
			axisMax,
			meaning: 'move cutting plane to inspect section',
			plane
		};

	}

	function restore(): void {

		renderer.localClippingEnabled = false;

	}

	function dispose(): void {

		restore();

	}

	return {
		setPlaneMode,
		apply,
		restore,
		dispose
	};

}

function createWorldSectionPlane(
	modelRoot: THREE.Object3D,
	worldBounds: THREE.Box3,
	axis: 'x' | 'y' | 'z',
	valueRatio: number
): THREE.Plane {

	modelRoot.updateWorldMatrix( true, true );
	const worldNormal = tempPlaneNormal
		.set( 0, 0, 0 )
		.setComponent( axisToIndex( axis ), -1 )
		.applyQuaternion( modelRoot.getWorldQuaternion( tempWorldQuaternion ) )
		.normalize();
	const projectedRange = resolveProjectedBoundsRange( worldBounds, worldNormal );
	const cutDistance = THREE.MathUtils.lerp( projectedRange.min, projectedRange.max, valueRatio );
	const worldPoint = worldNormal.clone().multiplyScalar( cutDistance );

	return new THREE.Plane().setFromNormalAndCoplanarPoint( worldNormal, worldPoint );

}

function resolveProjectedBoundsRange(
	bounds: THREE.Box3,
	normal: THREE.Vector3
): { min: number; max: number } {

	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;

	for ( const x of [ bounds.min.x, bounds.max.x ] ) {
		for ( const y of [ bounds.min.y, bounds.max.y ] ) {
			for ( const z of [ bounds.min.z, bounds.max.z ] ) {
				const projection = normal.dot( tempWorldBoundsCorner.set( x, y, z ) );
				if ( projection < min ) {
					min = projection;
				}
				if ( projection > max ) {
					max = projection;
				}
			}
		}
	}

	if ( Number.isFinite( min ) === false || Number.isFinite( max ) === false ) {
		return { min: 0, max: 0 };
	}

	return { min, max };

}

function resolveModelLocalBounds(modelRoot: THREE.Object3D): THREE.Box3 {

	modelRoot.updateWorldMatrix( true, true );
	tempLocalBounds.makeEmpty();
	tempInverseRootMatrixWorld.copy( modelRoot.matrixWorld ).invert();

	modelRoot.traverse( ( child ) => {
		if ( child instanceof THREE.Mesh === false || shouldProcessSectionCutMesh( child ) === false ) {
			return;
		}

		const geometry = child.geometry;
		if ( geometry.boundingBox === null ) {
			geometry.computeBoundingBox();
		}

		if ( geometry.boundingBox === null ) {
			return;
		}

		tempRelativeMatrix.multiplyMatrices( tempInverseRootMatrixWorld, child.matrixWorld );
		tempGeometryBounds.copy( geometry.boundingBox ).applyMatrix4( tempRelativeMatrix );
		tempLocalBounds.union( tempGeometryBounds );
	} );

	return tempLocalBounds;

}

function resolvePlaneAxis(bounds: THREE.Box3, planeMode: SectionCutPlaneMode): 'x' | 'y' | 'z' {

	bounds.getSize( tempBoundsSize );
	const mainAxis = tempBoundsSize.x >= tempBoundsSize.z ? 'x' : 'z';
	const secondaryAxis = mainAxis === 'x' ? 'z' : 'x';

	switch ( planeMode ) {
		case 'horizontal-section':
			return 'y';
		case 'cross-section':
			return mainAxis;
		case 'longitudinal-section':
			return secondaryAxis;
		default:
			return mainAxis;
	}

}

function axisToIndex(axis: 'x' | 'y' | 'z'): 0 | 1 | 2 {

	switch ( axis ) {
		case 'x':
			return 0;
		case 'y':
			return 1;
		default:
			return 2;
	}

}

function shouldProcessSectionCutMesh(mesh: THREE.Mesh): boolean {

	return mesh.userData.__visualizationHelper !== true
		&& mesh.userData.__nonSelectableHelper !== true
		&& mesh.userData.__excludeFromLayerIndex !== true;

}




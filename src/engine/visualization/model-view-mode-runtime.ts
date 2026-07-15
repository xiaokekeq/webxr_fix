import * as THREE from 'three';
import type { ModelViewConfig, ModelViewMode } from '@/models/config/demo-model-config.js';

export type CameraHeightOffsetFailureReason =
	| 'missing-model'
	| 'empty-bounds'
	| 'invalid-bounds'
	| 'invalid-config';

export const DEFAULT_CAMERA_HEIGHT_OFFSET = {
	heightFactor: 1,
	additionalHeightMeters: 0,
	minimumOffsetMeters: 0.5,
	maximumOffsetMeters: 30
} as const;

const worldUp = new THREE.Vector3( 0, 1, 0 );
const boundsCorner = new THREE.Vector3();

export function resolveDefaultModelViewMode(config: ModelViewConfig): ModelViewMode {

	if ( config.defaultViewMode !== undefined ) return config.defaultViewMode;
	return config.spatialType === 'underground' ? 'elevated-camera-offset' : 'registered-ar';

}

export class ModelViewModeRuntime {

	constructor(private readonly presentationRoot: THREE.Object3D) {}

	reset(): void {

		this.presentationRoot.matrix.identity();
		this.presentationRoot.matrixAutoUpdate = false;
		this.presentationRoot.matrixWorldNeedsUpdate = true;

	}

	apply(model: THREE.Object3D | null, config: ModelViewConfig): CameraHeightOffsetFailureReason | null {

		this.reset();
		if ( resolveDefaultModelViewMode( config ) === 'registered-ar' ) return null;
		if ( model === null ) return 'missing-model';
		if ( config.invalidCameraHeightOffset === true ) return 'invalid-config';

		const verticalExtent = computeVerticalExtent( model );
		if ( verticalExtent === 'invalid-bounds' ) return 'invalid-bounds';
		const heightOffset = resolveHeightOffset( verticalExtent, config.cameraHeightOffset );
		if ( heightOffset === null ) return 'invalid-config';
		if ( heightOffset === undefined ) return 'empty-bounds';

		// Raising a virtual camera while preserving the XR camera orientation
		// is equivalent to translating only the model presentation layer
		// by the opposite world-space vertical offset.
		this.presentationRoot.matrix.makeTranslation( 0, - heightOffset, 0 );
		this.presentationRoot.matrixWorldNeedsUpdate = true;
		return null;

	}

}

function resolveHeightOffset(
	verticalExtent: number | undefined,
	config: ModelViewConfig['cameraHeightOffset']
): number | null | undefined {

	if ( verticalExtent === undefined ) return undefined;
	const heightFactor = config?.heightFactor ?? DEFAULT_CAMERA_HEIGHT_OFFSET.heightFactor;
	const additionalHeightMeters = config?.additionalHeightMeters ?? DEFAULT_CAMERA_HEIGHT_OFFSET.additionalHeightMeters;
	const minimumOffsetMeters = config?.minimumOffsetMeters ?? DEFAULT_CAMERA_HEIGHT_OFFSET.minimumOffsetMeters;
	const maximumOffsetMeters = config?.maximumOffsetMeters ?? DEFAULT_CAMERA_HEIGHT_OFFSET.maximumOffsetMeters;
	if (
		[ heightFactor, additionalHeightMeters, minimumOffsetMeters, maximumOffsetMeters ].every( Number.isFinite ) === false
		|| minimumOffsetMeters < 0
		|| maximumOffsetMeters < minimumOffsetMeters
	) return null;

	const offset = THREE.MathUtils.clamp(
		verticalExtent * heightFactor + additionalHeightMeters,
		minimumOffsetMeters,
		maximumOffsetMeters
	);
	return Number.isFinite( offset ) ? offset : null;

}

function computeVerticalExtent(model: THREE.Object3D): number | 'invalid-bounds' | undefined {

	model.updateWorldMatrix( true, true );
	let minimum = Infinity;
	let maximum = - Infinity;
	let hasGeometry = false;
	let invalidBounds = false;
	model.traverse( ( object ) => {
		if ( object instanceof THREE.Mesh === false || isExcludedFromExtent( object ) ) return;
		if ( object.geometry.boundingBox === null ) object.geometry.computeBoundingBox();
		const bounds = object.geometry.boundingBox;
		if ( bounds === null || bounds.isEmpty() ) return;
		for ( const x of [ bounds.min.x, bounds.max.x ] ) for ( const y of [ bounds.min.y, bounds.max.y ] ) for ( const z of [ bounds.min.z, bounds.max.z ] ) {
			const projection = worldUp.dot( boundsCorner.set( x, y, z ).applyMatrix4( object.matrixWorld ) );
			if ( Number.isFinite( projection ) === false ) {
				invalidBounds = true;
				return;
			}
			minimum = Math.min( minimum, projection );
			maximum = Math.max( maximum, projection );
			hasGeometry = true;
		}
	} );
	if ( invalidBounds ) return 'invalid-bounds';
	return hasGeometry && Number.isFinite( minimum ) && Number.isFinite( maximum ) ? maximum - minimum : undefined;

}

function isExcludedFromExtent(object: THREE.Object3D): boolean {

	let current: THREE.Object3D | null = object;
	while ( current !== null ) {
		if (
			current.userData.__visualizationHelper === true
			|| current.userData.__enclosureShell === true
			|| current.userData.__nonSelectableHelper === true
			|| current.name === '__section-cap'
		) return true;
		current = current.parent;
	}
	return false;

}

import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { arWarn } from '@/engine/debug/ar-logger.js';
import type { XrTrackingStatus } from '@/features/ar/types/runtime-types.js';

export type ModelTransformCommitReason =
	| 'initial-placement'
	| 'marker-confirmed'
	| 'engineering-registration-confirmed'
	| 'manual-calibration-confirmed'
	| 'explicit-reset';

export type ModelPlacementPhase = 'ready' | 'placed' | 'tracking-lost' | 'disposed';

export interface ModelTransformCommit {
	matrix: THREE.Matrix4;
	reason: ModelTransformCommitReason;
	source: string;
	confirmed: boolean;
	timestamp?: number;
}

export interface ModelTransformAuditEntry {
	reason: ModelTransformCommitReason;
	timestamp: number;
	source: string;
	matrix: readonly number[];
	previousMatrix?: readonly number[];
	translationDeltaMeters: number;
	rotationDeltaDegrees: number;
}

export interface ModelTransformGuardOptions {
	maxAbsoluteTranslationMeters: number;
	maxAutomaticTranslationMeters: number;
	maxAutomaticRotationDegrees: number;
}

export class ModelTransformValidationError extends Error {

	constructor(readonly reason: string) {

		super( reason );
		this.name = 'ModelTransformValidationError';

	}

}

const DEFAULT_GUARD: ModelTransformGuardOptions = {
	maxAbsoluteTranslationMeters: 10_000,
	maxAutomaticTranslationMeters: 1,
	maxAutomaticRotationDegrees: 10
};
const AUDIT_LIMIT = 20;
const MIN_SCALE = 1e-8;
const MIN_DETERMINANT = 1e-10;
const position = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();
const previousPosition = new THREE.Vector3();
const previousQuaternion = new THREE.Quaternion();
const previousScale = new THREE.Vector3();

export class ModelTransformRuntime {

	private readonly committedModelMatrix = new THREE.Matrix4();
	private readonly audit: ModelTransformAuditEntry[] = [];
	private readonly guard: ModelTransformGuardOptions;
	private hasCommittedModelMatrix = false;
	private phase: ModelPlacementPhase = 'ready';

	constructor(guard: Partial<ModelTransformGuardOptions> = {}) {

		this.guard = { ...DEFAULT_GUARD, ...guard };

	}

	commitModelTransform(args: {
		modelTemplate: THREE.Group;
		currentModel: THREE.Group | null;
		parent: THREE.Group;
		commit: ModelTransformCommit;
	}): THREE.Group {

		if ( this.phase === 'disposed' ) {
			throw new ModelTransformValidationError( 'model-transform-runtime-disposed' );
		}

		const { commit } = args;
		validateModelTransform( commit.matrix, this.guard );
		const delta = this.hasCommittedModelMatrix
			? measureTransformDelta( this.committedModelMatrix, commit.matrix )
			: { translationMeters: 0, rotationDegrees: 0 };
		if ( commit.confirmed === false ) {
			const isJump = delta.translationMeters > this.guard.maxAutomaticTranslationMeters
				|| delta.rotationDegrees > this.guard.maxAutomaticRotationDegrees;
			const reason = isJump
				? `automatic-transform-jump:${delta.translationMeters.toFixed( 3 )}m/${delta.rotationDegrees.toFixed( 2 )}deg`
				: 'unconfirmed-transform-commit';
			arWarn( '[model-transform-guard]', { reason, source: commit.source } );
			throw new ModelTransformValidationError( reason );
		}

		const previousMatrix = this.hasCommittedModelMatrix
			? this.committedModelMatrix.elements.slice()
			: undefined;
		const model = args.currentModel ?? clone( args.modelTemplate ) as THREE.Group;
		if ( args.currentModel === null ) args.parent.add( model );
		model.matrixAutoUpdate = false;
		model.matrix.copy( commit.matrix );
		model.matrix.decompose( model.position, model.quaternion, model.scale );
		model.updateMatrixWorld( true );
		this.committedModelMatrix.copy( commit.matrix );
		this.hasCommittedModelMatrix = true;
		this.phase = 'placed';

		const entry: ModelTransformAuditEntry = {
			reason: commit.reason,
			timestamp: commit.timestamp ?? Date.now(),
			source: commit.source,
			matrix: commit.matrix.elements.slice(),
			previousMatrix,
			translationDeltaMeters: delta.translationMeters,
			rotationDeltaDegrees: delta.rotationDegrees
		};
		this.audit.push( entry );
		if ( this.audit.length > AUDIT_LIMIT ) this.audit.splice( 0, this.audit.length - AUDIT_LIMIT );
		if ( import.meta.env.DEV ) console.info( '[model-transform-commit]', entry );

		return model;

	}

	setTrackingStatus(status: XrTrackingStatus): void {

		if ( this.phase === 'disposed' ) return;
		if ( status === 'normal' ) {
			if ( this.phase === 'tracking-lost' ) this.phase = this.hasCommittedModelMatrix ? 'placed' : 'ready';
			return;
		}
		if ( this.hasCommittedModelMatrix ) this.phase = 'tracking-lost';

	}

	reset(): void {

		if ( this.phase === 'disposed' ) return;
		this.hasCommittedModelMatrix = false;
		this.committedModelMatrix.identity();
		this.phase = 'ready';

	}

	dispose(): void {

		this.reset();
		this.phase = 'disposed';

	}

	getPhase(): ModelPlacementPhase {

		return this.phase;

	}

	getCommittedModelMatrix(target = new THREE.Matrix4()): THREE.Matrix4 | null {

		return this.hasCommittedModelMatrix ? target.copy( this.committedModelMatrix ) : null;

	}

	getAudit(): readonly ModelTransformAuditEntry[] {

		return this.audit.map( ( entry ) => ( {
			...entry,
			matrix: [ ...entry.matrix ],
			previousMatrix: entry.previousMatrix === undefined ? undefined : [ ...entry.previousMatrix ]
		} ) );

	}

}

export function validateModelTransform(
	matrix: THREE.Matrix4,
	guard: ModelTransformGuardOptions = DEFAULT_GUARD
): void {

	if ( matrix.elements.every( Number.isFinite ) === false ) {
		throw new ModelTransformValidationError( 'matrix-not-finite' );
	}
	const determinant = matrix.determinant();
	if ( Number.isFinite( determinant ) === false || Math.abs( determinant ) <= MIN_DETERMINANT ) {
		throw new ModelTransformValidationError( 'matrix-singular' );
	}
	matrix.decompose( position, quaternion, scale );
	if (
		[ position.x, position.y, position.z, quaternion.x, quaternion.y, quaternion.z, quaternion.w, scale.x, scale.y, scale.z ].every( Number.isFinite ) === false
	) {
		throw new ModelTransformValidationError( 'matrix-decomposition-not-finite' );
	}
	if ( Math.min( Math.abs( scale.x ), Math.abs( scale.y ), Math.abs( scale.z ) ) <= MIN_SCALE ) {
		throw new ModelTransformValidationError( 'matrix-scale-zero' );
	}
	if ( position.length() > guard.maxAbsoluteTranslationMeters ) {
		throw new ModelTransformValidationError( 'matrix-translation-out-of-range' );
	}

}

export function correctUpsideDownModelMatrix(
	matrix: THREE.Matrix4,
	target = new THREE.Matrix4()
): THREE.Matrix4 {

	matrix.decompose( position, quaternion, scale );
	const up = new THREE.Vector3( 0, 1, 0 ).applyQuaternion( quaternion ).normalize();
	if ( up.y >= 0 ) return target.copy( matrix );
	const correction = new THREE.Quaternion().setFromUnitVectors( up, new THREE.Vector3( 0, 1, 0 ) );
	return target.compose( position, correction.multiply( quaternion ), scale );

}

function measureTransformDelta(previous: THREE.Matrix4, next: THREE.Matrix4): {
	translationMeters: number;
	rotationDegrees: number;
} {

	previous.decompose( previousPosition, previousQuaternion, previousScale );
	next.decompose( position, quaternion, scale );
	return {
		translationMeters: previousPosition.distanceTo( position ),
		rotationDegrees: THREE.MathUtils.radToDeg( previousQuaternion.angleTo( quaternion ) )
	};

}

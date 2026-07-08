import * as THREE from 'three';
import type { DemoModelConfig } from '@/models/config/demo-model-config.js';
import type { EngineeringControlPoint } from '@/localization/coarse/engineering-registration.js';
import type { VisualControlTarget } from '@/features/ar/types/workflow.js';

export const EXPECTED_CORNER_ORDER = [ 'leftTop', 'rightTop', 'rightBottom', 'leftBottom' ] as const;

export type CornerPointLike = THREE.Vector3 | [ number, number, number ] | { x: number; y: number; z: number };

export function computeSideLengths(points: CornerPointLike[]): number[] {
	const vectors = points.map( toVector3 );
	if ( vectors.length !== 4 ) {
		return [];
	}
	return vectors.map( ( point, index ) => point.distanceTo( vectors[ ( index + 1 ) % 4 ] ) );
}

export function computeDiagonalLengths(points: CornerPointLike[]): number[] {
	const vectors = points.map( toVector3 );
	if ( vectors.length !== 4 ) {
		return [];
	}
	return [
		vectors[ 0 ].distanceTo( vectors[ 2 ] ),
		vectors[ 1 ].distanceTo( vectors[ 3 ] )
	];
}

export function computeQuadDiagnostics(points: CornerPointLike[]): {
	sideLengths: number[];
	diagonalLengths: number[];
	area: number;
	warnings: string[];
} {
	const vectors = points.map( toVector3 );
	const sideLengths = computeSideLengths( vectors );
	const diagonalLengths = computeDiagonalLengths( vectors );
	const warnings: string[] = [];
	if ( vectors.length !== 4 ) {
		warnings.push( `expected 4 points, got ${vectors.length}` );
	}
	if ( sideLengths.some( ( length ) => length <= 1e-6 ) ) {
		warnings.push( 'zero-length side detected' );
	}
	const area = vectors.length === 4
		? triangleArea( vectors[ 0 ], vectors[ 1 ], vectors[ 2 ] ) + triangleArea( vectors[ 0 ], vectors[ 2 ], vectors[ 3 ] )
		: 0;
	if ( area <= 1e-6 ) {
		warnings.push( 'quad area is near zero' );
	}
	return {
		sideLengths: roundList( sideLengths ),
		diagonalLengths: roundList( diagonalLengths ),
		area: roundNumber( area ),
		warnings
	};
}

export function assertExpectedCornerOrder(order: string[] | undefined): string[] {
	if ( Array.isArray( order ) === false || order.length !== EXPECTED_CORNER_ORDER.length ) {
		return [ 'cornerOrder missing or not 4 items' ];
	}
	const warnings: string[] = [];
	for ( let index = 0; index < EXPECTED_CORNER_ORDER.length; index += 1 ) {
		if ( order[ index ] !== EXPECTED_CORNER_ORDER[ index ] ) {
			warnings.push( `cornerOrder[${index}] expected ${EXPECTED_CORNER_ORDER[ index ]}, got ${order[ index ]}` );
		}
	}
	if ( new Set( order ).size !== order.length ) {
		warnings.push( 'cornerOrder contains duplicate entries' );
	}
	return warnings;
}

export function detectPossibleCornerOrderMismatch(
	sourcePoints: CornerPointLike[],
	targetPoints: CornerPointLike[]
): {
	possibleScaleMismatch: boolean;
	possibleOrderMismatch: boolean;
	warnings: string[];
} {
	const source = computeQuadDiagnostics( sourcePoints );
	const target = computeQuadDiagnostics( targetPoints );
	const warnings = [ ...source.warnings.map( ( item ) => `source: ${item}` ), ...target.warnings.map( ( item ) => `target: ${item}` ) ];
	const sourceRatio = sideRatios( source.sideLengths );
	const targetRatio = sideRatios( target.sideLengths );
	const maxRatioDelta = Math.max( ...sourceRatio.map( ( value, index ) => Math.abs( value - ( targetRatio[ index ] ?? 0 ) ) ), 0 );
	if ( maxRatioDelta > 0.35 ) {
		warnings.push( `side ratio mismatch ${roundNumber( maxRatioDelta )}` );
	}
	return {
		possibleScaleMismatch: maxRatioDelta > 0.35,
		possibleOrderMismatch: maxRatioDelta > 0.35 || warnings.some( ( item ) => item.includes( 'near zero' ) || item.includes( 'zero-length' ) ),
		warnings
	};
}

export function createCornerOrderConfigLoadedPayload(configUrl: string, config: DemoModelConfig): Record<string, unknown> {
	const controlPointEntries = Object.entries( config.controlPoints );
	const firstTarget = config.controlTargets[ 0 ];
	const firstMarker = config.markers[ 0 ];
	const warnings = [
		...collectSuspiciousControlPointNotes( config ),
		...assertExpectedCornerOrder( firstTarget?.cornerOrder )
	];
	return {
		modelId: config.modelId,
		configUrl,
		modelControlPointOrder: EXPECTED_CORNER_ORDER,
		modelControlPointIds: controlPointEntries.map( ( [ id ] ) => id ),
		modelLocalPoints: controlPointEntries.map( ( [ , point ] ) => point.modelLocal ),
		modelEnuPoints: controlPointEntries.map( ( [ , point ] ) => {
			const raw = point as unknown as Record<string, unknown>;
			return raw.enu ?? raw.siteENU ?? point.world;
		} ),
		controlTargetId: firstTarget?.id ?? null,
		controlTargetCornerOrder: firstTarget?.cornerOrder ?? null,
		controlTargetCornersEnu: firstTarget?.cornersEnu ?? null,
		markerCornerOrder: firstMarker?.cornersEnu === undefined ? null : EXPECTED_CORNER_ORDER,
		markerCornersEnu: firstMarker?.cornersEnu ?? null,
		expectedOrder: EXPECTED_CORNER_ORDER,
		orderMatchesExpected: warnings.length === 0,
		warnings
	};
}

export function createModelToEnuCorrespondencePayload(
	config: DemoModelConfig,
	controlPoints: EngineeringControlPoint[]
): Record<string, unknown> {
	const modelLocalPoints = controlPoints.map( ( point ) => point.modelLocal );
	const targetEnuPoints = controlPoints.map( ( point ) => point.worldEnu );
	const model = computeQuadDiagnostics( modelLocalPoints );
	const enu = computeQuadDiagnostics( targetEnuPoints );
	const mismatch = detectPossibleCornerOrderMismatch( modelLocalPoints, targetEnuPoints );
	return {
		modelId: config.modelId,
		controlPointOrder: EXPECTED_CORNER_ORDER,
		controlPointIds: controlPoints.map( ( point ) => point.id ),
		modelLocalPoints: modelLocalPoints.map( vectorToObject ),
		targetEnuPoints: targetEnuPoints.map( vectorToObject ),
		sideLengthsModelLocal: model.sideLengths,
		sideLengthsEnu: enu.sideLengths,
		diagonalLengthsModelLocal: model.diagonalLengths,
		diagonalLengthsEnu: enu.diagonalLengths,
		modelLocalArea: model.area,
		enuArea: enu.area,
		registrationMode: config.registration.mode,
		possibleScaleMismatch: mismatch.possibleScaleMismatch,
		possibleOrderMismatch: mismatch.possibleOrderMismatch,
		warnings: [ ...collectSuspiciousControlPointNotes( config ), ...mismatch.warnings ]
	};
}

export function createMarkerCalibrationCorrespondencePayload(args: {
	controlTarget: VisualControlTarget;
	capturedArPoints: CornerPointLike[];
}): Record<string, unknown> {
	const cornersEnu = args.controlTarget.cornersEnu ?? [];
	const enu = computeQuadDiagnostics( cornersEnu );
	const ar = computeQuadDiagnostics( args.capturedArPoints );
	const mismatch = detectPossibleCornerOrderMismatch( cornersEnu, args.capturedArPoints );
	return {
		controlTargetId: args.controlTarget.id,
		cornerOrder: args.controlTarget.cornerOrder ?? null,
		correspondences: EXPECTED_CORNER_ORDER.map( ( name, index ) => ( {
			index,
			name,
			siteEnu: cornersEnu[ index ] ?? null,
			arPosition: args.capturedArPoints[ index ] === undefined ? null : vectorToObject( toVector3( args.capturedArPoints[ index ] ) )
		} ) ),
		'enuPoint0 matched with arPoint0': true,
		'enuPoint1 matched with arPoint1': true,
		'enuPoint2 matched with arPoint2': true,
		'enuPoint3 matched with arPoint3': true,
		sideLengthsEnu: enu.sideLengths,
		sideLengthsAr: ar.sideLengths,
		diagonalLengthsEnu: enu.diagonalLengths,
		diagonalLengthsAr: ar.diagonalLengths,
		enuArea: enu.area,
		arArea: ar.area,
		possibleOrderMismatch: mismatch.possibleOrderMismatch,
		warnings: [ ...assertExpectedCornerOrder( args.controlTarget.cornerOrder ), ...mismatch.warnings ]
	};
}

function collectSuspiciousControlPointNotes(config: DemoModelConfig): string[] {
	const suspicious = /inherited|previous|verify|mock|demo|not verified/i;
	return Object.entries( config.controlPoints ).flatMap( ( [ id, point ] ) => {
		const raw = point as unknown as Record<string, unknown>;
		return Object.entries( raw )
			.filter( ( [ key, value ] ) => typeof value === 'string' && suspicious.test( value ) )
			.map( ( [ key, value ] ) => `${id}.${key}: ${value as string}` );
	} );
}

function sideRatios(lengths: number[]): number[] {
	const max = Math.max( ...lengths, 0 );
	return max <= 1e-9 ? [] : lengths.map( ( value ) => value / max );
}

function triangleArea(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
	return b.clone().sub( a ).cross( c.clone().sub( a ) ).length() * 0.5;
}

function toVector3(point: CornerPointLike): THREE.Vector3 {
	if ( point instanceof THREE.Vector3 ) {
		return point.clone();
	}
	if ( Array.isArray( point ) ) {
		return new THREE.Vector3( point[ 0 ], point[ 1 ], point[ 2 ] );
	}
	return new THREE.Vector3( point.x, point.y, point.z );
}

function vectorToObject(vector: THREE.Vector3): { x: number; y: number; z: number } {
	return {
		x: roundNumber( vector.x ),
		y: roundNumber( vector.y ),
		z: roundNumber( vector.z )
	};
}

function roundList(values: number[]): number[] {
	return values.map( roundNumber );
}

function roundNumber(value: number): number {
	return Number( value.toFixed( 4 ) );
}

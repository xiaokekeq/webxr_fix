import * as THREE from 'three';
import {
	createArFromEnuSolution,
	type ArFromEnuSolution
} from '@/localization/core/ar-from-enu-solution.js';
import { solveSimilarityTransform } from '@/localization/coarse/engineering-registration.js';
import type {
	DemoModelConfig,
	MarkerEngineeringConfig
} from '@/models/config/demo-model-config.js';
import { createEnuFrame, geodeticToEnu } from '@/localization/core/geodesy.js';
import type { MarkerPoseInAr } from '@/localization/marker/marker-pose-in-ar.js';
import type { VisualControlTarget } from '@/features/ar/types/workflow.js';

export interface MarkerLocalizationCorrespondence {
	id: string;
	siteEnu: THREE.Vector3;
	arPosition: THREE.Vector3;
}

export interface MarkerLocalizationSolution {
	arFromEnuSolution: ArFromEnuSolution;
	matrix: THREE.Matrix4;
	siteOriginArPosition: THREE.Vector3;
	orientation: THREE.Quaternion;
	headingDeg: number;
	rmsErrorMeters: number;
	correspondenceCount: number;
	source: 'marker';
}

export function solveMarkerLocalizationGroundPlane2D(args: {
	correspondences: MarkerLocalizationCorrespondence[];
	sessionId?: string | null;
	timestamp?: number;
}): MarkerLocalizationSolution {

	const correspondences = args.correspondences.filter( isValidCorrespondence );
	if ( correspondences.length < 2 ) {
		throw new Error( 'Ground-plane marker localization requires at least two valid correspondences.' );
	}

	const sourceCentroid = average2D( correspondences.map( ( item ) => ( { x: item.siteEnu.x, y: item.siteEnu.y } ) ) );
	const targetCentroid = average2D( correspondences.map( ( item ) => ( { x: item.arPosition.x, y: - item.arPosition.z } ) ) );
	let dot = 0;
	let cross = 0;
	let markerAverageEnuUp = 0;
	let groundY = 0;

	for ( const item of correspondences ) {
		const sx = item.siteEnu.x - sourceCentroid.x;
		const sy = item.siteEnu.y - sourceCentroid.y;
		const tx = item.arPosition.x - targetCentroid.x;
		const ty = - item.arPosition.z - targetCentroid.y;
		dot += sx * tx + sy * ty;
		cross += sx * ty - sy * tx;
		markerAverageEnuUp += item.siteEnu.z;
		groundY += item.arPosition.y;
	}

	markerAverageEnuUp /= correspondences.length;
	groundY /= correspondences.length;
	const yaw = Math.atan2( cross, dot );
	const c = Math.cos( yaw );
	const s = Math.sin( yaw );
	const translationX = targetCentroid.x - ( c * sourceCentroid.x - s * sourceCentroid.y );
	const translationNorthPrime = targetCentroid.y - ( s * sourceCentroid.x + c * sourceCentroid.y );
	const translationZ = - translationNorthPrime;
	const translationY = groundY - markerAverageEnuUp;
	const matrix = new THREE.Matrix4().set(
		c, - s, 0, translationX,
		0, 0, 1, translationY,
		- s, - c, 0, translationZ,
		0, 0, 0, 1
	);
	const orientationMatrix = matrix.clone().setPosition( 0, 0, 0 );
	const orientation = new THREE.Quaternion().setFromRotationMatrix( orientationMatrix );
	const headingDeg = normalizeDegrees( THREE.MathUtils.radToDeg( yaw ) );
	const errors = correspondences.map( ( item ) => {
		const predicted = item.siteEnu.clone().applyMatrix4( matrix );
		return Math.hypot( predicted.x - item.arPosition.x, predicted.z - item.arPosition.z );
	} );
	const rms2dError = Math.sqrt( errors.reduce( ( total, error ) => total + error * error, 0 ) / errors.length );
	const max2dError = Math.max( ...errors, 0 );
	const siteOriginArPosition = new THREE.Vector3( translationX, translationY, translationZ );
	const timestamp = args.timestamp ?? Date.now();

	console.info( '[GroundPlane2DCalibrationSolved]', {
		solveMode: 'ground-plane-2d',
		yawDeg: Number( headingDeg.toFixed( 6 ) ),
		translationXZ: {
			x: Number( translationX.toFixed( 6 ) ),
			z: Number( translationZ.toFixed( 6 ) )
		},
		groundY: Number( groundY.toFixed( 6 ) ),
		markerAverageEnuUp: Number( markerAverageEnuUp.toFixed( 6 ) ),
		rms2dError: Number( rms2dError.toFixed( 6 ) ),
		max2dError: Number( max2dError.toFixed( 6 ) ),
		inputEnu2d: correspondences.map( ( item ) => ( {
			id: item.id,
			x: Number( item.siteEnu.x.toFixed( 6 ) ),
			y: Number( item.siteEnu.y.toFixed( 6 ) )
		} ) ),
		inputAr2d: correspondences.map( ( item ) => ( {
			id: item.id,
			x: Number( item.arPosition.x.toFixed( 6 ) ),
			z: Number( item.arPosition.z.toFixed( 6 ) )
		} ) ),
		matrix: matrix.toArray()
	} );
	console.info( '[GroundPlane2DFormulaCheck]', {
		sourceCentroid,
		targetCentroid,
		rotationMatrix2D: [
			[ Number( c.toFixed( 6 ) ), Number( ( - s ).toFixed( 6 ) ) ],
			[ Number( s.toFixed( 6 ) ), Number( c.toFixed( 6 ) ) ]
		],
		translationXZ: {
			x: Number( translationX.toFixed( 6 ) ),
			z: Number( translationZ.toFixed( 6 ) )
		},
		reconstructedTargetPoints: correspondences.map( ( item ) => {
			const predicted = item.siteEnu.clone().applyMatrix4( matrix );
			return {
				id: item.id,
				x: Number( predicted.x.toFixed( 6 ) ),
				z: Number( predicted.z.toFixed( 6 ) )
			};
		} ),
		actualTargetPoints: correspondences.map( ( item ) => ( {
			id: item.id,
			x: Number( item.arPosition.x.toFixed( 6 ) ),
			z: Number( item.arPosition.z.toFixed( 6 ) )
		} ) ),
		reconstructionErrors: errors.map( ( error ) => Number( error.toFixed( 6 ) ) )
	} );

	return {
		arFromEnuSolution: {
			matrix: matrix.clone(),
			siteOriginArPosition: siteOriginArPosition.clone(),
			orientation,
			headingDeg,
			source: 'marker',
			sessionId: args.sessionId ?? null,
			accuracyMeters: rms2dError,
			timestamp
		},
		matrix: matrix.clone(),
		siteOriginArPosition,
		orientation,
		headingDeg,
		rmsErrorMeters: rms2dError,
		correspondenceCount: correspondences.length,
		source: 'marker'
	};

}

export interface MarkerPoseInEnu {
	markerId: string;
	matrix: THREE.Matrix4;
	sizeMeters: number;
}

export interface MarkerCornerInEnu {
	id: 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';
	label: string;
	position: THREE.Vector3;
}

export function solveMarkerLocalization(args: {
	correspondences: MarkerLocalizationCorrespondence[];
	orientation?: THREE.Quaternion;
	headingDeg?: number;
	accuracyMeters?: number;
	yawAccuracyDegrees?: number;
	sessionId?: string | null;
	source?: 'marker';
	timestamp?: number;
} | {
	markerId: string;
	markerPoseInEnu: MarkerPoseInEnu;
	markerPoseInAr: MarkerPoseInAr;
	accuracyMeters?: number;
	yawAccuracyDegrees?: number;
	source?: 'marker';
	sessionId?: string | null;
	timestamp?: number;
}): MarkerLocalizationSolution {

	if ( isSingleMarkerPoseLocalizationArgs( args ) ) {
		return solveMarkerLocalizationFromSingleMarkerPose( args );
	}

	const correspondences = args.correspondences.filter( isValidCorrespondence );
	if ( correspondences.length === 0 ) {
		throw new Error( 'Marker localization requires at least one valid correspondence.' );
	}

	let orientation: THREE.Quaternion;
	let siteOriginArPosition: THREE.Vector3;
	let rmsErrorMeters = 0;

	if ( correspondences.length >= 3 ) {
		const rigidSolution = solveSimilarityTransform(
			correspondences.map( ( item ) => item.siteEnu ),
			correspondences.map( ( item ) => item.arPosition ),
			'rigid'
		);

		orientation = rigidSolution.rotation.clone();
		siteOriginArPosition = rigidSolution.translation.clone();
		rmsErrorMeters = rigidSolution.rmsErrorMeters;
	} else {
		if ( args.orientation === undefined ) {
			throw new Error(
				'Marker localization with fewer than 3 correspondences requires an explicit orientation.'
			);
		}

		orientation = args.orientation.clone();
		siteOriginArPosition = solveSiteOriginArPositionFromKnownOrientation(
			correspondences,
			orientation
		);
	}

	const headingDeg = args.headingDeg ?? extractHeadingDegFromEnuToArOrientation( orientation );
	const arFromEnuSolution = createArFromEnuSolution( {
		position: siteOriginArPosition,
		orientation,
		headingDeg,
		source: args.source ?? 'marker',
		sessionId: args.sessionId ?? null,
		accuracyMeters: args.accuracyMeters,
		yawAccuracyDegrees: args.yawAccuracyDegrees,
		timestamp: args.timestamp
	} );

	console.info( '[MarkerLocalization]', {
		correspondenceCount: correspondences.length,
		rmsErrorMeters,
		source: arFromEnuSolution.source,
		siteOriginArPosition: arFromEnuSolution.siteOriginArPosition,
		headingDeg: arFromEnuSolution.headingDeg,
		matrix: arFromEnuSolution.matrix
	} );

	return {
		arFromEnuSolution,
		matrix: arFromEnuSolution.matrix.clone(),
		siteOriginArPosition: arFromEnuSolution.siteOriginArPosition.clone(),
		orientation: arFromEnuSolution.orientation.clone(),
		headingDeg: arFromEnuSolution.headingDeg,
		rmsErrorMeters,
		correspondenceCount: correspondences.length,
		source: 'marker'
	};

}

export function resolveMarkerPoseInEnu(
	config: DemoModelConfig,
	markerId: string
): MarkerPoseInEnu {

	const markerConfig = config.markers.find( ( marker ) => marker.id === markerId );
	if ( markerConfig === undefined ) {
		throw new Error( `Marker "${markerId}" was not found in config.` );
	}

	const siteEnuFrame = createEnuFrame( config.siteFrame.origin );
	const resolvedEnu = resolveMarkerEnuPosition( config, markerConfig, siteEnuFrame );
	const yawDeg = markerConfig.yawDeg ?? 0;
	const matrix = new THREE.Matrix4().compose(
		new THREE.Vector3( resolvedEnu.east, resolvedEnu.north, resolvedEnu.up ),
		new THREE.Quaternion().setFromAxisAngle(
			new THREE.Vector3( 0, 0, 1 ),
			THREE.MathUtils.degToRad( yawDeg )
		),
		new THREE.Vector3( 1, 1, 1 )
	);

	console.info( '[MarkerEngineeringConfig]', {
		markerId: markerConfig.id,
		bindControlPointId: markerConfig.bindControlPointId ?? null,
		sizeMeters: markerConfig.sizeMeters,
		enu: resolvedEnu,
		yawDeg,
		markerPoseInEnu: {
			matrix
		}
	} );

	return {
		markerId: markerConfig.id,
		matrix,
		sizeMeters: markerConfig.sizeMeters
	};

}

export function resolveMarkerCornersInEnu(
	config: DemoModelConfig,
	markerId: string
): MarkerCornerInEnu[] {

	const markerPoseInEnu = resolveMarkerPoseInEnu( config, markerId );
	const corners = createMarkerCornersFromPoseInEnu( markerPoseInEnu );

	console.info( '[MarkerCornersEnuResolved]', {
		targetId: markerId,
		source: 'markers',
		hasCornersEnu: false,
		cornerCount: corners.length,
		createdAt: Date.now()
	} );

	return corners;

}

export function resolveMarkerCornersInEnuFromControlTarget(
	target: VisualControlTarget
): MarkerCornerInEnu[] {

	if ( target.cornersEnu !== undefined ) {
		const cornerIds = resolveControlTargetCornerIds( target.cornerOrder );
		const corners = target.cornersEnu.map( ( corner, index ) => ( {
			id: cornerIds[ index ],
			label: getMarkerCornerLabel( cornerIds[ index ] ),
			position: new THREE.Vector3( corner[ 0 ], corner[ 1 ], corner[ 2 ] )
		} ) );

		console.info( '[MarkerCornersEnuResolved]', {
			targetId: target.id,
			source: 'controlTargets.cornersEnu',
			hasCornersEnu: true,
			cornerCount: corners.length,
			createdAt: Date.now()
		} );

		return corners;
	}

	const corners = createMarkerCornersFromPoseInEnu(
		createMarkerPoseInEnuFromControlTarget( target )
	);

	console.info( '[MarkerCornersEnuResolved]', {
		targetId: target.id,
		source: 'controlTargets.centerEnu',
		hasCornersEnu: false,
		cornerCount: corners.length,
		createdAt: Date.now()
	} );

	return corners;

}

function createMarkerCornersFromPoseInEnu(
	markerPoseInEnu: MarkerPoseInEnu
): MarkerCornerInEnu[] {

	markerPoseInEnu.matrix.decompose(
		tempMarkerEnuPosition,
		tempMarkerEnuQuaternion,
		tempMarkerEnuScale
	);

	const halfSize = markerPoseInEnu.sizeMeters * 0.5;
	const corners: Array<Omit<MarkerCornerInEnu, 'position'> & { local: THREE.Vector3 }> = [
		{
			id: 'top-left',
			label: '左上角',
			local: new THREE.Vector3( - halfSize, halfSize, 0 )
		},
		{
			id: 'top-right',
			label: '右上角',
			local: new THREE.Vector3( halfSize, halfSize, 0 )
		},
		{
			id: 'bottom-right',
			label: '右下角',
			local: new THREE.Vector3( halfSize, - halfSize, 0 )
		},
		{
			id: 'bottom-left',
			label: '左下角',
			local: new THREE.Vector3( - halfSize, - halfSize, 0 )
		}
	];

	return corners.map( ( corner ) => ( {
		id: corner.id,
		label: corner.label,
		position: corner.local
			.clone()
			.applyQuaternion( tempMarkerEnuQuaternion )
			.add( tempMarkerEnuPosition )
	} ) );

}

function resolveControlTargetCornerIds(
	cornerOrder: string[] | undefined
): MarkerCornerInEnu['id'][] {

	const fallback: MarkerCornerInEnu['id'][] = [ 'top-left', 'top-right', 'bottom-right', 'bottom-left' ];
	if ( Array.isArray( cornerOrder ) === false || cornerOrder.length !== 4 ) {
		return fallback;
	}

	return cornerOrder.map( ( item, index ) => normalizeCornerId( item ) ?? fallback[ index ] );

}

function normalizeCornerId(value: string): MarkerCornerInEnu['id'] | null {

	switch ( value ) {
		case 'top-left':
		case 'leftTop':
			return 'top-left';
		case 'top-right':
		case 'rightTop':
			return 'top-right';
		case 'bottom-right':
		case 'rightBottom':
			return 'bottom-right';
		case 'bottom-left':
		case 'leftBottom':
			return 'bottom-left';
		default:
			return null;
	}

}

function getMarkerCornerLabel(id: MarkerCornerInEnu['id']): string {

	switch ( id ) {
		case 'top-left':
			return '左上角';
		case 'top-right':
			return '右上角';
		case 'bottom-right':
			return '右下角';
		case 'bottom-left':
			return '左下角';
	}

}

export function createMarkerPoseInEnuFromControlTarget(
	target: VisualControlTarget
): MarkerPoseInEnu {

	const yawDeg = target.yawDeg ?? 0;
	const sizeMeters = target.sizeMeters ?? 1;
	const matrix = new THREE.Matrix4().compose(
		new THREE.Vector3(
			target.centerEnu[ 0 ],
			target.centerEnu[ 1 ],
			target.centerEnu[ 2 ]
		),
		new THREE.Quaternion().setFromAxisAngle(
			new THREE.Vector3( 0, 0, 1 ),
			THREE.MathUtils.degToRad( yawDeg )
		),
		new THREE.Vector3( 1, 1, 1 )
	);

	return {
		markerId: target.id,
		matrix,
		sizeMeters
	};

}

const tempSitePointInAr = new THREE.Vector3();
const tempAverageTranslation = new THREE.Vector3();
const tempNorthInAr = new THREE.Vector3();
const tempControlPointEnu = new THREE.Vector3();
const tempMarkerEnuPosition = new THREE.Vector3();
const tempMarkerArPosition = new THREE.Vector3();
const tempMarkerEnuQuaternion = new THREE.Quaternion();
const tempMarkerArQuaternion = new THREE.Quaternion();
const tempMarkerEnuScale = new THREE.Vector3();
const tempMarkerArScale = new THREE.Vector3();
const tempMarkerOrientation = new THREE.Quaternion();
const tempInverseMarkerEnuQuaternion = new THREE.Quaternion();

function solveSiteOriginArPositionFromKnownOrientation(
	correspondences: MarkerLocalizationCorrespondence[],
	orientation: THREE.Quaternion
): THREE.Vector3 {

	tempAverageTranslation.set( 0, 0, 0 );

	for ( const item of correspondences ) {
		tempSitePointInAr.copy( item.siteEnu ).applyQuaternion( orientation );
		tempAverageTranslation.add(
			item.arPosition.clone().sub( tempSitePointInAr )
		);
	}

	return tempAverageTranslation.divideScalar( correspondences.length ).clone();

}

function solveMarkerLocalizationFromSingleMarkerPose(args: {
	markerId: string;
	markerPoseInEnu: MarkerPoseInEnu;
	markerPoseInAr: MarkerPoseInAr;
	accuracyMeters?: number;
	yawAccuracyDegrees?: number;
	source?: 'marker';
	sessionId?: string | null;
	timestamp?: number;
}): MarkerLocalizationSolution {

	args.markerPoseInEnu.matrix.decompose(
		tempMarkerEnuPosition,
		tempMarkerEnuQuaternion,
		tempMarkerEnuScale
	);
	args.markerPoseInAr.matrix.decompose(
		tempMarkerArPosition,
		tempMarkerArQuaternion,
		tempMarkerArScale
	);

	const orientation = tempMarkerOrientation
		.copy( tempMarkerArQuaternion )
		.multiply(
			tempInverseMarkerEnuQuaternion.copy( tempMarkerEnuQuaternion ).invert()
		)
		.clone();

	return solveMarkerLocalization( {
		correspondences: [
			{
				id: args.markerId,
				siteEnu: tempMarkerEnuPosition.clone(),
				arPosition: tempMarkerArPosition.clone()
			}
		],
		orientation,
		accuracyMeters: args.accuracyMeters,
		yawAccuracyDegrees: args.yawAccuracyDegrees,
		source: args.source ?? 'marker',
		sessionId: args.sessionId ?? null,
		timestamp: args.timestamp ?? args.markerPoseInAr.timestamp
	} );

}

function extractHeadingDegFromEnuToArOrientation(orientation: THREE.Quaternion): number {

	tempNorthInAr.set( 0, 1, 0 ).applyQuaternion( orientation );
	return normalizeDegrees( THREE.MathUtils.radToDeg( Math.atan2( - tempNorthInAr.x, - tempNorthInAr.z ) ) );

}

function resolveMarkerEnuPosition(
	config: DemoModelConfig,
	markerConfig: MarkerEngineeringConfig,
	siteEnuFrame: ReturnType<typeof createEnuFrame>
): {
	east: number;
	north: number;
	up: number;
} {

	if ( markerConfig.bindControlPointId !== undefined ) {
		const controlPoint = config.controlPoints[ markerConfig.bindControlPointId ];
		if ( controlPoint === undefined ) {
			throw new Error(
				`Marker "${markerConfig.id}" references missing control point "${markerConfig.bindControlPointId}".`
			);
		}

		const controlPointEnu = geodeticToEnu( controlPoint.world, siteEnuFrame, tempControlPointEnu );
		return {
			east: controlPointEnu.x,
			north: controlPointEnu.y,
			up: controlPointEnu.z
		};
	}

	if ( markerConfig.enu === undefined ) {
		throw new Error( `Marker "${markerConfig.id}" is missing ENU coordinates.` );
	}

	return {
		east: markerConfig.enu.east,
		north: markerConfig.enu.north,
		up: markerConfig.enu.up ?? 0
	};

}

function isSingleMarkerPoseLocalizationArgs(args: {
	correspondences: MarkerLocalizationCorrespondence[];
	orientation?: THREE.Quaternion;
	headingDeg?: number;
	accuracyMeters?: number;
	yawAccuracyDegrees?: number;
	timestamp?: number;
} | {
	markerId: string;
	markerPoseInEnu: MarkerPoseInEnu;
	markerPoseInAr: MarkerPoseInAr;
	accuracyMeters?: number;
	yawAccuracyDegrees?: number;
	timestamp?: number;
}): args is {
	markerId: string;
	markerPoseInEnu: MarkerPoseInEnu;
	markerPoseInAr: MarkerPoseInAr;
	accuracyMeters?: number;
	yawAccuracyDegrees?: number;
	source?: 'marker';
	sessionId?: string | null;
	timestamp?: number;
} {

	return 'markerPoseInEnu' in args && 'markerPoseInAr' in args;

}

function isValidCorrespondence(value: MarkerLocalizationCorrespondence): boolean {

	return value.id.trim().length > 0
		&& isFiniteVector3( value.siteEnu )
		&& isFiniteVector3( value.arPosition );

}

function average2D(points: Array<{ x: number; y: number }>): { x: number; y: number } {

	const total = points.reduce(
		(sum, point) => ( {
			x: sum.x + point.x,
			y: sum.y + point.y
		} ),
		{ x: 0, y: 0 }
	);
	return {
		x: total.x / points.length,
		y: total.y / points.length
	};

}

function isFiniteVector3(value: THREE.Vector3): boolean {

	return Number.isFinite( value.x )
		&& Number.isFinite( value.y )
		&& Number.isFinite( value.z );

}

function normalizeDegrees(value: number): number {

	return ( ( value % 360 ) + 360 ) % 360;

}


import * as THREE from 'three';
import type { SetStatus } from '@/features/ar/types/runtime-types.js';
import {
	enuToGeodetic,
	type GeodeticCoordinate
} from '@/localization/core/geodesy.js';
import { convertGeodeticToWgs84 } from '@/localization/core/coordinate-systems.js';
import type { RtkSurveyDataset } from '@/localization/rtk/rtk-survey-dataset.js';
import type { VisualControlTarget } from '@/localization/baseline/site-calibration-baseline.js';
import { createCornerOrderConfigLoadedPayload } from '@/localization/core/corner-order-diagnostics.js';
import type {
	AnnotationSeverity,
	AnnotationStyleRule,
	AnnotationType,
	EngineeringAnnotation,
	EnuPoint
} from '@/engine/annotation/annotation-types.js';
import { arDebug, arError, arInfo, arWarn } from '@/engine/debug/ar-logger.js';

export interface DemoModelLocalPoint {
	x: number;
	y: number;
	z: number;
}

export interface DemoModelControlPointCorrespondence {
	modelLocal: DemoModelLocalPoint;
	world: GeodeticCoordinate;
}

export interface DemoModelAttachment {
	assetId: string;
	world: GeodeticCoordinate;
	anchorMode: 'base-center' | 'bounds-center';
	yawDeg: number;
	scaleMultiplier: number;
	info?: DemoModelAttachmentInfo;
}

export interface DemoModelAttachmentInfo {
	title?: string;
	code?: string;
	type?: string;
	status?: string;
	remark?: string;
}

interface RawDemoModelAttachmentShape {
	assetId: string;
	world: RawGeodeticCoordinateShape;
	anchorMode?: DemoModelAttachment['anchorMode'];
	yawDeg?: number;
	scaleMultiplier?: number;
	info?: DemoModelAttachmentInfo;
}

export interface MarkerEngineeringConfig {
	id: string;
	bindControlPointId?: string;
	sizeMeters: number;
	enu?: {
		east: number;
		north: number;
		up?: number;
	};
	yawDeg?: number;
	centerEnu?: [ number, number, number ];
	cornersEnu?: [
		[ number, number, number ],
		[ number, number, number ],
		[ number, number, number ],
		[ number, number, number ]
	];
	plane?: 'horizontal' | 'vertical';
}

interface RawMarkerEngineeringConfig extends Omit<MarkerEngineeringConfig, 'enu' | 'sizeMeters'> {
	sizeMeters?: number;
	trackingWidthMeters?: number;
	enu?: MarkerEngineeringConfig['enu'] | number[];
}

export type DemoModelRegistrationMode = 'rigid-ground-plane';
export type UndergroundModelHeightAxis = 'y' | 'shortest-edge' | 'bbox-y';
export type ModelGroundRelation = 'above-ground' | 'underground' | 'mixed' | 'absolute-engineering';
export type GroundClassificationMode = 'whole-model' | 'node-groups' | 'clip-by-ground-plane';
export type ModelReferencePlane = 'bbox-bottom' | 'bbox-top' | 'local-ground-plane' | 'control-point-plane' | 'none';
export type ModelSurfaceReference = 'rtk-surface-control-points' | 'absolute-enu';
export type AboveGroundDisplayMode = 'normal-ar' | 'hidden';
export type BelowGroundDisplayMode = 'top-portal' | 'surface-projection' | 'engineering-xray' | 'hidden';

export interface ModelVerticalPlacementConfig {
	groundRelation: ModelGroundRelation;
	surfaceReference: ModelSurfaceReference;
	referencePlane: ModelReferencePlane;
	localGroundY?: number;
	coverDepthMeters?: number;
	modelHeightAxis?: UndergroundModelHeightAxis;
	modelHeightMetersOverride?: number | null;
}

export interface ModelGroundClassificationConfig {
	mode: GroundClassificationMode;
	aboveGroundNodes?: string[];
	belowGroundNodes?: string[];
	localGroundY?: number;
}

export interface ModelDisplayConfig {
	aboveGroundMode: AboveGroundDisplayMode;
	belowGroundMode: BelowGroundDisplayMode;
	realWorldOcclusion: boolean;
	opacity?: number;
	selectable?: boolean;
}

export interface ModelInstanceConfig {
	id: string;
	name: string;
	role?: string;
	verticalPlacement: ModelVerticalPlacementConfig;
	groundClassification?: ModelGroundClassificationConfig;
	display: ModelDisplayConfig;
}

export interface UndergroundPlacementConfig {
	enabled: boolean;
	reference: 'rtk-surface';
	modelReference: 'bottom';
	depthMode: 'model-height';
	modelHeightAxis: UndergroundModelHeightAxis;
	modelHeightMetersOverride?: number | null;
	coverDepthMeters?: number;
}
export interface UndergroundDisplayConfig {
	defaultMode?: 'true-depth' | 'x-ray' | 'surface-projection' | 'lifted-preview';
	liftedPreviewOffsetMeters?: number;
	xrayOpacity?: number;
	showSurfaceProjection?: boolean;
	showDepthGuideLines?: boolean;
}

export interface DemoModelConfig {
	modelId: string;
	siteFrame: {
		origin: GeodeticCoordinate;
		axes: 'enu';
	};
	anchor: GeodeticCoordinate;
	yaw: number;
	scale: number;
	registration: {
		mode: DemoModelRegistrationMode;
		minControlPoints: number;
	};
	controlPoints: Record<string, DemoModelControlPointCorrespondence>;
	markers: MarkerEngineeringConfig[];
	attachments: DemoModelAttachment[];
	rtkSurveyDataset?: RtkSurveyDataset;
	controlTargets: VisualControlTarget[];
	placementAnchorEnu?: [ number, number, number ];
	placementAnchorMeaning?: string;
	placementAnchorModelLocal?: [ number, number, number ];
	undergroundPlacement?: UndergroundPlacementConfig;
	undergroundDisplay?: UndergroundDisplayConfig;
	verticalPlacement?: ModelVerticalPlacementConfig;
	groundClassification?: ModelGroundClassificationConfig;
	display?: ModelDisplayConfig;
	modelInstances: ModelInstanceConfig[];
	undergroundObjects?: unknown[];
	sensors?: unknown[];
	riskPoints?: unknown[];
	annotations: EngineeringAnnotation[];
	annotationStyleRules: AnnotationStyleRule[];
	markerCalibration?: {
		solveMode?: 'ground-plane-2d' | 'rigid-3d-debug';
		maxSelfCheckErrorMeters?: number;
		note?: string;
	};
	configCompleteness: {
		hasExplicitSiteId: boolean;
		hasSiteName: boolean;
		hasExplicitModelLocalToEnu: boolean;
		controlPointsHaveEnu: boolean;
	};
}

interface LegacyControlPointShape {
	x: number;
	y: number;
	z: number;
}

interface RawGeodeticCoordinateShape {
	lat: number;
	lon?: number;
	lng?: number;
	alt?: number;
	height?: number;
	coordType?: string;
}

type PointLike = DemoModelLocalPoint | [ number, number, number ] | number[];

interface LocalDebugOriginShape {
	lng: number;
	lat: number;
	height?: number;
	alt?: number;
	coordType?: string;
}

interface LocalDebugControlPointShape {
	id: string;
	name?: string;
	modelLocal: PointLike;
	siteENU: PointLike;
}

interface LocalDebugModelConfig {
	siteId: string;
	origin: LocalDebugOriginShape;
	anchorModelLocal?: PointLike;
	yawDeg?: number;
	scale?: number;
	controlPoints?: LocalDebugControlPointShape[];
	markers?: RawMarkerEngineeringConfig[];
	attachments?: RawDemoModelAttachmentShape[];
	attachmentsUrl?: string;
	rtkSurveyDataset?: RtkSurveyDataset;
	controlTargets?: VisualControlTarget[];
	placementAnchorEnu?: [ number, number, number ];
	placementAnchorMeaning?: string;
	placementAnchorModelLocal?: [ number, number, number ];
	undergroundPlacement?: UndergroundPlacementConfig;
	undergroundDisplay?: UndergroundDisplayConfig;
	verticalPlacement?: ModelVerticalPlacementConfig;
	groundClassification?: ModelGroundClassificationConfig;
	display?: ModelDisplayConfig;
	modelInstances?: ModelInstanceConfig[];
	undergroundObjects?: unknown[];
	sensors?: unknown[];
	riskPoints?: unknown[];
	annotations?: unknown[];
	annotationStyleRules?: unknown[];
	markerCalibration?: DemoModelConfig['markerCalibration'];
}

interface LegacyDemoModelConfig extends Omit<DemoModelConfig, 'siteFrame' | 'registration' | 'controlPoints' | 'markers' | 'attachments' | 'controlTargets' | 'undergroundPlacement' | 'undergroundDisplay' | 'verticalPlacement' | 'groundClassification' | 'display' | 'modelInstances' | 'annotations' | 'annotationStyleRules'> {
	siteFrame?: DemoModelConfig['siteFrame'];
	registration?: DemoModelConfig['registration'];
	controlPoints: Record<string, {
		modelLocal: DemoModelLocalPoint;
		world: RawGeodeticCoordinateShape;
	} | LegacyControlPointShape>;
	markers?: RawMarkerEngineeringConfig[];
	attachments?: RawDemoModelAttachmentShape[];
	attachmentsUrl?: string;
	rtkSurveyDataset?: RtkSurveyDataset;
	controlTargets?: VisualControlTarget[];
	placementAnchorEnu?: [ number, number, number ];
	placementAnchorMeaning?: string;
	placementAnchorModelLocal?: [ number, number, number ];
	undergroundPlacement?: UndergroundPlacementConfig;
	undergroundDisplay?: UndergroundDisplayConfig;
	verticalPlacement?: ModelVerticalPlacementConfig;
	groundClassification?: ModelGroundClassificationConfig;
	display?: ModelDisplayConfig;
	modelInstances?: ModelInstanceConfig[];
	undergroundObjects?: unknown[];
	sensors?: unknown[];
	riskPoints?: unknown[];
	annotations?: unknown[];
	annotationStyleRules?: unknown[];
}

type RawDemoModelConfig = LegacyDemoModelConfig | LocalDebugModelConfig;
type RawAttachmentCollection = RawDemoModelAttachmentShape[] | {
	attachments: RawDemoModelAttachmentShape[];
};

export async function loadDemoModelConfig(
	url: string,
	setStatus: SetStatus = () => {}
): Promise<DemoModelConfig> {

	setStatus( 'Loading model registration config...' );

	const response = await fetch( url, { cache: 'no-store' } );
	if ( response.ok === false ) {
		throw new Error( `Failed to load model config: HTTP ${response.status}` );
	}

	const raw = await response.json() as RawDemoModelConfig;
	try {
		const enrichedRaw = await enrichDemoModelConfigAttachments( raw );
		const normalized = normalizeDemoModelConfig( enrichedRaw );
		validateDemoModelConfig( normalized );
		arInfo( 'DemoModelConfigLoaded', createConfigDebugPayload( url, normalized ) );
		arInfo( 'CornerOrderConfigLoaded', createCornerOrderConfigLoadedPayload( url, normalized ) );
		arDebug( 'DemoModelConfigNormalized', normalized );

		return normalized;
	} catch ( error ) {
		arError( 'DemoModelConfigParseFailed', {
			configUrl: url,
			modelId: 'modelId' in raw ? raw.modelId : 'siteId' in raw ? raw.siteId : null,
			hasSiteFrameOrigin: 'siteFrame' in raw && raw.siteFrame?.origin !== undefined,
			rawControlTargetsCount: 'controlTargets' in raw && Array.isArray( raw.controlTargets ) ? raw.controlTargets.length : 0,
			rawMarkersCount: 'markers' in raw && Array.isArray( raw.markers ) ? raw.markers.length : 0,
			error: error instanceof Error ? error.message : String( error )
		} );
		throw error;
	}

}

export function getFirstGeodeticPointFromDemoModelConfig(
	config: DemoModelConfig
): GeodeticCoordinate | null {

	const firstControlPoint = Object.values( config.controlPoints )[ 0 ];
	if ( firstControlPoint !== undefined ) {
		return firstControlPoint.world;
	}

	return config.anchor;

}

function normalizeDemoModelConfig(config: RawDemoModelConfig): DemoModelConfig {

	if ( isLocalDebugModelConfig( config ) ) {
		return normalizeLocalDebugModelConfig( config );
	}

	const anchor = normalizeGeodeticShape( config.anchor as RawGeodeticCoordinateShape, 'anchor' );
	const siteOrigin = normalizeGeodeticShape(
		( config.siteFrame?.origin ?? config.anchor ) as RawGeodeticCoordinateShape,
		'siteFrame.origin'
	);

	const siteFrame = {
		...( config.siteFrame ?? {} ),
		origin: siteOrigin,
		axes: 'enu' as const
	};

	const registration = config.registration ?? {
		mode: 'rigid-ground-plane',
		minControlPoints: 3
	};

	const normalizedControlPoints: Record<string, DemoModelControlPointCorrespondence> = {};

	for ( const [ id, point ] of Object.entries( config.controlPoints ) ) {
		if ( isControlPointCorrespondence( point ) ) {
			normalizedControlPoints[ id ] = {
				...( point as unknown as Record<string, unknown> ),
				modelLocal: point.modelLocal,
				world: normalizeGeodeticShape( point.world, `${id}.world` )
			};
			continue;
		}

		const legacyPoint = point as LegacyControlPointShape;
		const normalizedModelLocal = {
			x: legacyPoint.x,
			y: legacyPoint.y,
			z: legacyPoint.z
		};
		normalizedControlPoints[ id ] = {
			modelLocal: normalizedModelLocal,
			world: synthesizeWorldControlPoint( normalizedModelLocal, anchor, config.yaw, config.scale )
		};
	}

	if (
		Object.keys( normalizedControlPoints ).length < registration.minControlPoints
		&& normalizedControlPoints.ORIGIN === undefined
	) {
		normalizedControlPoints.ORIGIN = {
			modelLocal: { x: 0, y: 0, z: 0 },
			world: {
				lat: anchor.lat,
				lon: anchor.lon,
				alt: anchor.alt
			}
		};
	}

	const markers = loadMarkerEngineeringConfigs( config.markers );
	const controlTargets = normalizeSiteConfigControlTargets( config.controlTargets, markers, config.modelId );
	const annotations = normalizeEngineeringAnnotations( config.annotations, normalizedControlPoints );
	reportLegacyUndergroundPlacementConfig( config );

	return {
		modelId: config.modelId,
		siteFrame,
		anchor,
		yaw: config.yaw,
		scale: config.scale,
		registration,
		controlPoints: normalizedControlPoints,
		markers,
		attachments: normalizeAttachments( config.attachments ),
		rtkSurveyDataset: normalizeRtkSurveyDataset( config.rtkSurveyDataset, config.modelId ),
		controlTargets,
		placementAnchorEnu: normalizeEnuTuple( config.placementAnchorEnu ),
		placementAnchorMeaning: typeof config.placementAnchorMeaning === 'string' ? config.placementAnchorMeaning : undefined,
		placementAnchorModelLocal: normalizeEnuTuple( config.placementAnchorModelLocal ),
		undergroundPlacement: normalizeUndergroundPlacementConfig( config.undergroundPlacement ),
		undergroundDisplay: normalizeUndergroundDisplayConfig( config.undergroundDisplay ),
		verticalPlacement: normalizeVerticalPlacementConfig( config.verticalPlacement, config.undergroundPlacement ),
		groundClassification: normalizeGroundClassificationConfig( config.groundClassification ),
		display: normalizeModelDisplayConfig( config.display, config.undergroundDisplay, config.undergroundPlacement ),
		modelInstances: normalizeModelInstances( config.modelInstances, config.modelId, config.undergroundPlacement, config.undergroundDisplay, config.verticalPlacement, config.groundClassification, config.display ),
		undergroundObjects: Array.isArray( config.undergroundObjects ) ? config.undergroundObjects : [],
		sensors: Array.isArray( config.sensors ) ? config.sensors : [],
		riskPoints: Array.isArray( config.riskPoints ) ? config.riskPoints : [],
		annotations,
		annotationStyleRules: normalizeAnnotationStyleRules( config.annotationStyleRules ),
		markerCalibration: config.markerCalibration,
		configCompleteness: {
			hasExplicitSiteId: hasOwnObjectKey( config, 'siteId' ),
			hasSiteName: hasOwnObjectKey( config, 'siteName' ),
			hasExplicitModelLocalToEnu: hasOwnObjectKey( config, 'modelLocalToEnu' ),
			controlPointsHaveEnu: Object.values( config.controlPoints ).every( hasControlPointEnu )
		}
	};

}

function normalizeLocalDebugModelConfig(config: LocalDebugModelConfig): DemoModelConfig {

	const origin = normalizeLocalDebugOrigin( config.origin );
	const normalizedControlPoints = normalizeLocalDebugControlPoints( config, origin );

	const markers = loadMarkerEngineeringConfigs( config.markers );
	const controlTargets = normalizeSiteConfigControlTargets( config.controlTargets, markers, config.siteId );
	const annotations = normalizeEngineeringAnnotations( config.annotations, normalizedControlPoints );
	reportLegacyUndergroundPlacementConfig( config );

	return {
		modelId: config.siteId,
		siteFrame: {
			origin,
			axes: 'enu'
		},
		anchor: origin,
		yaw: config.yawDeg ?? 0,
		scale: config.scale ?? 1,
		registration: {
			mode: 'rigid-ground-plane',
			minControlPoints: 3
		},
		controlPoints: normalizedControlPoints,
		markers,
		attachments: normalizeAttachments( config.attachments ),
		rtkSurveyDataset: normalizeRtkSurveyDataset( config.rtkSurveyDataset, config.siteId ),
		controlTargets,
		placementAnchorEnu: normalizeEnuTuple( config.placementAnchorEnu ),
		placementAnchorMeaning: typeof config.placementAnchorMeaning === 'string' ? config.placementAnchorMeaning : undefined,
		placementAnchorModelLocal: normalizeEnuTuple( config.placementAnchorModelLocal ),
		undergroundPlacement: normalizeUndergroundPlacementConfig( config.undergroundPlacement ),
		undergroundDisplay: normalizeUndergroundDisplayConfig( config.undergroundDisplay ),
		verticalPlacement: normalizeVerticalPlacementConfig( config.verticalPlacement, config.undergroundPlacement ),
		groundClassification: normalizeGroundClassificationConfig( config.groundClassification ),
		display: normalizeModelDisplayConfig( config.display, config.undergroundDisplay, config.undergroundPlacement ),
		modelInstances: normalizeModelInstances( config.modelInstances, config.siteId, config.undergroundPlacement, config.undergroundDisplay, config.verticalPlacement, config.groundClassification, config.display ),
		undergroundObjects: Array.isArray( config.undergroundObjects ) ? config.undergroundObjects : [],
		sensors: Array.isArray( config.sensors ) ? config.sensors : [],
		riskPoints: Array.isArray( config.riskPoints ) ? config.riskPoints : [],
		annotations,
		annotationStyleRules: normalizeAnnotationStyleRules( config.annotationStyleRules ),
		markerCalibration: config.markerCalibration,
		configCompleteness: {
			hasExplicitSiteId: true,
			hasSiteName: hasOwnObjectKey( config, 'siteName' ),
			hasExplicitModelLocalToEnu: hasOwnObjectKey( config, 'modelLocalToEnu' ),
			controlPointsHaveEnu: ( config.controlPoints ?? [] ).every( hasControlPointEnu )
		}
	};

}

function normalizeLocalDebugControlPoints(
	config: LocalDebugModelConfig,
	origin: GeodeticCoordinate
): Record<string, DemoModelControlPointCorrespondence> {

	const controlPoints = Array.isArray( config.controlPoints )
		? config.controlPoints
		: [];

	if ( controlPoints.length >= 3 ) {
		const normalizedControlPoints: Record<string, DemoModelControlPointCorrespondence> = {};

		for ( const point of controlPoints ) {
			const modelLocal = normalizePointLike( point.modelLocal, `${point.id}.modelLocal` );
			const siteEnu = normalizePointLike( point.siteENU, `${point.id}.siteENU` );
			// Local debug configs are authored as [east, height, north] so remap them
			// into the runtime ENU basis [east, north, up].
			const world = enuToGeodetic( new THREE.Vector3( siteEnu.x, siteEnu.z, siteEnu.y ), origin );

			normalizedControlPoints[ point.id ] = {
				modelLocal,
				world
			};
		}

		return normalizedControlPoints;
	}

	const anchorModelLocal = normalizePointLike(
		config.anchorModelLocal ?? [ 0, 0, 0 ],
		'anchorModelLocal'
	);
	const yawDeg = typeof config.yawDeg === 'number' ? config.yawDeg : 0;
	const scale = typeof config.scale === 'number' && Number.isFinite( config.scale ) && config.scale > 0
		? config.scale
		: 1;

	return {
		ANCHOR: {
			modelLocal: anchorModelLocal,
			world: origin
		},
		AXIS_EAST: {
			modelLocal: {
				x: anchorModelLocal.x + 1,
				y: anchorModelLocal.y,
				z: anchorModelLocal.z
			},
			world: synthesizeLocalDebugAnchorWorldPoint(
				anchorModelLocal,
				{ x: anchorModelLocal.x + 1, y: anchorModelLocal.y, z: anchorModelLocal.z },
				origin,
				yawDeg,
				scale
			)
		},
		AXIS_NORTH: {
			modelLocal: {
				x: anchorModelLocal.x,
				y: anchorModelLocal.y,
				z: anchorModelLocal.z - 1
			},
			world: synthesizeLocalDebugAnchorWorldPoint(
				anchorModelLocal,
				{ x: anchorModelLocal.x, y: anchorModelLocal.y, z: anchorModelLocal.z - 1 },
				origin,
				yawDeg,
				scale
			)
		},
		AXIS_UP: {
			modelLocal: {
				x: anchorModelLocal.x,
				y: anchorModelLocal.y + 1,
				z: anchorModelLocal.z
			},
			world: synthesizeLocalDebugAnchorWorldPoint(
				anchorModelLocal,
				{ x: anchorModelLocal.x, y: anchorModelLocal.y + 1, z: anchorModelLocal.z },
				origin,
				yawDeg,
				scale
			)
		}
	};

}

function normalizeEngineeringAnnotations(
	rawAnnotations: unknown[] | undefined,
	controlPoints: Record<string, DemoModelControlPointCorrespondence>
): EngineeringAnnotation[] {

	if ( Array.isArray( rawAnnotations ) === false ) {
		arInfo( 'AnnotationConfigLoaded', {
			totalRaw: 0,
			totalValid: 0,
			skippedIds: [],
			annotationIds: [],
			severityCounts: {},
			layerIds: [],
			generatedFromControlPoints: false,
			generatedFromControlTargets: false
		} );
		return [];
	}

	const annotations: EngineeringAnnotation[] = [];
	const skippedIds: string[] = [];
	const seenIds = new Set<string>();
	const controlPointIds = new Set( Object.keys( controlPoints ) );

	for ( const [ index, raw ] of rawAnnotations.entries() ) {
		const rawRecord = isRecord( raw ) ? raw : null;
		const id = typeof rawRecord?.id === 'string' ? rawRecord.id.trim() : '';
		const fallbackSkippedId = id || `annotations[${index}]`;

		const normalized = normalizeEngineeringAnnotation( rawRecord, index );
		if ( normalized === null ) {
			skippedIds.push( fallbackSkippedId );
			continue;
		}

		if ( seenIds.has( normalized.id ) ) {
			arWarn( 'AnnotationConfigValidationWarning', {
				id: normalized.id,
				index,
				reason: 'duplicate annotation id'
			} );
			skippedIds.push( normalized.id );
			continue;
		}

		if ( controlPointIds.has( normalized.id ) ) {
			arWarn( 'AnnotationControlPointIdCollisionWarning', {
				id: normalized.id,
				index,
				reason: 'annotation id matches controlPoint id; annotation remains explicit and is not auto-generated'
			} );
		}

		seenIds.add( normalized.id );
		annotations.push( normalized );
	}

	arInfo( 'AnnotationConfigLoaded', {
		totalRaw: rawAnnotations.length,
		totalValid: annotations.length,
		skippedIds,
		annotationIds: annotations.map( ( annotation ) => annotation.id ),
		severityCounts: countAnnotationSeverities( annotations ),
		layerIds: Array.from( new Set( annotations.map( ( annotation ) => annotation.layerId ) ) ),
		generatedFromControlPoints: false,
		generatedFromControlTargets: false
	} );

	return annotations;

}

function normalizeEngineeringAnnotation(
	raw: Record<string, unknown> | null,
	index: number
): EngineeringAnnotation | null {

	if ( raw === null ) {
		arWarn( 'AnnotationConfigValidationWarning', {
			index,
			reason: 'annotation must be an object'
		} );
		return null;
	}

	const id = typeof raw.id === 'string' ? raw.id.trim() : '';
	const title = typeof raw.title === 'string' ? raw.title.trim() : '';
	const anchorEnu = normalizeAnnotationEnuPoint( raw.anchorEnu );
	const severity = normalizeAnnotationSeverity( raw.severity );
	const type = normalizeAnnotationType( raw.type );
	const label = normalizeAnnotationLabel( raw.label );

	const reason = id.length === 0
		? 'missing id'
		: title.length === 0
			? 'missing title'
			: anchorEnu === null
				? 'anchorEnu east/north/up must be numbers'
				: severity === null
					? 'severity must be normal/warning/danger'
					: type === null
						? 'type is invalid'
						: label === null && raw.label !== undefined
							? 'label config is invalid'
							: '';
	if ( reason.length > 0 || anchorEnu === null || severity === null || type === null || ( label === null && raw.label !== undefined ) ) {
		arWarn( 'AnnotationConfigValidationWarning', {
			id: id || null,
			index,
			reason
		} );
		return null;
	}

	return {
		id,
		type,
		title,
		description: typeof raw.description === 'string' ? raw.description : undefined,
		anchorEnu,
		label: label ?? undefined,
		severity,
		status: typeof raw.status === 'string' ? raw.status : undefined,
		color: typeof raw.color === 'string' ? raw.color : undefined,
		icon: typeof raw.icon === 'string' ? raw.icon : undefined,
		source: normalizeAnnotationSource( raw.source ),
		properties: normalizeAnnotationProperties( raw.properties ),
		visible: typeof raw.visible === 'boolean' ? raw.visible : true,
		layerId: typeof raw.layerId === 'string' && raw.layerId.trim().length > 0
			? raw.layerId.trim()
			: 'annotations'
	};

}

function normalizeAnnotationStyleRules(rawRules: unknown[] | undefined): AnnotationStyleRule[] {

	if ( Array.isArray( rawRules ) === false ) {
		return [];
	}

	return rawRules.flatMap( ( raw, index ) => {
		if ( isRecord( raw ) === false ) {
			arWarn( 'AnnotationConfigValidationWarning', {
				index,
				reason: 'annotationStyleRules item must be an object'
			} );
			return [];
		}

		const severity = normalizeAnnotationSeverity( raw.severity );
		if (
			severity === null
			|| typeof raw.pointColor !== 'string'
			|| typeof raw.lineColor !== 'string'
			|| typeof raw.labelColor !== 'string'
		) {
			arWarn( 'AnnotationConfigValidationWarning', {
				index,
				reason: 'annotationStyleRules item is invalid'
			} );
			return [];
		}

		return [ {
			severity,
			pointColor: raw.pointColor,
			lineColor: raw.lineColor,
			labelColor: raw.labelColor
		} ];
	} );

}

function normalizeAnnotationLabel(raw: unknown): EngineeringAnnotation['label'] | null {

	if ( raw === undefined ) {
		return undefined;
	}
	if ( isRecord( raw ) === false ) {
		return null;
	}

	if ( raw.mode === 'offset' ) {
		const offsetMeters = normalizeAnnotationEnuPoint( raw.offsetMeters );
		return offsetMeters === null ? null : {
			mode: 'offset',
			offsetMeters
		};
	}

	if ( raw.mode === 'absolute' ) {
		const labelEnu = normalizeAnnotationEnuPoint( raw.labelEnu );
		return labelEnu === null ? null : {
			mode: 'absolute',
			labelEnu
		};
	}

	return null;

}

function normalizeAnnotationEnuPoint(raw: unknown): EnuPoint | null {

	if ( isRecord( raw ) === false ) {
		return null;
	}

	const east = raw.east;
	const north = raw.north;
	const up = raw.up;
	if (
		typeof east !== 'number'
		|| Number.isFinite( east ) === false
		|| typeof north !== 'number'
		|| Number.isFinite( north ) === false
		|| typeof up !== 'number'
		|| Number.isFinite( up ) === false
	) {
		return null;
	}

	return { east, north, up };

}

function normalizeAnnotationSeverity(raw: unknown): AnnotationSeverity | null {

	return raw === 'normal' || raw === 'warning' || raw === 'danger' ? raw : null;

}

function normalizeAnnotationType(raw: unknown): AnnotationType | null {

	return raw === 'risk'
		|| raw === 'monitor'
		|| raw === 'inspection'
		|| raw === 'label'
		|| raw === 'warning'
		|| raw === 'custom'
		? raw
		: null;

}

function normalizeAnnotationSource(raw: unknown): EngineeringAnnotation['source'] {

	return raw === 'demo'
		|| raw === 'sensor'
		|| raw === 'inspection'
		|| raw === 'risk'
		|| raw === 'business'
		? raw
		: 'business';

}

function normalizeAnnotationProperties(raw: unknown): Record<string, string | number | boolean | null> {

	if ( isRecord( raw ) === false ) {
		return {};
	}

	const properties: Record<string, string | number | boolean | null> = {};
	for ( const [ key, value ] of Object.entries( raw ) ) {
		if (
			typeof value === 'string'
			|| typeof value === 'number'
			|| typeof value === 'boolean'
			|| value === null
		) {
			properties[ key ] = value;
		}
	}
	return properties;

}

function countAnnotationSeverities(annotations: EngineeringAnnotation[]): Record<AnnotationSeverity, number> {

	return {
		normal: annotations.filter( ( annotation ) => annotation.severity === 'normal' ).length,
		warning: annotations.filter( ( annotation ) => annotation.severity === 'warning' ).length,
		danger: annotations.filter( ( annotation ) => annotation.severity === 'danger' ).length
	};

}

function isRecord(value: unknown): value is Record<string, unknown> {

	return typeof value === 'object' && value !== null && Array.isArray( value ) === false;

}

function validateDemoModelConfig(config: DemoModelConfig): void {

	if ( typeof config.modelId !== 'string' || config.modelId.length === 0 ) {
		throw new Error( 'Model config is missing a valid modelId.' );
	}

	if ( typeof config.siteFrame?.origin?.lat !== 'number' || typeof config.siteFrame?.origin?.lon !== 'number' ) {
		throw new Error( 'Model config is missing a valid siteFrame.origin.' );
	}

	if ( config.siteFrame.axes !== 'enu' ) {
		throw new Error( 'Only ENU site frames are supported right now.' );
	}

	if ( typeof config.anchor?.lat !== 'number' || typeof config.anchor?.lon !== 'number' ) {
		throw new Error( 'Model config is missing a valid anchor.' );
	}

	if ( typeof config.yaw !== 'number' ) {
		throw new Error( 'Model config is missing a valid yaw.' );
	}

	if ( typeof config.scale !== 'number' || Number.isFinite( config.scale ) === false || config.scale <= 0 ) {
		throw new Error( 'Model config is missing a valid scale.' );
	}

	if ( config.registration.mode !== 'rigid-ground-plane' ) {
		throw new Error( 'registration.mode must be "rigid-ground-plane".' );
	}

	if ( config.registration.minControlPoints < 3 ) {
		throw new Error( 'registration.minControlPoints must be at least 3.' );
	}

	if ( typeof config.controlPoints !== 'object' || config.controlPoints === null ) {
		throw new Error( 'Model config is missing valid controlPoints.' );
	}

	if ( Array.isArray( config.markers ) === false ) {
		throw new Error( 'Model config markers must be an array.' );
	}

	if ( Array.isArray( config.attachments ) === false ) {
		throw new Error( 'Model config attachments must be an array.' );
	}

	if ( Array.isArray( config.annotations ) === false ) {
		throw new Error( 'Model config annotations must be an array.' );
	}

	if ( Array.isArray( config.annotationStyleRules ) === false ) {
		throw new Error( 'Model config annotationStyleRules must be an array.' );
	}

}

export function loadMarkerEngineeringConfigs(
	markers: RawMarkerEngineeringConfig[] | undefined
): MarkerEngineeringConfig[] {

	if ( Array.isArray( markers ) === false ) {
		return [];
	}

	return markers.map( ( marker, index ) => {
		if ( typeof marker?.id !== 'string' || marker.id.trim().length === 0 ) {
			throw new Error( `markers[${index}] is missing a valid id.` );
		}

		const sizeMeters = normalizeMarkerSizeMeters( marker );
		if ( sizeMeters === undefined ) {
			throw new Error( `markers[${index}] is missing a valid sizeMeters.` );
		}
		const bindControlPointId = typeof marker.bindControlPointId === 'string'
			&& marker.bindControlPointId.trim().length > 0
			? marker.bindControlPointId.trim()
			: undefined;
		const enu = normalizeMarkerEnu( marker.enu, `markers[${index}].enu` );

		if ( bindControlPointId === undefined && enu === undefined ) {
			throw new Error(
				`markers[${index}] must provide bindControlPointId or enu.`
			);
		}

		const yawDeg = typeof marker.yawDeg === 'number' && Number.isFinite( marker.yawDeg )
			? marker.yawDeg
			: 0;
		return {
			id: marker.id.trim(),
			bindControlPointId,
			sizeMeters,
			enu,
			yawDeg,
			centerEnu: normalizeEnuTuple( marker.centerEnu ),
			cornersEnu: normalizeCornersEnu( marker.cornersEnu ),
			plane: marker.plane === 'vertical' ? 'vertical' : 'horizontal'
		};
	} );

}

function normalizeRtkSurveyDataset(
	dataset: RtkSurveyDataset | undefined,
	siteId: string
): RtkSurveyDataset | undefined {

	if ( dataset === undefined ) {
		arInfo( 'RtkSurveyDatasetLoaded', {
			siteId,
			pointCount: 0,
			source: null,
			coordinateSystem: null,
			createdAt: Date.now()
		} );
		return undefined;
	}

	const normalized: RtkSurveyDataset = {
		siteId: typeof dataset.siteId === 'string' && dataset.siteId.length > 0
			? dataset.siteId
			: siteId,
		coordinateSystem: dataset.coordinateSystem === 'WGS84' || dataset.coordinateSystem === 'mixed'
			? dataset.coordinateSystem
			: 'site-enu',
		measuredAt: typeof dataset.measuredAt === 'string' ? dataset.measuredAt : undefined,
		source: dataset.source,
		points: Array.isArray( dataset.points ) ? dataset.points : []
	};

	arInfo( 'RtkSurveyDatasetLoaded', {
		siteId: normalized.siteId,
		pointCount: normalized.points.length,
		source: normalized.source ?? null,
		coordinateSystem: normalized.coordinateSystem,
		createdAt: Date.now()
	} );
	return normalized;

}

function normalizeSiteConfigControlTargets(
	targets: VisualControlTarget[] | undefined,
	markers: MarkerEngineeringConfig[],
	siteId: string
): VisualControlTarget[] {

	const normalizedTargets = normalizeVisualControlTargets( targets );
	const targetIds = new Set( normalizedTargets.map( ( target ) => target.id ) );
	const markerFallbackTargets = markers.flatMap( ( marker ) => {
		if ( targetIds.has( marker.id ) ) {
			return [];
		}

		const centerEnu = marker.centerEnu
			?? (
				marker.enu === undefined
					? undefined
					: [ marker.enu.east, marker.enu.north, marker.enu.up ?? 0 ] as [ number, number, number ]
			);
		if ( centerEnu === undefined ) {
			return [];
		}

		return [ {
			id: marker.id,
			name: marker.bindControlPointId ?? marker.id,
			markerId: marker.id,
			centerEnu,
			cornersEnu: marker.cornersEnu,
			yawDeg: marker.yawDeg,
			sizeMeters: marker.sizeMeters,
			plane: marker.plane ?? 'horizontal',
			cornerOrder: [ 'leftTop', 'rightTop', 'rightBottom', 'leftBottom' ]
		} satisfies VisualControlTarget ];
	} );
	const resolvedTargets = [ ...normalizedTargets, ...markerFallbackTargets ];

	arInfo( 'SiteConfigControlTargetsResolved', {
		siteId,
		sourceControlTargetsCount: Array.isArray( targets ) ? targets.length : 0,
		sourceMarkersCount: markers.length,
		resolvedControlTargetsCount: resolvedTargets.length,
		usedMarkerFallbackCount: markerFallbackTargets.length,
		createdAt: Date.now()
	} );

	return resolvedTargets;

}

function normalizeVisualControlTargets(
	targets: VisualControlTarget[] | undefined
): VisualControlTarget[] {

	if ( Array.isArray( targets ) === false ) {
		return [];
	}

	return targets.flatMap( ( target, index ) => {
		if ( typeof target?.id !== 'string' || target.id.trim().length === 0 ) {
			return [];
		}

		const cornersEnu = normalizeCornersEnu( target.cornersEnu );
		const centerEnu = normalizeEnuTuple( target.centerEnu ) ?? deriveCenterEnuFromCorners( cornersEnu );
		if ( centerEnu === undefined ) {
			arWarn( 'RtkSurveyControlTargetResolved', {
				targetId: target.id,
				resolved: false,
				reason: `controlTargets[${index}].centerEnu missing and cornersEnu invalid`,
				createdAt: Date.now()
			} );
			return [];
		}

		arInfo( 'RtkSurveyControlTargetResolved', {
			targetId: target.id,
			resolved: true,
			hasCornersEnu: cornersEnu !== undefined,
			createdAt: Date.now()
		} );

		return [ {
			...target,
			id: target.id.trim(),
			centerEnu,
			cornersEnu,
			yawDeg: typeof target.yawDeg === 'number' && Number.isFinite( target.yawDeg ) ? target.yawDeg : undefined,
			sizeMeters: typeof target.sizeMeters === 'number' && Number.isFinite( target.sizeMeters ) ? target.sizeMeters : undefined,
			plane: target.plane === 'vertical' ? 'vertical' : 'horizontal'
		} ];
	} );

}

function deriveCenterEnuFromCorners(
	cornersEnu: VisualControlTarget['cornersEnu'] | undefined
): [ number, number, number ] | undefined {

	if ( cornersEnu === undefined ) {
		return undefined;
	}

	return [
		cornersEnu.reduce( ( sum, corner ) => sum + corner[ 0 ], 0 ) / cornersEnu.length,
		cornersEnu.reduce( ( sum, corner ) => sum + corner[ 1 ], 0 ) / cornersEnu.length,
		cornersEnu.reduce( ( sum, corner ) => sum + corner[ 2 ], 0 ) / cornersEnu.length
	];

}

function normalizeEnuTuple(value: [ number, number, number ] | number[] | undefined): [ number, number, number ] | undefined {

	if (
		Array.isArray( value ) === false
		|| value.length < 3
		|| value.slice( 0, 3 ).every( ( item ) => typeof item === 'number' && Number.isFinite( item ) ) === false
	) {
		return undefined;
	}

	return [ value[ 0 ], value[ 1 ], value[ 2 ] ];

}

function hasOwnObjectKey(value: object, key: string): boolean {

	return Object.prototype.hasOwnProperty.call( value, key );

}

function hasControlPointEnu(value: unknown): boolean {

	if ( typeof value !== 'object' || value === null ) {
		return false;
	}

	return hasOwnObjectKey( value, 'enu' );

}

function normalizeModelInstances(
	value: ModelInstanceConfig[] | undefined,
	fallbackModelId: string,
	legacyUndergroundPlacement: UndergroundPlacementConfig | undefined,
	legacyUndergroundDisplay: UndergroundDisplayConfig | undefined,
	verticalPlacement: ModelVerticalPlacementConfig | undefined,
	groundClassification: ModelGroundClassificationConfig | undefined,
	display: ModelDisplayConfig | undefined
): ModelInstanceConfig[] {

	if ( Array.isArray( value ) && value.length > 0 ) {
		return value.flatMap( ( instance ) => {
			if ( typeof instance?.id !== 'string' || instance.id.trim().length === 0 ) {
				return [];
			}
			return [ {
				id: instance.id.trim(),
				name: typeof instance.name === 'string' && instance.name.trim().length > 0 ? instance.name.trim() : instance.id.trim(),
				role: typeof instance.role === 'string' ? instance.role : 'primary',
				verticalPlacement: normalizeVerticalPlacementConfig( instance.verticalPlacement, legacyUndergroundPlacement ),
				groundClassification: normalizeGroundClassificationConfig( instance.groundClassification ),
				display: normalizeModelDisplayConfig( instance.display, legacyUndergroundDisplay, legacyUndergroundPlacement )
			} ];
		} );
	}

	return [ {
		id: fallbackModelId,
		name: fallbackModelId,
		role: 'primary',
		verticalPlacement: normalizeVerticalPlacementConfig( verticalPlacement, legacyUndergroundPlacement ),
		groundClassification: normalizeGroundClassificationConfig( groundClassification ),
		display: normalizeModelDisplayConfig( display, legacyUndergroundDisplay, legacyUndergroundPlacement )
	} ];

}

function normalizeVerticalPlacementConfig(
	value: ModelVerticalPlacementConfig | undefined,
	legacyUndergroundPlacement: UndergroundPlacementConfig | undefined
): ModelVerticalPlacementConfig {

	if ( value !== undefined ) {
		return {
			groundRelation: normalizeGroundRelation( value.groundRelation ),
			surfaceReference: value.surfaceReference === 'absolute-enu' ? 'absolute-enu' : 'rtk-surface-control-points',
			referencePlane: normalizeReferencePlane( value.referencePlane, value.groundRelation ),
			localGroundY: typeof value.localGroundY === 'number' && Number.isFinite( value.localGroundY ) ? value.localGroundY : undefined,
			coverDepthMeters: typeof value.coverDepthMeters === 'number' && Number.isFinite( value.coverDepthMeters ) ? Math.max( 0, value.coverDepthMeters ) : 0,
			modelHeightAxis: value.modelHeightAxis === 'y' || value.modelHeightAxis === 'shortest-edge' ? value.modelHeightAxis : 'bbox-y',
			modelHeightMetersOverride: typeof value.modelHeightMetersOverride === 'number' && Number.isFinite( value.modelHeightMetersOverride ) && value.modelHeightMetersOverride > 0
				? value.modelHeightMetersOverride
				: null
		};
	}

	if ( legacyUndergroundPlacement?.enabled === true ) {
		return {
			groundRelation: 'underground',
			surfaceReference: 'rtk-surface-control-points',
			referencePlane: 'bbox-top',
			coverDepthMeters: legacyUndergroundPlacement.coverDepthMeters ?? 0,
			modelHeightAxis: legacyUndergroundPlacement.modelHeightAxis ?? 'bbox-y',
			modelHeightMetersOverride: legacyUndergroundPlacement.modelHeightMetersOverride ?? null
		};
	}

	return {
		groundRelation: 'above-ground',
		surfaceReference: 'rtk-surface-control-points',
		referencePlane: 'bbox-bottom',
		coverDepthMeters: 0,
		modelHeightAxis: 'bbox-y',
		modelHeightMetersOverride: null
	};

}

function normalizeGroundClassificationConfig(value: ModelGroundClassificationConfig | undefined): ModelGroundClassificationConfig {

	if ( value?.mode === 'node-groups' ) {
		const above = Array.isArray( value.aboveGroundNodes ) ? value.aboveGroundNodes.filter( isNonEmptyString ) : [];
		const below = Array.isArray( value.belowGroundNodes ) ? value.belowGroundNodes.filter( isNonEmptyString ) : [];
		const overlap = above.filter( ( item ) => below.includes( item ) );
		if ( overlap.length > 0 ) {
			arError( 'GroundClassificationNodeOverlap', { overlap } );
		}
		return {
			mode: 'node-groups',
			aboveGroundNodes: above,
			belowGroundNodes: below
		};
	}

	if ( value?.mode === 'clip-by-ground-plane' ) {
		return {
			mode: 'clip-by-ground-plane',
			localGroundY: typeof value.localGroundY === 'number' && Number.isFinite( value.localGroundY ) ? value.localGroundY : 0
		};
	}

	return { mode: 'whole-model' };

}

function normalizeModelDisplayConfig(
	value: ModelDisplayConfig | undefined,
	legacyUndergroundDisplay: UndergroundDisplayConfig | undefined,
	legacyUndergroundPlacement: UndergroundPlacementConfig | undefined
): ModelDisplayConfig {

	const underground = legacyUndergroundPlacement?.enabled === true;
	return {
		aboveGroundMode: value?.aboveGroundMode === 'hidden' ? 'hidden' : 'normal-ar',
		belowGroundMode: value?.belowGroundMode ?? ( underground ? 'top-portal' : 'hidden' ),
		realWorldOcclusion: value?.realWorldOcclusion ?? underground,
		opacity: typeof value?.opacity === 'number' && Number.isFinite( value.opacity )
			? Math.min( 1, Math.max( 0, value.opacity ) )
			: legacyUndergroundDisplay?.xrayOpacity,
		selectable: value?.selectable ?? true
	};

}

function normalizeGroundRelation(value: unknown): ModelGroundRelation {
	return value === 'underground' || value === 'mixed' || value === 'absolute-engineering' ? value : 'above-ground';
}

function normalizeReferencePlane(value: unknown, relation: unknown): ModelReferencePlane {
	if (
		value === 'bbox-bottom'
		|| value === 'bbox-top'
		|| value === 'local-ground-plane'
		|| value === 'control-point-plane'
		|| value === 'none'
	) {
		return value;
	}
	return relation === 'underground' ? 'bbox-top' : relation === 'absolute-engineering' ? 'none' : 'bbox-bottom';
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function normalizeUndergroundPlacementConfig(value: UndergroundPlacementConfig | undefined): UndergroundPlacementConfig | undefined {

	if ( typeof value !== 'object' || value === null || value.enabled !== true ) {
		return undefined;
	}

	return {
		enabled: true,
		reference: 'rtk-surface',
		modelReference: 'bottom',
		depthMode: 'model-height',
		modelHeightAxis: value.modelHeightAxis === 'y' || value.modelHeightAxis === 'shortest-edge'
			? value.modelHeightAxis
			: 'bbox-y',
		modelHeightMetersOverride: typeof value.modelHeightMetersOverride === 'number' && Number.isFinite( value.modelHeightMetersOverride ) && value.modelHeightMetersOverride > 0
			? value.modelHeightMetersOverride
			: null,
		coverDepthMeters: typeof value.coverDepthMeters === 'number' && Number.isFinite( value.coverDepthMeters )
			? Math.max( 0, value.coverDepthMeters )
			: 0
	};

}

function reportLegacyUndergroundPlacementConfig(config: unknown): void {

	if ( typeof config !== 'object' || config === null ) {
		return;
	}
	const record = config as Record<string, unknown>;
	const undergroundDisplay = record.undergroundDisplay as Record<string, unknown> | undefined;
	const legacyFields = [
		'visualGroundOffsetMeters',
		'visualPlacementMode',
		...( undergroundDisplay?.buriedDepthMeters !== undefined ? [ 'undergroundDisplay.buriedDepthMeters' ] : [] ),
		...( undergroundDisplay?.modelHeightAxis !== undefined ? [ 'undergroundDisplay.modelHeightAxis' ] : [] )
	].filter( ( key ) => key.includes( '.' ) || record[ key ] !== undefined );

	if ( legacyFields.length > 0 ) {
		arError( 'LegacyUndergroundPlacementConfigDetected', {
			legacyFields,
			reason: 'underground depth must be derived through undergroundPlacement only'
		} );
	}

}

function normalizeUndergroundDisplayConfig(value: UndergroundDisplayConfig | undefined): UndergroundDisplayConfig | undefined {

	if ( typeof value !== 'object' || value === null ) {
		return undefined;
	}

	const config: UndergroundDisplayConfig = {};
	if (
		value.defaultMode === 'true-depth'
		|| value.defaultMode === 'x-ray'
		|| value.defaultMode === 'surface-projection'
		|| value.defaultMode === 'lifted-preview'
	) {
		config.defaultMode = value.defaultMode;
	}

	if ( typeof value.liftedPreviewOffsetMeters === 'number' && Number.isFinite( value.liftedPreviewOffsetMeters ) ) {
		config.liftedPreviewOffsetMeters = value.liftedPreviewOffsetMeters;
	}

	if ( typeof value.xrayOpacity === 'number' && Number.isFinite( value.xrayOpacity ) ) {
		config.xrayOpacity = value.xrayOpacity;
	}

	if ( typeof value.showSurfaceProjection === 'boolean' ) {
		config.showSurfaceProjection = value.showSurfaceProjection;
	}

	if ( typeof value.showDepthGuideLines === 'boolean' ) {
		config.showDepthGuideLines = value.showDepthGuideLines;
	}

	return Object.keys( config ).length === 0 ? undefined : config;

}

function normalizeCornersEnu(
	value: VisualControlTarget['cornersEnu'] | undefined
): VisualControlTarget['cornersEnu'] | undefined {

	if ( Array.isArray( value ) === false || value.length !== 4 ) {
		return undefined;
	}

	const corners = value.map( ( corner ) => normalizeEnuTuple( corner ) );
	if ( corners.some( ( corner ) => corner === undefined ) ) {
		return undefined;
	}

	return corners as VisualControlTarget['cornersEnu'];

}

function normalizeAttachments(
	attachments: RawDemoModelAttachmentShape[] | undefined
): DemoModelAttachment[] {

	if ( Array.isArray( attachments ) === false ) {
		return [];
	}

	return attachments.map( ( attachment, index ) => {
		if ( typeof attachment?.assetId !== 'string' || attachment.assetId.length === 0 ) {
			throw new Error( `attachments[${index}] is missing a valid assetId.` );
		}

		const anchorMode = attachment.anchorMode === 'base-center'
			? 'base-center'
			: 'bounds-center';
		const yawDeg = typeof attachment.yawDeg === 'number' && Number.isFinite( attachment.yawDeg )
			? attachment.yawDeg
			: 0;
		const scaleMultiplier = typeof attachment.scaleMultiplier === 'number'
			&& Number.isFinite( attachment.scaleMultiplier )
			&& attachment.scaleMultiplier > 0
			? attachment.scaleMultiplier
			: 1;

		return {
			assetId: attachment.assetId,
			world: normalizeGeodeticShape( attachment.world, `attachments[${index}].world` ),
			anchorMode,
			yawDeg,
			scaleMultiplier,
			info: normalizeAttachmentInfo( attachment.info )
		};
	} );

}

async function enrichDemoModelConfigAttachments(
	config: RawDemoModelConfig
): Promise<RawDemoModelConfig> {

	const attachmentsUrl = resolveAttachmentsUrl( config );
	if ( attachmentsUrl === undefined ) {
		return config;
	}

	const externalAttachments = await loadExternalAttachments( attachmentsUrl );
	if ( externalAttachments.length === 0 ) {
		return {
			...config,
			attachments: [ ...( config.attachments ?? [] ) ]
		};
	}

	return {
		...config,
		attachments: [ ...( config.attachments ?? [] ), ...externalAttachments ]
	};

}

function resolveAttachmentsUrl(config: RawDemoModelConfig): string | undefined {

	const candidate = 'attachmentsUrl' in config ? config.attachmentsUrl : undefined;
	return typeof candidate === 'string' && candidate.trim().length > 0
		? candidate.trim()
		: undefined;

}

async function loadExternalAttachments(
	url: string
): Promise<RawDemoModelAttachmentShape[]> {

	const response = await fetch( url );
	if ( response.ok === false ) {
		throw new Error( `Failed to load attachments config: HTTP ${response.status} (${url})` );
	}

	const parsed = await response.json() as RawAttachmentCollection;
	const attachments = Array.isArray( parsed )
		? parsed
		: Array.isArray( parsed.attachments )
			? parsed.attachments
			: null;

	if ( attachments === null ) {
		throw new Error( `Attachments config must be an array or an object with attachments[]. (${url})` );
	}

	return attachments;

}

function normalizeAttachmentInfo(info: DemoModelAttachmentInfo | undefined): DemoModelAttachmentInfo | undefined {

	if ( info === undefined ) {
		return undefined;
	}

	const normalizedInfo: DemoModelAttachmentInfo = {};

	const title = normalizeOptionalAttachmentText( info.title );
	if ( title !== undefined ) {
		normalizedInfo.title = title;
	}

	const code = normalizeOptionalAttachmentText( info.code );
	if ( code !== undefined ) {
		normalizedInfo.code = code;
	}

	const type = normalizeOptionalAttachmentText( info.type );
	if ( type !== undefined ) {
		normalizedInfo.type = type;
	}

	const status = normalizeOptionalAttachmentText( info.status );
	if ( status !== undefined ) {
		normalizedInfo.status = status;
	}

	const remark = normalizeOptionalAttachmentText( info.remark );
	if ( remark !== undefined ) {
		normalizedInfo.remark = remark;
	}

	if ( Object.keys( normalizedInfo ).length === 0 ) {
		return undefined;
	}

	return normalizedInfo;

}

function normalizeOptionalAttachmentText(value: string | undefined): string | undefined {

	if ( typeof value !== 'string' ) {
		return undefined;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;

}

function normalizeMarkerEnu(
	enu: MarkerEngineeringConfig['enu'] | number[] | undefined,
	label: string
): MarkerEngineeringConfig['enu'] | undefined {

	if ( enu === undefined ) {
		return undefined;
	}

	if ( Array.isArray( enu ) ) {
		const tuple = normalizeEnuTuple( enu );
		if ( tuple === undefined ) {
			throw new Error( `${label} tuple must contain finite east/north/up values.` );
		}

		return {
			east: tuple[ 0 ],
			north: tuple[ 1 ],
			up: tuple[ 2 ]
		};
	}

	if (
		typeof enu.east !== 'number'
		|| Number.isFinite( enu.east ) === false
		|| typeof enu.north !== 'number'
		|| Number.isFinite( enu.north ) === false
	) {
		throw new Error( `${label} must include finite east/north values.` );
	}

	const up = typeof enu.up === 'number' && Number.isFinite( enu.up )
		? enu.up
		: 0;

	return {
		east: enu.east,
		north: enu.north,
		up
	};

}

function normalizeMarkerSizeMeters(marker: RawMarkerEngineeringConfig): number | undefined {

	const size = typeof marker.sizeMeters === 'number'
		? marker.sizeMeters
		: marker.trackingWidthMeters;
	return typeof size === 'number' && Number.isFinite( size ) && size > 0
		? size
		: undefined;

}

function createConfigDebugPayload(configUrl: string, config: DemoModelConfig): Record<string, unknown> {

	return {
		modelId: config.modelId,
		configUrl,
		siteFrameOriginLoaded: typeof config.siteFrame.origin.lat === 'number' && typeof config.siteFrame.origin.lon === 'number',
		controlTargetCount: config.controlTargets.length,
		markersCount: config.markers.length,
		cornersEnuValid: config.controlTargets.map( ( target ) => ( {
			id: target.id,
			hasCornersEnu: normalizeCornersEnu( target.cornersEnu ) !== undefined
		} ) )
	};

}

function isControlPointCorrespondence(
	point:
		| DemoModelControlPointCorrespondence
		| LegacyControlPointShape
		| {
			modelLocal: DemoModelLocalPoint;
			world: RawGeodeticCoordinateShape;
		}
): point is DemoModelControlPointCorrespondence {

	return 'modelLocal' in point && 'world' in point;

}

function isLocalDebugModelConfig(config: RawDemoModelConfig): config is LocalDebugModelConfig {

	return 'siteId' in config
		&& typeof config.siteId === 'string'
		&& 'origin' in config
		&& typeof config.origin === 'object'
		&& config.origin !== null;

}

function normalizeLocalDebugOrigin(origin: LocalDebugOriginShape): GeodeticCoordinate {

	if ( typeof origin.lat !== 'number' || typeof origin.lng !== 'number' ) {
		throw new Error( 'Debug site config is missing a valid origin lat/lng.' );
	}

	const altitude = typeof origin.height === 'number'
		? origin.height
		: typeof origin.alt === 'number'
			? origin.alt
			: 0;

	return convertGeodeticToWgs84( {
		lat: origin.lat,
		lon: origin.lng,
		alt: altitude
	}, origin.coordType );

}

function normalizeGeodeticShape(
	coordinate: RawGeodeticCoordinateShape,
	label: string
): GeodeticCoordinate {

	if ( typeof coordinate.lat !== 'number' ) {
		throw new Error( `${label} is missing a valid latitude.` );
	}

	const longitude = typeof coordinate.lon === 'number'
		? coordinate.lon
		: typeof coordinate.lng === 'number'
			? coordinate.lng
			: null;
	if ( longitude === null ) {
		throw new Error( `${label} is missing a valid longitude.` );
	}

	const altitude = typeof coordinate.alt === 'number'
		? coordinate.alt
		: typeof coordinate.height === 'number'
			? coordinate.height
			: 0;

	return convertGeodeticToWgs84( {
		lat: coordinate.lat,
		lon: longitude,
		alt: altitude
	}, coordinate.coordType );

}

function normalizePointLike(point: PointLike, label: string): DemoModelLocalPoint {

	if ( Array.isArray( point ) ) {
		if ( point.length < 3 || point.slice( 0, 3 ).some( ( value ) => typeof value !== 'number' ) ) {
			throw new Error( `Debug site point ${label} must contain three numeric entries.` );
		}

		return {
			x: point[ 0 ],
			y: point[ 1 ],
			z: point[ 2 ]
		};
	}

	if (
		typeof point === 'object'
		&& point !== null
		&& typeof point.x === 'number'
		&& typeof point.y === 'number'
		&& typeof point.z === 'number'
	) {
		return {
			x: point.x,
			y: point.y,
			z: point.z
		};
	}

	throw new Error( `Debug site point ${label} is invalid.` );

}

function synthesizeWorldControlPoint(
	localPoint: DemoModelLocalPoint,
	anchor: GeodeticCoordinate,
	yawDeg: number,
	scale: number
): GeodeticCoordinate {

	const yawRad = yawDeg * Math.PI / 180;
	const scaledX = localPoint.x * scale;
	const scaledY = localPoint.y * scale;
	const scaledZ = localPoint.z * scale;
	const eastMeters = scaledX * Math.cos( yawRad ) - scaledZ * Math.sin( yawRad );
	const northMeters = scaledX * Math.sin( yawRad ) + scaledZ * Math.cos( yawRad );
	const metersPerLat = 111320;
	const metersPerLon = 111320 * Math.cos( anchor.lat * Math.PI / 180 );

	return {
		lat: anchor.lat + northMeters / metersPerLat,
		lon: anchor.lon + eastMeters / metersPerLon,
		alt: anchor.alt + scaledY
	};

}

function synthesizeLocalDebugAnchorWorldPoint(
	anchorModelLocal: DemoModelLocalPoint,
	localPoint: DemoModelLocalPoint,
	anchor: GeodeticCoordinate,
	yawDeg: number,
	scale: number
): GeodeticCoordinate {

	const localDeltaX = ( localPoint.x - anchorModelLocal.x ) * scale;
	const localDeltaY = ( localPoint.y - anchorModelLocal.y ) * scale;
	const localDeltaNorth = - ( localPoint.z - anchorModelLocal.z ) * scale;
	const yawRad = yawDeg * Math.PI / 180;
	const eastMeters = localDeltaX * Math.cos( yawRad ) - localDeltaNorth * Math.sin( yawRad );
	const northMeters = localDeltaX * Math.sin( yawRad ) + localDeltaNorth * Math.cos( yawRad );

	return enuToGeodetic(
		new THREE.Vector3( eastMeters, northMeters, localDeltaY ),
		anchor
	);

}



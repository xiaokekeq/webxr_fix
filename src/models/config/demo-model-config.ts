import * as THREE from 'three';
import type { SetStatus } from '@/features/ar/types/runtime-types.js';
import {
	enuToGeodetic,
	type GeodeticCoordinate
} from '@/localization/core/geodesy.js';
import { convertGeodeticToWgs84 } from '@/localization/core/coordinate-systems.js';
import type { RtkSurveyDataset } from '@/localization/rtk/rtk-survey-dataset.js';
import type { VisualControlTarget } from '@/localization/baseline/site-calibration-baseline.js';

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

export type DemoModelRegistrationMode = 'rigid' | 'similarity';

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
	visualGroundOffsetMeters: number;
	undergroundObjects?: unknown[];
	sensors?: unknown[];
	riskPoints?: unknown[];
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
	visualGroundOffsetMeters?: number;
	undergroundObjects?: unknown[];
	sensors?: unknown[];
	riskPoints?: unknown[];
}

interface LegacyDemoModelConfig extends Omit<DemoModelConfig, 'siteFrame' | 'registration' | 'controlPoints' | 'markers' | 'attachments' | 'controlTargets' | 'visualGroundOffsetMeters'> {
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
	visualGroundOffsetMeters?: number;
	undergroundObjects?: unknown[];
	sensors?: unknown[];
	riskPoints?: unknown[];
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
		console.info( '[DemoModelConfigLoaded]', createConfigDebugPayload( url, normalized ) );
		console.info( '[Demo Model Config]', normalized );

		return normalized;
	} catch ( error ) {
		console.error( '[DemoModelConfigParseFailed]', {
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
		mode: 'similarity',
		minControlPoints: 3
	};

	const normalizedControlPoints: Record<string, DemoModelControlPointCorrespondence> = {};

	for ( const [ id, point ] of Object.entries( config.controlPoints ) ) {
		if ( isControlPointCorrespondence( point ) ) {
			normalizedControlPoints[ id ] = {
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
		visualGroundOffsetMeters: normalizeVisualGroundOffsetMeters( config.visualGroundOffsetMeters ),
		undergroundObjects: Array.isArray( config.undergroundObjects ) ? config.undergroundObjects : [],
		sensors: Array.isArray( config.sensors ) ? config.sensors : [],
		riskPoints: Array.isArray( config.riskPoints ) ? config.riskPoints : [],
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
			// Local debug configs usually represent a single surveyed anchor point.
			// Keep scale fixed and only solve rigid placement around that anchor.
			mode: 'rigid',
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
		visualGroundOffsetMeters: normalizeVisualGroundOffsetMeters( config.visualGroundOffsetMeters ),
		undergroundObjects: Array.isArray( config.undergroundObjects ) ? config.undergroundObjects : [],
		sensors: Array.isArray( config.sensors ) ? config.sensors : [],
		riskPoints: Array.isArray( config.riskPoints ) ? config.riskPoints : [],
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

	if ( config.registration.mode !== 'rigid' && config.registration.mode !== 'similarity' ) {
		throw new Error( 'registration.mode must be "rigid" or "similarity".' );
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
		console.info( '[RtkSurveyDatasetLoaded]', {
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

	console.info( '[RtkSurveyDatasetLoaded]', {
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

	console.info( '[SiteConfigControlTargetsResolved]', {
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

		const centerEnu = normalizeEnuTuple( target.centerEnu );
		if ( centerEnu === undefined ) {
			console.warn( '[RtkSurveyControlTargetResolved]', {
				targetId: target.id,
				resolved: false,
				reason: `controlTargets[${index}].centerEnu missing`,
				createdAt: Date.now()
			} );
			return [];
		}

		console.info( '[RtkSurveyControlTargetResolved]', {
			targetId: target.id,
			resolved: true,
			hasCornersEnu: normalizeCornersEnu( target.cornersEnu ) !== undefined,
			createdAt: Date.now()
		} );

		return [ {
			...target,
			id: target.id.trim(),
			centerEnu,
			cornersEnu: normalizeCornersEnu( target.cornersEnu ),
			yawDeg: typeof target.yawDeg === 'number' && Number.isFinite( target.yawDeg ) ? target.yawDeg : undefined,
			sizeMeters: typeof target.sizeMeters === 'number' && Number.isFinite( target.sizeMeters ) ? target.sizeMeters : undefined,
			plane: target.plane === 'vertical' ? 'vertical' : 'horizontal'
		} ];
	} );

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

function normalizeVisualGroundOffsetMeters(value: number | undefined): number {

	return typeof value === 'number' && Number.isFinite( value ) ? value : 0;

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



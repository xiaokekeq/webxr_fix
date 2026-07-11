import type { PipeRecord } from '@/models/types/pipe-record.js';
import type { ModelCatalogItem } from '@/models/catalog/model-api.js';
import type { ArWorkflowMode } from '@/features/ar/types/workflow.js';

export type WorkspaceMode = 'browse' | 'registration' | 'inspection';
export type AppMode = 'pre-ar' | 'ar-session';
export type ArSupportState = 'checking' | 'supported' | 'unsupported';
export type ArSessionPhase = 'scanning' | 'ready-to-place' | 'placing' | 'placed';
export type InspectionPlacementSource = 'manual-marker';
export type ArDisplayMode =
	| 'solid-overlay'
	| 'transparent-xray'
	| 'underground-portal'
	| 'layer-peeling'
	| 'section-cut';
export type SectionCutPlaneMode = 'cross-section' | 'longitudinal-section' | 'horizontal-section';

export interface ManualMarker {
	markerId: string;
	name: string;
	modelUrl: string;
	controlPoint?: {
		x: number;
		y: number;
		z: number;
		coordinateSystem?: string;
	};
	defaultTransform?: {
		position: [ number, number, number ];
		rotation: [ number, number, number ];
		scale: [ number, number, number ];
	};
}

export interface PropertyPanelState {
	name: string;
	meshName?: string;
	materialName?: string;
	statusBadge: string;
	type: string;
	diameter: string;
	material: string;
	depth: string;
	status: string;
	remark: string;
}

export interface RegistrationMetricsState {
	gpsText: string;
	enuText: string;
	rmsText: string;
	rmsErrorMeters: number | null;
	rmsSource: 'none' | 'engineering' | 'marker';
}

export interface ModelScaleSummaryState {
	modeText: string;
	unitScaleText: string;
	originalBoundsText: string;
	finalBoundsText: string;
	pivotOffsetText: string;
}

export interface RegistrationChainDebugState {
	engineeringControlRegistration: {
		available: boolean;
		controlPointCount: number;
		rmsText: string;
		usesUnitScaleAndPivotOffset: boolean;
	};
	arSessionLocalization: {
		available: boolean;
		source: string;
		siteOriginArPositionText: string;
		headingDegText: string;
	};
	heightPolicy: {
		hitTestGroundYEnabled: boolean;
		enuGpsVerticalOffsetEnabled: boolean;
	};
	markerEngineering: {
		markerCount: number;
		markers: Array<{
			markerId: string;
			bindControlPointId: string;
			sizeMetersText: string;
			resolved: boolean;
		}>;
	};
}

export interface FootprintDiagnosticsState {
	groundPlaneSelfCheckText: string;
	markerToFootprintDistanceText: string;
	markerToFootprintHeadingText: string;
	markerToFootprintHeadingCheckText: string;
	modelControlPointPlacementText: string;
	modelControlPointOrderText: string;
	modelLocalFootprintText: string;
	undergroundDisplayText: string;
	modelAxisText: string;
	footprintShapeText: string;
	footprintControlPointIdsText: string;
	enuUsageText: string;
	physicalRelationText: string;
	markerPhysicalText: string;
	verdictText: string;
	updatedAtText: string;
}

export interface DebugVector3 {
	x: number;
	y: number;
	z: number;
}

export interface DebugScreenPoint {
	x: number;
	y: number;
	visible: boolean;
}

export interface ModelPlacementDebugState {
	sessionId?: string | null;
	buildCommit?: string | null;
	updatedAt?: number;
	diagnosticSampleCount?: number;
	undergroundPlacementMode?: 'surface' | 'rtk-derived-elevation';
	undergroundMode?: string;
	modelHeightSource?: 'override' | 'normalized-bbox-y' | 'placeable-report-y' | 'bbox-y' | 'y' | 'shortest-edge' | 'none' | 'invalid';
	modelHeight?: number | null;
	coverDepthMeters?: number;
	totalBottomDepthMeters?: number;
	engineeringUndergroundOffsetY?: number;
	surfaceElevationText?: string;
	undergroundElevationText?: string;
	depthMeters?: number;
	xrayOpacity?: number;
	engineeringHorizontalRms?: number;
	engineeringVerticalMax?: number;
	surfaceProjectionHorizontalRms?: number;
	bottomDepthErrorMax?: number;
	initialModelWorldPosition?: { x: number; y: number; z: number };
	currentModelWorldPosition?: { x: number; y: number; z: number };
	modelWorldDeltaXZ?: number;
	modelWorldDeltaY?: number;
	arModelAnchorWorldDeltaXZ?: number;
	arModelAnchorWorldDeltaY?: number;
	arPlacementAnchorWorldDeltaXZ?: number;
	arPlacementAnchorWorldDeltaY?: number;
	initialCameraWorldPosition?: { x: number; y: number; z: number };
	currentCameraWorldPosition?: { x: number; y: number; z: number };
	cameraMovedDistance?: number;
	cameraToModelDistanceInitial?: number;
	cameraToModelDistanceCurrent?: number;
	cameraToModelDistance?: number;
	cameraToModelDistanceDelta?: number;
	isWorldLocked?: boolean | null;
	worldLockStatus?: 'unknown' | 'normal' | 'warning' | 'error';
	modelParentName?: string;
	arModelAnchorParentName?: string;
	arPlacementAnchorParentName?: string;
	placedModelParentChain?: string[];
	modelAnchorParentChain?: string[];
	placementAnchorParentChain?: string[];
	arModelAnchorParentChain?: string[];
	arPlacementAnchorParentChain?: string[];
	reticleParentChain?: string[];
	cameraParentChain?: string[];
	unexpectedArModelAnchorParent?: boolean;
	isArModelAnchorChildOfPlacementAnchor?: boolean;
	isPlacedModelChildOfPlacementAnchor?: boolean;
	isArModelAnchorChildOfCamera?: boolean;
	isArModelAnchorChildOfReticle?: boolean;
	isArModelAnchorChildOfScene?: boolean;
	isModelChildOfCamera?: boolean;
	isModelChildOfReticle?: boolean;
	isModelChildOfPlacementAnchor?: boolean;
	isModelAnchorChildOfScene?: boolean;
	isPlacementAnchorChildOfScene?: boolean;
	placementAnchorUpdateCount?: number;
	lastPlacementAnchorUpdateReason?: string;
	updatedPlacementAnchorFromFrameLoop?: boolean;
	engineeringMatrixChanged?: boolean;
	placedModelMatrixWorldChanged?: boolean;
	arModelAnchorMatrixWorldChanged?: boolean;
	arPlacementAnchorMatrixWorldChanged?: boolean;
	modelAnchorMatrixWorldChanged?: boolean;
	placementAnchorMatrixWorldChanged?: boolean;
	arFromEnuMatrixChanged?: boolean;
	modelHeightX?: number;
	modelHeightY?: number;
	modelHeightZ?: number;
	chosenModelHeight?: number;
	modelHeightToYDifferenceMeters?: number | null;
	modelHeightAxis?: 'y' | 'shortest-edge' | 'bbox-y';
	modelSizeX?: number;
	modelSizeY?: number;
	modelSizeZ?: number;
	placedModelInitialWorld?: DebugVector3;
	placedModelCurrentWorld?: DebugVector3;
	placedModelDeltaX?: number;
	placedModelDeltaY?: number;
	placedModelDeltaZ?: number;
	placedModelDeltaXZ?: number;
	modelAnchorInitialWorld?: DebugVector3;
	modelAnchorCurrentWorld?: DebugVector3;
	modelAnchorDeltaX?: number;
	modelAnchorDeltaY?: number;
	modelAnchorDeltaZ?: number;
	modelAnchorDeltaXZ?: number;
	placementAnchorInitialWorld?: DebugVector3;
	placementAnchorCurrentWorld?: DebugVector3;
	placementAnchorDeltaX?: number;
	placementAnchorDeltaY?: number;
	placementAnchorDeltaZ?: number;
	placementAnchorDeltaXZ?: number;
	cameraInitialWorld?: DebugVector3;
	cameraCurrentWorld?: DebugVector3;
	yellowSurfaceCenterWorld?: { x: number; y: number; z: number };
	purpleEngineeringCenterWorld?: { x: number; y: number; z: number };
	undergroundExpectedCenterWorld?: { x: number; y: number; z: number };
	yellowSurfaceDeltaXZ?: number;
	yellowSurfaceDeltaY?: number;
	purpleEngineeringDeltaXZ?: number;
	purpleEngineeringDeltaY?: number;
	undergroundExpectedDeltaXZ?: number;
	undergroundExpectedDeltaY?: number;
	yellowCenterInitialWorld?: DebugVector3;
	yellowCenterCurrentWorld?: DebugVector3;
	yellowWorldDeltaXZ?: number;
	yellowWorldDeltaY?: number;
	yellowScreenInitial?: DebugScreenPoint;
	yellowScreenCurrent?: DebugScreenPoint;
	yellowScreenDeltaPx?: number;
	purpleEngineeringCenterInitialWorld?: DebugVector3;
	purpleEngineeringCenterCurrentWorld?: DebugVector3;
	purpleEngineeringWorldDeltaXZ?: number;
	purpleEngineeringWorldDeltaY?: number;
	purpleEngineeringScreenDeltaPx?: number;
	undergroundExpectedCenterInitialWorld?: DebugVector3;
	undergroundExpectedCenterCurrentWorld?: DebugVector3;
	undergroundExpectedWorldDeltaXZ?: number;
	undergroundExpectedWorldDeltaY?: number;
	undergroundExpectedScreenDeltaPx?: number;
	currentModelActualCenterWorld?: DebugVector3;
	currentModelActualWorldDeltaXZ?: number;
	currentModelActualWorldDeltaY?: number;
	yellowUpdateCount?: number;
	purpleEngineeringUpdateCount?: number;
	undergroundExpectedUpdateCount?: number;
	currentModelActualUpdateCount?: number;
	yellowLastUpdateReason?: string;
	purpleEngineeringLastUpdateReason?: string;
	undergroundExpectedLastUpdateReason?: string;
	currentModelActualLastUpdateReason?: string;
	purpleDiagnosticsUpdatedInFrameLoop?: boolean;
	engineeringMinusYellowXZ?: number;
	engineeringMinusYellowY?: number;
	undergroundMinusYellowXZ?: number;
	undergroundMinusYellowY?: number;
	undergroundMinusEngineeringXZ?: number;
	undergroundMinusEngineeringY?: number;
	yellowToUndergroundScreenDistanceInitialPx?: number;
	yellowToUndergroundScreenDistanceCurrentPx?: number;
	yellowToUndergroundScreenDistanceDeltaPx?: number;
	engineeringMatrixTranslationDelta?: number;
	placedModelMatrixTranslationDelta?: number;
	engineeringMatrixElements?: number[];
	placedModelMatrixWorldElements?: number[];
	modelAnchorMatrixWorldElements?: number[];
	placementAnchorMatrixWorldElements?: number[];
	arFromEnuMatrixElements?: number[];
	engineeringPlacementCallCount?: number;
	lastPlacementReason?: string;
	lastPlacementTimestamp?: number;
	replacedModelCount?: number;
	hasExistingPlacedModel?: boolean;
	calledFromFrameLoop?: boolean;
	calledFromHitTest?: boolean;
	calledFromButton?: boolean;
	lastPlacementAnchorUpdateTimestamp?: number;
	placementAnchorUpdatedFromFrameLoop?: boolean;
	placementAnchorUpdatedFromHitTest?: boolean;
	placementAnchorUpdatedFromReticle?: boolean;
	parallaxStatus?: 'unknown' | 'likely-parallax' | 'real-world-movement' | 'matrix-space-error';
	conclusion?: string;
}

export interface SiteCalibrationBaselineState {
	available: boolean;
	siteId?: string;
	source?: string;
	statusText: string;
	controlTargetCount: number;
	updatedAtText: string;
}

export interface EngineeringConfigStatusState {
	hasSiteOrigin: boolean;
	hasModelLocalToEnu: boolean;
	hasRtkSurveyDataset: boolean;
	hasControlTargets: boolean;
	hasPlacementAnchor: boolean;
	activeControlTargetHasCornersEnu: boolean;
	hasMockEngineeringData: boolean;
	modelLocalToEnuSource: 'explicit' | 'control-points' | 'missing';
	modelLocalToEnuText: string;
	controlTargetCount: number;
	activeControlTargetId?: string;
	activeControlTargetName?: string;
	controlTargetSource: 'site-config' | 'baseline' | 'none';
	controlTargetSourceText: string;
	engineeringDataSourceText: string;
	mockWarningText: string;
	rtkCoordinateSystemText: string;
	mockRtkPointIds: string[];
	recommendedFieldHints: string[];
	registrationModeText: string;
	modelToSiteScaleText: string;
	baselineMismatch: boolean;
	rtkPointCount: number;
	undergroundObjectCount: number;
	sensorCount: number;
	riskPointCount: number;
	annotationCount: number;
	siteOriginText: string;
	placementAnchorText: string;
	controlTargetSummaries: Array<{
		id: string;
		name: string;
		centerEnuText: string;
		cornersEnuText: string;
		cornerOrderText: string;
		yawDegText: string;
		sizeMetersText: string;
		planeText: string;
	}>;
}

export interface SavedMarkerLocalizationState {
	available: boolean;
	markerId?: string;
	markerConfigId?: string;
	timestamp?: number;
	ageSeconds?: number;
	rmsErrorMeters?: number;
	sampleCount?: number;
	headingDeg?: number;
	siteOriginArPosition?: { x: number; y: number; z: number };
	stable?: boolean;
}

export interface MarkerCalibrationCornerState {
	id: string;
	label: string;
	positionText: string;
}

export interface MarkerCalibrationState {
	currentSessionId: string | null;
	debugOnlySavedResultAvailable: boolean;
	markerId: string | null;
	markerConfigId: string | null;
	active: boolean;
	capturedCornerCount: number;
	expectedCornerCount: number;
	nextCornerLabel: string;
	corners: MarkerCalibrationCornerState[];
	canCapture: boolean;
	canSolve: boolean;
	solved: boolean;
	applied: boolean;
	rmsErrorMeters?: number;
	headingDeg?: number;
	looseThresholdAccepted?: boolean;
	lastUpdatedAt?: number;
}

export interface PlacementSummaryState {
	positionText: string;
	quaternionText: string;
	scaleText: string;
}

export interface ModelLayerState {
	id: string;
	label: string;
	visible: boolean;
	opacity: number;
	orderIndex: number;
}

export interface TargetGuidanceState {
	visible: boolean;
	directionText: string;
	distanceText: string;
	detailText: string;
	alignment: 'left' | 'center' | 'right';
}

export interface AnnotationDetailField {
	label: string;
	value: string;
}

export interface AnnotationDetailState {
	visible: boolean;
	title: string;
	subtitle: string;
	fields: AnnotationDetailField[];
}

export interface RegistrationStoreState {
	projectName: string;
	modelUrl: string;
	availableModels: ModelCatalogItem[];
	selectedModelId: string;
	workflowMode: ArWorkflowMode;
	appMode: AppMode;
	arSupportState: ArSupportState;
	arSupportMessage: string;
	arSessionPhase: ArSessionPhase;
	workspaceMode: WorkspaceMode;
	displayMode: ArDisplayMode;
	structureRevealValue: number;
	transparentXrayValue: number;
	layerPeelingValue: number;
	sectionCutValue: number;
	sectionCutPlaneMode: SectionCutPlaneMode;
	timelineStages: readonly string[];
	currentTimelineStageIndex: number;
	layerNames: readonly string[];
	modelLayers: ModelLayerState[];
	pipeList: PipeRecord[];
	propertyPanel: PropertyPanelState;
	selectedAnnotationId: string | null;
	inspectionPlacementSource: InspectionPlacementSource;
	registrationMetrics: RegistrationMetricsState;
	modelScaleSummary: ModelScaleSummaryState;
	registrationChainDebug: RegistrationChainDebugState;
	footprintDiagnostics: FootprintDiagnosticsState;
	modelPlacementDebug: ModelPlacementDebugState;
	siteCalibrationBaseline: SiteCalibrationBaselineState;
	engineeringConfigStatus: EngineeringConfigStatusState;
	savedMarkerLocalization: SavedMarkerLocalizationState;
	markerCalibration: MarkerCalibrationState;
	placementSummary: PlacementSummaryState;
	targetGuidance: TargetGuidanceState;
	annotationDetail: AnnotationDetailState;
	registrationStatusDetail: string;
	runtimeStatus: string;
	logMessages: string[];
}

type RegistrationStoreListener = (state: RegistrationStoreState) => void;

export interface RegistrationStore {
	getState(): RegistrationStoreState;
	patch(partialState: Partial<RegistrationStoreState>): void;
	setModelPlacementDebug(state: ModelPlacementDebugState): void;
	patchModelPlacementDebug(partial: Partial<ModelPlacementDebugState>): void;
	clearModelPlacementDebug(): void;
	subscribe(listener: RegistrationStoreListener): () => void;
}

export function createRegistrationStore(
	initialState: RegistrationStoreState
): RegistrationStore {

	let state = initialState;
	const listeners = new Set<RegistrationStoreListener>();

	return {
		getState() {

			return state;

		},
		patch(partialState) {

			state = {
				...state,
				...partialState
			};
			listeners.forEach( ( listener ) => {
				listener( state );
			} );

		},
		setModelPlacementDebug(modelPlacementDebug) {

			state = { ...state, modelPlacementDebug };
			listeners.forEach( ( listener ) => listener( state ) );

		},
		patchModelPlacementDebug(partial) {

			state = {
				...state,
				modelPlacementDebug: { ...state.modelPlacementDebug, ...partial }
			};
			listeners.forEach( ( listener ) => listener( state ) );

		},
		clearModelPlacementDebug() {

			state = { ...state, modelPlacementDebug: createDefaultModelPlacementDebugState() };
			listeners.forEach( ( listener ) => listener( state ) );

		},
		subscribe(listener) {

			listeners.add( listener );
			return () => {
				listeners.delete( listener );
			};

		}
	};

}

export function createDefaultPropertyPanelState(): PropertyPanelState {

	return {
		name: '未选择构件',
		statusBadge: '待选择',
		type: '-',
		diameter: '-',
		material: '-',
		depth: '-',
		status: '-',
		remark: '点击模型构件后可查看属性、位置和备注信息。'
	};

}

export function createDefaultRegistrationMetricsState(): RegistrationMetricsState {

	return {
		gpsText: '-',
		enuText: '-',
		rmsText: '-',
		rmsErrorMeters: null,
		rmsSource: 'none'
	};

}

export function createDefaultModelScaleSummaryState(): ModelScaleSummaryState {

	return {
		modeText: '真实米制',
		unitScaleText: '1.000',
		originalBoundsText: '-',
		finalBoundsText: '-',
		pivotOffsetText: '-'
	};

}

export function createDefaultAnnotationDetailState(): AnnotationDetailState {

	return {
		visible: false,
		title: '',
		subtitle: '',
		fields: []
	};

}

export function createDefaultRegistrationChainDebugState(): RegistrationChainDebugState {

	return {
		engineeringControlRegistration: {
			available: false,
			controlPointCount: 0,
			rmsText: '-',
			usesUnitScaleAndPivotOffset: false
		},
		arSessionLocalization: {
			available: false,
			source: 'unknown',
			siteOriginArPositionText: '-',
			headingDegText: '-'
		},
		heightPolicy: {
			hitTestGroundYEnabled: true,
			enuGpsVerticalOffsetEnabled: false
		},
		markerEngineering: {
			markerCount: 0,
			markers: []
		}
	};

}

export function createDefaultFootprintDiagnosticsState(): FootprintDiagnosticsState {

	return {
		groundPlaneSelfCheckText: '-',
		markerToFootprintDistanceText: '-',
		markerToFootprintHeadingText: '-',
		markerToFootprintHeadingCheckText: '-',
		modelControlPointPlacementText: '-',
		modelControlPointOrderText: '-',
		modelLocalFootprintText: '-',
		undergroundDisplayText: '-',
		modelAxisText: '-',
		footprintShapeText: '-',
		footprintControlPointIdsText: '-',
		enuUsageText: '-',
		physicalRelationText: '-',
		markerPhysicalText: '-',
		verdictText: '等待 Marker 校正',
		updatedAtText: '-'
	};

}

export function createDefaultModelPlacementDebugState(): ModelPlacementDebugState {

	return {
		modelHeightSource: 'none',
		modelHeight: null,
		depthMeters: 0,
		isWorldLocked: null,
		worldLockStatus: 'unknown',
		engineeringPlacementCallCount: 0,
		replacedModelCount: 0,
		placementAnchorUpdateCount: 0,
		lastPlacementAnchorUpdateReason: 'none',
		updatedPlacementAnchorFromFrameLoop: false,
		hasExistingPlacedModel: false,
		conclusion: '等待工程放置模型'
	};

}

export function createDefaultSiteCalibrationBaselineState(): SiteCalibrationBaselineState {

	return {
		available: false,
		statusText: '未加载现场基准',
		controlTargetCount: 0,
		updatedAtText: '-'
	};

}

export function createDefaultEngineeringConfigStatusState(): EngineeringConfigStatusState {

	return {
		hasSiteOrigin: false,
		hasModelLocalToEnu: false,
		hasRtkSurveyDataset: false,
		hasControlTargets: false,
		hasPlacementAnchor: false,
		activeControlTargetHasCornersEnu: false,
		hasMockEngineeringData: false,
		modelLocalToEnuSource: 'missing',
		modelLocalToEnuText: '缺失',
		controlTargetCount: 0,
		controlTargetSource: 'none',
		controlTargetSourceText: '未加载控制标志',
		engineeringDataSourceText: 'none',
		mockWarningText: '',
		rtkCoordinateSystemText: '-',
		mockRtkPointIds: [],
		recommendedFieldHints: [],
		registrationModeText: '-',
		modelToSiteScaleText: '-',
		baselineMismatch: false,
		rtkPointCount: 0,
		undergroundObjectCount: 0,
		sensorCount: 0,
		riskPointCount: 0,
		annotationCount: 0,
		siteOriginText: '-',
		placementAnchorText: '-',
		controlTargetSummaries: []
	};

}

export function createDefaultPlacementSummaryState(): PlacementSummaryState {

	return {
		positionText: '-',
		quaternionText: '-',
		scaleText: '-'
	};

}

export function createDefaultSavedMarkerLocalizationState(): SavedMarkerLocalizationState {

	return {
		available: false
	};

}

export function createDefaultMarkerCalibrationState(): MarkerCalibrationState {

	return {
		currentSessionId: null,
		debugOnlySavedResultAvailable: false,
		markerId: null,
		markerConfigId: null,
		active: false,
		capturedCornerCount: 0,
		expectedCornerCount: 4,
		nextCornerLabel: '左上角',
		corners: [],
		canCapture: false,
		canSolve: false,
		solved: false,
		applied: false,
		looseThresholdAccepted: false
	};

}

export function createDefaultTargetGuidanceState(): TargetGuidanceState {

	return {
		visible: false,
		directionText: '',
		distanceText: '',
		detailText: '',
		alignment: 'center'
	};

}




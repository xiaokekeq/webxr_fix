import type { PipeRecord } from '@/models/types/pipe-record.js';
import type { ModelCatalogItem } from '@/models/catalog/model-api.js';
import type { ArWorkflowMode } from '@/features/ar/types/workflow.js';

export type WorkspaceMode = 'browse' | 'registration' | 'inspection';
export type AppMode = 'pre-ar' | 'ar-session';
export type ArSupportState = 'checking' | 'supported' | 'unsupported';
export type ArSessionPhase = 'scanning' | 'ready-to-place' | 'placing' | 'placed';
export type InspectionPlacementSource = 'manual-marker';
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

export interface SiteCalibrationBaselineState {
	available: boolean;
	siteId?: string;
	source?: string;
	statusText: string;
	controlTargetCount: number;
	updatedAtText: string;
}

export type ModelRuntimeLoadState = 'idle' | 'loading' | 'ready' | 'failed';

export interface ModelRuntimeStageState {
	state: ModelRuntimeLoadState;
	startedAt?: number;
	completedAt?: number;
	durationMs?: number;
	failureReason?: string;
	errorName?: string;
	errorMessage?: string;
}

export interface ModelRuntimeAssetState extends ModelRuntimeStageState {
	assetId: string;
	assetUrl: string;
	materialUrl?: string;
}

export interface ModelRuntimeLoadStatus {
	modelLoadRequestId: number;
	modelRuntimeLoadState: ModelRuntimeLoadState;
	modelRuntimeLoadStage?: string;
	modelRuntimeLoadFailureReason?: string;
	modelRuntimeLoadErrorMessage?: string;
	modelRuntimeLoadFailedAssetId?: string;
	modelRuntimeLoadFailedUrl?: string;
	modelCatalogState: ModelRuntimeStageState;
	pipeRecordsState: ModelRuntimeStageState;
	siteConfigLoadState: ModelRuntimeStageState;
	assetLoadState: ModelRuntimeStageState;
	terrainAssetState: ModelRuntimeStageState;
	stakeMarkerAssetState: ModelRuntimeStageState;
	registrationSolveState: ModelRuntimeStageState;
	modelTemplateComposeState: ModelRuntimeStageState;
	runtimeBundleState: ModelRuntimeStageState;
	assetStates: ModelRuntimeAssetState[];
	registrationControlPointCount: number;
	registrationRmsErrorMeters?: number;
	registrationMatrixFinite?: boolean;
	registrationMatrixInvertible?: boolean;
	modelTemplateRenderableCount: number;
}

export interface EngineeringConfigStatusState {
	configSource: 'active-runtime' | 'session-context' | 'none';
	activeRuntimeConfigReady: boolean;
	sessionContextConfigReady: boolean;
	registrationSolutionReady: boolean;
	modelTemplateReady: boolean;
	rtkDataAvailable: boolean;
	rtkRequiredForCurrentWorkflow: boolean;
	rawModelControlPointCount: number;
	normalizedModelControlTargetCount: number;
	requiredModelControlTargetCount: number;
	modelControlTargetIds: string[];
	modelControlTargetValidationState: 'ready' | 'missing' | 'invalid' | 'unknown';
	modelControlTargetFailureReason?: string;
	hasSiteOrigin: boolean;
	hasModelLocalToEnu: boolean;
	hasRtkSurveyDataset: boolean;
	hasControlTargets: boolean;
	hasPlacementAnchor: boolean;
	activeControlTargetHasCornersEnu: boolean;
	hasMockEngineeringData: boolean;
	modelLocalToEnuSource: 'explicit' | 'control-points' | 'waiting-runtime' | 'failed' | 'missing';
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

export interface MarkerCalibrationCornerState {
	id: string;
	label: string;
	positionText: string;
}

export interface MarkerCalibrationState {
	currentSessionId: string | null;
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
	markerApplyStage?: string;
	markerApplyResult?: 'success' | 'failure';
	markerApplyFailureReason?: string;
	markerApplyAttemptCount?: number;
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

/** Selected component data rendered by a DOM Overlay HUD, never by Three.js. */
export interface SelectedComponentState {
	componentId: string;
	displayName: string;
	properties: Record<string, unknown>;
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
	undergroundMaterialMode: 'solid' | 'xray';
	undergroundInspectionTool: 'complete' | 'layer-peeling' | 'section-cut';
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
	selectedComponent: SelectedComponentState | null;
	inspectionPlacementSource: InspectionPlacementSource;
	registrationMetrics: RegistrationMetricsState;
	modelScaleSummary: ModelScaleSummaryState;
	registrationChainDebug: RegistrationChainDebugState;
	modelRuntimeLoad: ModelRuntimeLoadStatus;
	siteCalibrationBaseline: SiteCalibrationBaselineState;
	engineeringConfigStatus: EngineeringConfigStatusState;
	markerCalibration: MarkerCalibrationState;
	placementSummary: PlacementSummaryState;
	targetGuidance: TargetGuidanceState;
	annotationDetail: AnnotationDetailState;
	registrationStatusDetail: string;
	runtimeStatus: string;
}

type RegistrationStoreListener = (state: RegistrationStoreState) => void;

export interface RegistrationStore {
	getState(): RegistrationStoreState;
	patch(partialState: Partial<RegistrationStoreState>): void;
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
		configSource: 'none',
		activeRuntimeConfigReady: false,
		sessionContextConfigReady: false,
		registrationSolutionReady: false,
		modelTemplateReady: false,
		rtkDataAvailable: false,
		rtkRequiredForCurrentWorkflow: false,
		rawModelControlPointCount: 0,
		normalizedModelControlTargetCount: 0,
		requiredModelControlTargetCount: 0,
		modelControlTargetIds: [],
		modelControlTargetValidationState: 'unknown',
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

export function createDefaultModelRuntimeLoadStatus(): ModelRuntimeLoadStatus {

	const idle: ModelRuntimeStageState = { state: 'idle' };
	return {
		modelLoadRequestId: 0,
		modelRuntimeLoadState: 'idle',
		modelCatalogState: { ...idle },
		pipeRecordsState: { ...idle },
		siteConfigLoadState: { ...idle },
		assetLoadState: { ...idle },
		terrainAssetState: { ...idle },
		stakeMarkerAssetState: { ...idle },
		registrationSolveState: { ...idle },
		modelTemplateComposeState: { ...idle },
		runtimeBundleState: { ...idle },
		assetStates: [],
		registrationControlPointCount: 0,
		modelTemplateRenderableCount: 0
	};

}

export function createDefaultPlacementSummaryState(): PlacementSummaryState {

	return {
		positionText: '-',
		quaternionText: '-',
		scaleText: '-'
	};

}

export function createDefaultMarkerCalibrationState(): MarkerCalibrationState {

	return {
		currentSessionId: null,
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
		markerApplyAttemptCount: 0,
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




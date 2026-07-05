import type { PipeRecord } from '@/models/types/pipe-record.js';
import type { ModelCatalogItem } from '@/models/catalog/model-api.js';
import type { ManualAdjustmentPreset } from '@/localization/manual/manual-registration.js';
import type { ArWorkflowMode } from '@/features/ar/types/workflow.js';

export type WorkspaceMode = 'browse' | 'registration' | 'inspection';
export type AppMode = 'pre-ar' | 'ar-session';
export type ArSupportState = 'checking' | 'supported' | 'unsupported';
export type ArSessionPhase = 'scanning' | 'ready-to-place' | 'placing' | 'placed';
export type ArPlacementMode = 'localized' | 'hit-test-temporary';
export type InspectionPlacementSource = 'marker-auto' | 'plane-hit-test';
export type MarkerAutoImageUiState =
	| 'idle'
	| 'preparing-tracked-images'
	| 'tracked-images-ready'
	| 'image-tracking-requested'
	| 'image-tracking-unsupported'
	| 'image-tracking-api-missing'
	| 'tracked-images-empty'
	| 'image-load-failed'
	| 'waiting-for-marker'
	| 'marker-observed'
	| 'marker-stabilizing'
	| 'width-mismatch-warning'
	| 'localization-applied'
	| 'fallback-manual';
export type ArDisplayMode =
	| 'solid-overlay'
	| 'transparent-xray'
	| 'layer-peeling'
	| 'section-cut';
export type SectionCutPlaneMode = 'cross-section' | 'longitudinal-section' | 'horizontal-section';

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

export interface ManualReadoutState {
	positionText: string;
	yawText: string;
	scaleText: string;
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
	manualArSitePose: {
		exists: boolean;
		rootSiteEnuText: string;
		restored: boolean;
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

export interface EngineeringConfigStatusState {
	hasSiteOrigin: boolean;
	hasModelLocalToEnu: boolean;
	hasRtkSurveyDataset: boolean;
	hasControlTargets: boolean;
	hasPlacementAnchor: boolean;
	controlTargetCount: number;
	activeControlTargetId?: string;
	controlTargetSource: 'site-config' | 'baseline' | 'none';
	controlTargetSourceText: string;
	baselineMismatch: boolean;
	rtkPointCount: number;
	undergroundObjectCount: number;
	sensorCount: number;
	riskPointCount: number;
	markerImageReady: boolean;
	markerImageIssue?: string;
	siteOriginText: string;
	placementAnchorText: string;
	controlTargetSummaries: Array<{
		id: string;
		name: string;
		imageUrl: string;
		centerEnuText: string;
		cornersEnuText: string;
		yawDegText: string;
		sizeMetersText: string;
		trackingWidthMetersText: string;
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
	lastUpdatedAt?: number;
}

export interface MarkerAutoImageState {
	state: MarkerAutoImageUiState;
	message: string;
	modeText: string;
	targetId: string | null;
	targetName: string;
	imageUrl: string;
	imageLoadStatus: 'success' | 'failed' | 'missing' | 'pending' | 'unknown';
	imageFormatText: string;
	trackingWidthMeters: number | null;
	trackingWidthMetersText: string;
	measuredWidthInMeters: number | null;
	measuredWidthInMetersText: string;
	browserSupportText: string;
	recentObservationText: string;
	stableFrameCount: number;
	requiredStableFrameCount: number;
	stableFrameText: string;
	trackingState: string;
	fallbackText: string;
	canFallbackManual: boolean;
	reason: string;
	lastUpdatedAt: number | null;
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
	manualReadout: ManualReadoutState;
	manualAdjustmentPreset: ManualAdjustmentPreset;
	placementMode: ArPlacementMode;
	inspectionPlacementSource: InspectionPlacementSource;
	registrationMetrics: RegistrationMetricsState;
	modelScaleSummary: ModelScaleSummaryState;
	registrationChainDebug: RegistrationChainDebugState;
	siteCalibrationBaseline: SiteCalibrationBaselineState;
	engineeringConfigStatus: EngineeringConfigStatusState;
	savedMarkerLocalization: SavedMarkerLocalizationState;
	markerCalibration: MarkerCalibrationState;
	markerAutoImage: MarkerAutoImageState;
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

export function createDefaultManualReadoutState(): ManualReadoutState {

	return {
		positionText: '左移 0.00m / 上移 0.00m / 前移 0.00m',
		yawText: '0deg',
		scaleText: '1.000x'
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
		manualArSitePose: {
			exists: false,
			rootSiteEnuText: '-',
			restored: false
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
		hasSiteOrigin: false,
		hasModelLocalToEnu: false,
		hasRtkSurveyDataset: false,
		hasControlTargets: false,
		hasPlacementAnchor: false,
		controlTargetCount: 0,
		controlTargetSource: 'none',
		controlTargetSourceText: '未加载控制标志',
		baselineMismatch: false,
		rtkPointCount: 0,
		undergroundObjectCount: 0,
		sensorCount: 0,
		riskPointCount: 0,
		markerImageReady: false,
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
		applied: false
	};

}

export function createDefaultMarkerAutoImageState(): MarkerAutoImageState {

	return {
		state: 'idle',
		message: '尚未开始自动控制标志识别。',
		modeText: '未开始',
		targetId: null,
		targetName: '-',
		imageUrl: '-',
		imageLoadStatus: 'unknown',
		imageFormatText: '-',
		trackingWidthMeters: null,
		trackingWidthMetersText: '-',
		measuredWidthInMeters: null,
		measuredWidthInMetersText: '-',
		browserSupportText: '未知',
		recentObservationText: '无',
		stableFrameCount: 0,
		requiredStableFrameCount: 3,
		stableFrameText: '0 / 3',
		trackingState: 'unknown',
		fallbackText: '可用',
		canFallbackManual: false,
		reason: 'idle',
		lastUpdatedAt: null
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




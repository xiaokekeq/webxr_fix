import type { PipeRecord } from '@/models/types/pipe-record.js';
import type { ModelCatalogItem } from '@/models/catalog/model-api.js';
import type { ManualAdjustmentPreset } from '@/localization/manual/manual-registration.js';
import type { ArWorkflowMode } from '@/features/ar/types/workflow.js';

export type WorkspaceMode = 'browse' | 'registration' | 'inspection';
export type AppMode = 'pre-ar' | 'ar-session';
export type ArSupportState = 'checking' | 'supported' | 'unsupported';
export type ArSessionPhase = 'scanning' | 'ready-to-place' | 'placing' | 'placed';
export type ArPlacementMode = 'localized' | 'hit-test-temporary';
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
	gpsBiasAvailable: boolean;
	updatedAtText: string;
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

export interface GpsBiasCorrectionState {
	available: boolean;
	siteId?: string;
	source?: string;
	statusText: string;
	originText: string;
	deltaEnuText: string;
	accuracyText: string;
	yawCorrectionText: string;
	updatedAtText: string;
	usingInSession: boolean;
	sessionSolutionAvailable: boolean;
	sessionId?: string;
	rawGpsEnuText: string;
	correctedDeviceEnuText: string;
	headingDegText: string;
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
	registrationMetrics: RegistrationMetricsState;
	modelScaleSummary: ModelScaleSummaryState;
	registrationChainDebug: RegistrationChainDebugState;
	siteCalibrationBaseline: SiteCalibrationBaselineState;
	savedMarkerLocalization: SavedMarkerLocalizationState;
	gpsBiasCorrection: GpsBiasCorrectionState;
	markerCalibration: MarkerCalibrationState;
	placementSummary: PlacementSummaryState;
	targetGuidance: TargetGuidanceState;
	annotationDetail: AnnotationDetailState;
	registrationStatusDetail: string;
	runtimeStatus: string;
	coarseLocationDebugText: string;
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
		gpsBiasAvailable: false,
		updatedAtText: '-'
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

export function createDefaultGpsBiasCorrectionState(): GpsBiasCorrectionState {

	return {
		available: false,
		statusText: '未记录 GPS 偏差补偿',
		originText: '-',
		deltaEnuText: '-',
		accuracyText: '-',
		yawCorrectionText: '-',
		updatedAtText: '-',
		usingInSession: false,
		sessionSolutionAvailable: false,
		rawGpsEnuText: '-',
		correctedDeviceEnuText: '-',
		headingDegText: '-'
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

export function createDefaultTargetGuidanceState(): TargetGuidanceState {

	return {
		visible: false,
		directionText: '',
		distanceText: '',
		detailText: '',
		alignment: 'center'
	};

}




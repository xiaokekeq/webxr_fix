import * as THREE from 'three';
import type { PipeRecord } from '@/models/types/pipe-record.js';
import { createPointerSelectionSession } from '@/engine/interaction/pointer-selection.js';
import { createPropertySelectionController } from '@/engine/interaction/property-selection.js';
import { createModelSession } from '@/engine/model/session.js';
import { createPlacementSession } from '@/engine/placement/session.js';
import { createArSessionStateRuntime } from '@/engine/session/ar-session-state-runtime.js';
import {
	exportRegistrationSnapshotFile,
	exportSceneSnapshot
} from '@/engine/session/export-runtime.js';
import { ArLocalizationRuntime } from '@/engine/session/ar-localization-runtime.js';
import {
	RegistrationStateRuntime,
	areControlTargetsEquivalent,
	canApplyMockEngineeringCalibration,
	hasMockEngineeringDataInConfig
} from '@/engine/session/registration-state-runtime.js';
import { SessionLifecycleRuntime } from '@/engine/session/session-lifecycle-runtime.js';
import { createSceneHostRuntime, type SceneHostRuntimeHosts } from '@/engine/session/scene-host-runtime.js';
import { createStatusRuntime } from '@/engine/session/status-runtime.js';
import { createWorkspaceRuntime } from '@/engine/session/workspace-runtime.js';
import type { DemoModelConfig } from '@/models/config/demo-model-config.js';
import {
	PROJECT_NAME,
	STATIC_LAYER_NAMES,
	TIMELINE_STAGES
} from '@/models/catalog/model-api.js';
import {
	createDefaultAnnotationDetailState,
	createDefaultFootprintDiagnosticsState,
	createDefaultMarkerCalibrationState,
	createDefaultRegistrationMetricsState,
	createDefaultRegistrationChainDebugState,
	createDefaultModelScaleSummaryState,
	createDefaultSavedMarkerLocalizationState,
	createDefaultSiteCalibrationBaselineState,
	createDefaultEngineeringConfigStatusState,
	createDefaultTargetGuidanceState,
	createRegistrationStore,
	type AnnotationDetailState,
	type ArDisplayMode,
	type InspectionPlacementSource,
	type RegistrationStore,
	type RegistrationStoreState,
	type SectionCutPlaneMode,
	type WorkspaceMode
} from '@/localization/core/registration-store.js';
import {
	solveSimilarityTransform,
	type EngineeringRegistrationSolution
} from '@/localization/coarse/engineering-registration.js';
import {
	type ArFromEnuSolution
} from '@/localization/core/ar-from-enu-solution.js';
import {
	createMarkerPoseInEnuFromControlTarget,
	resolveMarkerPoseInEnu,
	type MarkerLocalizationSolution,
	type MarkerPoseInEnu
} from '@/localization/marker/marker-localization.js';
import {
	computeDiagonalLengths,
	computeSideLengths
} from '@/localization/core/corner-order-diagnostics.js';
import {
	clearLastStableMarkerLocalizationResult,
	type SavedMarkerLocalizationResult
} from '@/localization/marker/marker-localization-storage.js';
import { createDisplayModeController } from './display-mode.js';
import { createLayerVisibilityController } from '@/engine/visualization/layer-visibility.js';
import { createArXrayVisualizationController } from '@/engine/visualization/ar-xray-visualization.js';
import { createArLayerPeelingController } from '@/engine/visualization/ar-layer-peeling.js';
import { createArSectionCutController } from '@/engine/visualization/ar-section-cut.js';
import { VisualizationStateRuntime } from '@/engine/visualization/visualization-state-runtime.js';
import {
	createArAnnotationLabelController,
	type ArAnnotationDetailOverlay,
	type ArAnnotationItem
} from '@/engine/annotation/ar-annotation-labels.js';
import {
	setAttachmentInfoBoardVisibility
} from './attachment-info-board.js';
import { computeTargetGuidanceState } from '@/engine/placement/target-guidance.js';
import { createARScene, resizeARScene } from './scene.js';
import { createXRSessionRuntime } from '@/engine/platform/xr.js';
import {
	getDisplayModeLabel,
	getSectionCutPlaneModeLabel
} from '@/features/ar/types/display-modes.js';
import { InspectionMarkerWorkflow } from '@/engine/inspection/inspection-marker-workflow.js';
import { MarkerCalibrationRuntime } from '@/engine/inspection/marker-calibration-runtime.js';
import { PlacementWorkflow } from '@/engine/placement/placement-workflow.js';
import type {
	ArWorkflowMode,
	SiteCalibrationBaseline,
	VisualControlTarget
} from '@/features/ar/types/workflow.js';
import type { ArSessionRequestMode } from '@/features/ar/types/runtime-types.js';
import type { ArSessionContext } from '@/features/ar/types/ar-session-context.js';
import { repositories } from '@/services/repository-factory.js';
import type { CreateInspectionRecordInput } from '@/services/repositories/inspection-repository.js';
import { validateSiteCalibrationBaselineForStorage } from '@/services/repositories/site-baseline-repository.js';
import { updateCpuDepthFromFrame, setCpuDepthEnabled, cpuDepthDebugState } from '@/engine/visualization/cpu-depth-visualization.js';
import { readPlaceableTemplateReport } from '@/engine/core/model.js';

const MAX_LOG_ITEMS = 24;
const MODEL_CONTROL_POINT_PLACEMENT_RMS_LIMIT_METERS = 0.2;
const AUTO_PLACE_AFTER_MARKER_CALIBRATION = import.meta.env.VITE_AUTO_PLACE_AFTER_MARKER_CALIBRATION === 'true';
const DIRECT_CONTROL_POINT_PLACEMENT_ENABLED = import.meta.env.VITE_USE_DIRECT_CONTROL_POINT_PLACEMENT === 'true';

interface EngineeringDebugLayerOptions {
	showMarkerExpected: boolean;
	showMarkerCaptured: boolean;
	showFootprintExpected: boolean;
	showModelActualControlPoints: boolean;
	showModelBoundingBox: boolean;
}

const tempViewerArPosition = new THREE.Vector3();
const tempMatrix = new THREE.Matrix4();
const tempQuaternion = new THREE.Quaternion();

type EngineeringPlacementBlockReason =
	| 'model-config-missing'
	| 'site-origin-missing'
	| 'control-targets-missing'
	| 'corners-enu-missing'
	| 'corners-not-captured'
	| 'corners-captured-not-applied'
	| 'transform-missing'
	| 'transform-session-mismatch'
	| 'mock-production-blocked'
	| 'model-registration-missing';

interface EngineeringPlacementGuardResult {
	ok: boolean;
	reason?: EngineeringPlacementBlockReason;
	message?: string;
	arFromEnuSolution?: ArFromEnuSolution;
	controlTarget?: VisualControlTarget | null;
}

export interface ThreeEngineHosts extends SceneHostRuntimeHosts {}

export interface ThreeEngineSnapshot extends RegistrationStoreState {
	hasSelection: boolean;
	currentStatus: string;
}

function createInitialState(): RegistrationStoreState {

	return {
		projectName: PROJECT_NAME,
		modelUrl: '-',
		availableModels: [],
		selectedModelId: '',
		workflowMode: 'ar-inspection',
		appMode: 'pre-ar',
		arSupportState: 'checking',
		arSupportMessage: '正在检测当前设备是否支持 WebXR AR。',
		arSessionPhase: 'scanning',
		workspaceMode: 'browse',
		displayMode: 'solid-overlay',
		structureRevealValue: 0,
		transparentXrayValue: 0,
		layerPeelingValue: 0,
		sectionCutValue: 50,
		sectionCutPlaneMode: 'horizontal-section',
		undergroundPreviewEnabled: false,
		undergroundPreviewDepthMeters: 1,
		timelineStages: TIMELINE_STAGES,
		currentTimelineStageIndex: 2,
		layerNames: STATIC_LAYER_NAMES,
		modelLayers: [],
		pipeList: [],
		propertyPanel: {
			name: '未选择构件',
			statusBadge: '未选中',
			type: '-',
			diameter: '-',
			material: '-',
			depth: '-',
			status: '-',
			remark: '点击模型构件后可查看属性信息与巡查说明。'
		},
		inspectionPlacementSource: 'manual-marker',
		registrationMetrics: {
			gpsText: '-',
			enuText: '-',
			rmsText: '-',
			rmsErrorMeters: null,
			rmsSource: 'none'
		},
		modelScaleSummary: createDefaultModelScaleSummaryState(),
		registrationChainDebug: createDefaultRegistrationChainDebugState(),
		footprintDiagnostics: createDefaultFootprintDiagnosticsState(),
		siteCalibrationBaseline: createDefaultSiteCalibrationBaselineState(),
		engineeringConfigStatus: createDefaultEngineeringConfigStatusState(),
		savedMarkerLocalization: createDefaultSavedMarkerLocalizationState(),
		markerCalibration: createDefaultMarkerCalibrationState(),
		placementSummary: {
			positionText: '-',
			quaternionText: '-',
			scaleText: '-'
		},
		targetGuidance: createDefaultTargetGuidanceState(),
		annotationDetail: createDefaultAnnotationDetailState(),
		registrationStatusDetail: '状态：等待识别平面',
		runtimeStatus: '正在准备 AR 运行环境',
		logMessages: []
	};

}

function hasSelectedPipe(state: RegistrationStoreState): boolean {

	return (
		state.propertyPanel.name !== '未选择构件'
		|| state.propertyPanel.type !== '-'
		|| state.propertyPanel.diameter !== '-'
		|| state.propertyPanel.material !== '-'
		|| state.propertyPanel.depth !== '-'
		|| state.propertyPanel.status !== '-'
	);

}

function getArSupportMessage(supported: boolean): string {

	return supported
		? '当前设备支持 WebXR AR，确认模型与阶段后即可进入现场模式。'
		: '当前设备不支持 WebXR AR，无法开启现场 AR 会话。';

}

export class ThreeEngine {

	private readonly store: RegistrationStore;
	private readonly sceneBundle;
	private readonly xrButtonWrap: HTMLDivElement;
	private readonly modelOrientation = new THREE.Quaternion();
	private readonly engineeringCornerDebugGroup = new THREE.Group();
	private readonly engineeringDebugLayers: EngineeringDebugLayerOptions = {
		showMarkerExpected: readDebugLayerFlag( 'VITE_SHOW_MARKER_EXPECTED', false ),
		showMarkerCaptured: readDebugLayerFlag( 'VITE_SHOW_MARKER_CAPTURED', false ),
		showFootprintExpected: readDebugLayerFlag( 'VITE_SHOW_FOOTPRINT_EXPECTED', true ),
		showModelActualControlPoints: readDebugLayerFlag( 'VITE_SHOW_MODEL_ACTUAL_CONTROL_POINTS', true ),
		showModelBoundingBox: readDebugLayerFlag( 'VITE_SHOW_MODEL_BOUNDING_BOX', false )
	};
	private readonly displayModeController;
	private readonly structureRevealController = createArXrayVisualizationController();
	private readonly layerPeelingController = createArLayerPeelingController();
	private readonly sectionCutController;
	private readonly annotationLabelsController;
	private readonly layerVisibility = createLayerVisibilityController();
	private readonly propertySelection;
	private readonly placementSession;
	private readonly modelSession;
	private readonly xrRuntime;
	private readonly workspaceRuntime;
	private readonly pointerSelection;
	private readonly arSessionStateRuntime;
	private readonly sceneHostRuntime;
	private readonly arLocalizationRuntime;
	private readonly sessionLifecycleRuntime;
	private readonly visualizationStateRuntime;
	private readonly inspectionMarkerWorkflow;
	private readonly markerCalibrationRuntime;
	private readonly registrationStateRuntime;
	private readonly placementWorkflow;
	private readonly listeners = new Set<() => void>();

	private initialized = false;
	private disposed = false;
	private currentStatus = '正在准备 AR 运行环境';
	private targetGuidanceSignature = 'hidden';
	private modelTemplate: THREE.Group | null = null;
	private demoModelConfig: DemoModelConfig | null = null;
	private registrationSolution: EngineeringRegistrationSolution | null = null;
	private resolvedMarkerPosesInEnu: MarkerPoseInEnu[] = [];
	private activeMarkerArFromEnuSolution: ArFromEnuSolution | null = null;
	private activeSiteCalibrationBaseline: SiteCalibrationBaseline | null = null;
	private activeMarkerLocalizationResult: SavedMarkerLocalizationResult | null = null;
	private markerCorrectionFallbackArFromEnuSolution: ArFromEnuSolution | null = null;
	private currentArSessionContext: ArSessionContext | null = null;
	private currentArSessionId: string | null = null;
	private currentArSessionRequestMode: ArSessionRequestMode = 'normal';
	private workflowMode: ArWorkflowMode = 'ar-inspection';
	private arSessionEndPending = false;
	private lastAnnotationLabelsSignature = '';
	private lastArSessionContextLogSignature = '';
	private siteBaselineLoadRequestId = 0;
	private pipesByName = new Map<string, PipeRecord>();

	constructor() {

		this.store = createRegistrationStore( createInitialState() );
		this.xrButtonWrap = document.createElement( 'div' );
		this.xrButtonWrap.className = 'xr-button-wrap';
		this.sceneBundle = createARScene( document.createElement( 'div' ) );
		this.engineeringCornerDebugGroup.name = '__engineering-corner-debug';
		this.sceneBundle.scene.add( this.engineeringCornerDebugGroup );

		const statusRuntime = createStatusRuntime( {
			store: this.store,
			updateStatusText: ( message ) => {
				this.currentStatus = message;
			},
			maxLogItems: MAX_LOG_ITEMS
		} );

		this.propertySelection = createPropertySelectionController( {
			store: this.store,
			shouldRenderSelectionOutline: () => this.sceneBundle.renderer.xr.isPresenting
		} );

		this.placementSession = createPlacementSession( {
			store: this.store,
			sceneBundle: this.sceneBundle,
			propertySelection: this.propertySelection,
			setStatus: ( message ) => {
				statusRuntime.setStatus( message );
				this.emit();
			},
			updateRegistrationStatusDetail: ( message ) => {
				statusRuntime.updateRegistrationStatusDetail( message );
			}
		} );

		this.displayModeController = createDisplayModeController( {
			getPlacedModel: () => this.placementSession.getPlacedModel()
		} );
		this.sectionCutController = createArSectionCutController( this.sceneBundle.renderer );
		this.annotationLabelsController = createArAnnotationLabelController( {
			canvas: this.sceneBundle.renderer.domElement
		} );
		this.visualizationStateRuntime = new VisualizationStateRuntime( {
			store: this.store,
			placementSession: this.placementSession,
			layerVisibility: this.layerVisibility,
			displayModeController: this.displayModeController,
			structureRevealController: this.structureRevealController,
			layerPeelingController: this.layerPeelingController,
			sectionCutController: this.sectionCutController,
			syncAttachmentInfoBoardVisibility: () => {
				this.syncAttachmentInfoBoardVisibility();
			}
		} );

		this.workspaceRuntime = createWorkspaceRuntime( {
			store: this.store,
			setStatus: ( message ) => {
				statusRuntime.setStatus( message );
				this.emit();
			}
		} );

		this.arSessionStateRuntime = createArSessionStateRuntime( {
			store: this.store,
			isPresenting: () => this.sceneBundle.renderer.xr.isPresenting,
			hasGroundHit: () => this.xrRuntime.getHitTestController().hasGroundHit(),
			hasPlacedModel: () => this.placementSession.getArPlacedModel() !== null,
			isAutoPlacementPending: () => this.placementSession.getAutoPlacementPending()
		} );

		this.sceneHostRuntime = createSceneHostRuntime( {
			sceneBundle: this.sceneBundle,
			resizeScene: resizeARScene
		} );

		this.arLocalizationRuntime = new ArLocalizationRuntime( {
			getCurrentSessionId: () => this.currentArSessionId,
			getActiveMarkerArFromEnuSolution: () => this.activeMarkerArFromEnuSolution,
			getMarkerCorrectionFallbackArFromEnuSolution: () => this.markerCorrectionFallbackArFromEnuSolution,
		} );

		this.inspectionMarkerWorkflow = new InspectionMarkerWorkflow( {
			getWorkflowMode: () => this.workflowMode,
			getInspectionPlacementSource: () => this.store.getState().inspectionPlacementSource,
			getCurrentSessionId: () => this.currentArSessionId,
			getSiteId: () => this.demoModelConfig?.modelId ?? null,
			getControlTargets: () => this.getCurrentControlTargets(),
			getPrimaryTargetId: () => this.getCurrentControlTargets()[ 0 ]?.id ?? null,
			hasGroundHit: () => this.xrRuntime.getHitTestController().hasGroundHit(),
			hasPlacedModel: () => this.placementSession.getPlacedModel() !== null,
			setStatus: ( message ) => {
				statusRuntime.setStatus( message );
				this.emit();
			},
			requestPreferredPlacement: () => {
				this.pointerSelection.suppressSelectionFor( 1200 );
				this.placementWorkflow.requestAutoPlacement();
			},
			startManualCalibration: ( message ) => {
				this.markerCalibrationRuntime.startCurrentSessionCalibration();
				this.setStatus( message );
			},
		} );

		this.markerCalibrationRuntime = new MarkerCalibrationRuntime( {
			store: this.store,
			getWorkflowMode: () => this.workflowMode,
			getSiteId: () => this.demoModelConfig?.modelId ?? null,
			getConfigUrl: () => this.modelSession.getCurrentModelDefinition()?.configUrl ?? null,
			getCurrentSessionId: () => this.currentArSessionId,
			isPresenting: () => this.sceneBundle.renderer.xr.isPresenting,
			hasGroundHit: () => this.xrRuntime.getHitTestController().hasGroundHit(),
			getHitPosition: ( target ) => this.xrRuntime.getHitTestController().getHitPosition( target ),
			getDemoModelConfig: () => this.demoModelConfig,
			getPrimaryConfiguredMarkerPose: () => this.getPrimaryConfiguredMarkerPose(),
			getControlTargets: () => this.getCurrentControlTargets(),
			hasAppliedMarkerSolutionForCurrentSession: () => (
				(
					this.activeMarkerArFromEnuSolution?.source === 'marker'
				)
				&& this.activeMarkerArFromEnuSolution.sessionId === this.currentArSessionId
			),
			markManualCalibrationStarted: () => {
				this.inspectionMarkerWorkflow.markManualCalibrationStarted();
			},
			applyCurrentSessionMarkerSolution: ( solution, metadata ) => {
				return this.applyCurrentSessionMarkerSolution( solution, metadata );
			},
			setStatus: ( message ) => {
				this.setStatus( message );
			}
		} );

		this.registrationStateRuntime = new RegistrationStateRuntime( {
			store: this.store,
			getWorkflowMode: () => this.workflowMode,
			getCurrentSessionId: () => this.currentArSessionId,
			getRepositoryDataSource: () => repositories.dataSource,
			getDemoModelConfig: () => this.demoModelConfig,
			getRegistrationSolution: () => this.registrationSolution,
			getResolvedMarkerPosesInEnu: () => this.resolvedMarkerPosesInEnu,
			getActiveMarkerLocalizationResult: () => this.activeMarkerLocalizationResult,
			getActiveMarkerArFromEnuSolutionForCurrentSession: () => this.getActiveMarkerArFromEnuSolutionForCurrentSession(),
			getActiveArFromEnuSolution: () => this.getActiveArFromEnuSolution(),
			getActiveSiteCalibrationBaseline: () => this.activeSiteCalibrationBaseline,
			resolveBaselineControlTargets: () => this.resolveBaselineControlTargets(),
			syncMarkerCalibrationState: ( override ) => {
				this.markerCalibrationRuntime.syncState( override );
			},
			setStatus: ( message ) => {
				this.setStatus( message );
			}
		} );

		this.placementWorkflow = new PlacementWorkflow( {
			placementSession: this.placementSession,
			getWorkflowMode: () => this.workflowMode,
			getSiteId: () => this.demoModelConfig?.modelId ?? null,
			getCurrentSessionId: () => this.currentArSessionId,
			getInspectionTargetId: () => this.activeMarkerLocalizationResult?.markerId ?? this.inspectionMarkerWorkflow.getStableTargetId(),
			getInspectionStableFrameCount: () => this.inspectionMarkerWorkflow.getStableFrameCount(),
			getPreferredLocalizationOverride: () => this.getPreferredFormalLocalizationOverride(),
			getModelTemplate: () => this.modelTemplate,
			getRegistrationSolution: () => this.registrationSolution,
			getHitTestController: () => this.xrRuntime.getHitTestController(),
			getModelOrientationTarget: () => this.modelOrientation,
			onBeforePlacementRequest: () => {
				this.propertySelection.clearSelection();
				this.pointerSelection.suppressSelectionFor( 1200 );
			},
			onPlacementBaseResolved: () => {},
			applyModelLayerVisibility: () => {
				this.applyModelLayerVisibility();
			},
			syncRegistrationChainDebug: () => {
				this.syncRegistrationChainDebug();
			},
			syncArSessionPhase: () => {
				this.syncArSessionPhase();
			},
			emit: () => {
				this.emit();
			},
			setStatus: ( message ) => {
				this.setStatus( message );
			},
			onPlacementCompleted: () => {
				this.handlePlacementCompleted();
			}
		} );

		this.sessionLifecycleRuntime = new SessionLifecycleRuntime( {
			store: this.store,
			isPresenting: () => this.sceneBundle.renderer.xr.isPresenting,
			getCurrentSessionId: () => this.currentArSessionId,
			setCurrentSessionId: ( sessionId ) => {
				this.currentArSessionId = sessionId;
			},
			getWorkflowMode: () => this.workflowMode,
			getSiteId: () => this.demoModelConfig?.modelId ?? null,
			getPrimaryBaselineTargetId: () => this.getCurrentControlTargets()[ 0 ]?.id ?? null,
			getActiveMarkerArFromEnuSolution: () => this.activeMarkerArFromEnuSolution,
			getActiveMarkerLocalizationResult: () => this.activeMarkerLocalizationResult,
			hasGroundHit: () => this.xrRuntime.getHitTestController().hasGroundHit(),
			resetMarkerLocalizationCorrection: () => {
				this.resetMarkerLocalizationCorrection();
			},
			refreshSiteCalibrationBaselineState: ( options ) => {
				this.refreshSiteCalibrationBaselineState( options );
			},
			syncRegistrationChainDebug: () => {
				this.syncRegistrationChainDebug();
			},
			syncArSessionPhase: () => {
				this.syncArSessionPhase();
			},
			syncSceneHost: () => {
				this.syncSceneHost();
			},
			emit: () => {
				this.emit();
			},
			setStatus: ( message ) => {
				this.setStatus( message );
			},
			suppressSelection: ( durationMs ) => {
				this.pointerSelection.suppressSelectionFor( durationMs );
			},
			placementSession: this.placementSession,
			arSessionStateRuntime: this.arSessionStateRuntime,
			inspectionMarkerWorkflow: this.inspectionMarkerWorkflow,
			markerCalibrationRuntime: this.markerCalibrationRuntime
		} );

		this.pointerSelection = createPointerSelectionSession( {
			sceneBundle: this.sceneBundle,
			propertySelection: this.propertySelection,
			setStatus: ( message ) => {
				statusRuntime.setStatus( message );
				this.emit();
			},
			onInspectSelection: () => {
				this.emit();
			},
			onSelectionApplied: ( selection ) => {
				this.updateAnnotationDetailFromSelection(
					selection.businessObject,
					selection.properties
				);
			},
			onSelectionCleared: () => {
				this.clearAnnotationDetail();
			},
			handlePreSelectionRaycast: ( selection ) => {
				const item = this.annotationLabelsController.pick( selection.raycaster );
				if ( item === null ) {
					return false;
				}

				this.handleAnnotationSelection( item );
				return true;
			},
			getPlacedModel: () => this.placementSession.getPlacedModel(),
			getWorkspaceMode: () => this.store.getState().workspaceMode,
			getPipesByName: () => this.pipesByName
		} );

		this.modelSession = createModelSession( {
			store: this.store,
			setStatus: ( message ) => {
				statusRuntime.setStatus( message );
				this.emit();
			},
			appendLog: ( message ) => {
				statusRuntime.appendLog( message );
			},
			resetPlacement: () => {
				this.placementSession.resetPlacement();
				this.syncArSessionPhase();
				this.emit();
			},
			onRuntimeReset: () => {
				this.modelTemplate = null;
				this.demoModelConfig = null;
				this.registrationSolution = null;
				this.resolvedMarkerPosesInEnu = [];
				this.activeSiteCalibrationBaseline = null;
				this.currentArSessionContext = null;
				this.lastArSessionContextLogSignature = '';
				this.siteBaselineLoadRequestId += 1;
				this.resetMarkerLocalizationCorrection();
				this.markerCalibrationRuntime.resetRuntimeState();
				this.pipesByName = new Map<string, PipeRecord>();
				this.layerVisibility.reset();
				this.visualizationStateRuntime.reset();
				this.lastAnnotationLabelsSignature = '';
				this.annotationLabelsController.clear();
				this.store.patch( {
					layerNames: STATIC_LAYER_NAMES,
					modelLayers: [],
					annotationDetail: createDefaultAnnotationDetailState(),
					siteCalibrationBaseline: createDefaultSiteCalibrationBaselineState(),
					engineeringConfigStatus: createDefaultEngineeringConfigStatusState()
				} );
				this.refreshSavedMarkerLocalizationResult( { silentStatus: true } );
				this.markerCalibrationRuntime.syncState();
				this.syncRegistrationChainDebug();
			},
			onRuntimeBundleLoaded: ( bundle ) => {
				this.pipesByName = bundle.pipesByName;
				this.demoModelConfig = bundle.demoModelConfig;
				this.modelTemplate = bundle.modelTemplate;
				this.registrationSolution = bundle.registrationSolution;
				this.resolvedMarkerPosesInEnu = this.resolveConfiguredMarkerPoses( bundle.demoModelConfig );
				this.rebuildModelLayers();
				this.syncArSessionContext();
				this.logModelLocalControlPointBoundsCheck();
				this.refreshSiteCalibrationBaselineState( { silentStatus: true } );
				this.refreshSavedMarkerLocalizationResult( { silentStatus: true } );
				this.markerCalibrationRuntime.syncState();
				this.syncRegistrationChainDebug();
			},
			onLoadManualRegistration: () => {},
			canRequestAutoPlacement: () => false,
			requestAutoPlacement: () => {
				this.placementWorkflow.requestAutoPlacement();
			}
		} );

		this.xrRuntime = createXRSessionRuntime( {
			sceneBundle: this.sceneBundle,
			xrButtonWrap: this.xrButtonWrap,
			setStatus: ( message ) => {
				statusRuntime.setStatus( message );
				this.emit();
			},
			onSessionStart: () => {
				this.handleXRSessionStart();
			},
			onSessionEnd: () => {
				this.handleXRSessionEnd();
			},
			canReportStatus: () => (
				this.placementSession.getArPlacedModel() === null
				&& this.placementSession.getAutoPlacementPending() === false
			),
			onAttemptAutoPlacement: () => {
				this.placementWorkflow.attemptAutoPlacement();
			},
			onFrameUpdate: ( frame ) => {
				this.displayModeController.updateDepthState( frame );
				updateCpuDepthFromFrame(
					frame,
					this.sceneBundle.renderer.xr.getReferenceSpace(),
					this.currentArSessionRequestMode
				);
				this.inspectionMarkerWorkflow.syncHints();
				this.placementSession.updateArPlacementAnchor( frame );
				this.syncArSessionPhase();
				this.annotationLabelsController.update( this.sceneBundle.renderer.xr.getCamera() );
				this.updateTargetGuidance();
				this.placementSession.verifyWorldLockedPlacement( 'xr-frame' );
			}
		} );

		this.sceneBundle.renderer.setAnimationLoop( this.xrRuntime.renderFrame );
		this.sceneBundle.renderer.domElement.addEventListener( 'pointerdown', this.pointerSelection.handlePointerDown );
		this.sceneBundle.renderer.domElement.addEventListener( 'pointerup', this.pointerSelection.handlePointerUp );
		window.addEventListener( 'pointerdown', this.handleGlobalArPointerDown, true );
		window.addEventListener( 'pointerup', this.handleGlobalArPointerUp, true );
		window.addEventListener( 'resize', this.handleWindowResize );
		this.sceneBundle.renderer.xr.addEventListener( 'sessionstart', this.bindArSelectionSession );
		this.sceneBundle.renderer.xr.addEventListener( 'sessionend', this.unbindArSelectionSession );

		this.store.subscribe( () => {
			this.syncDisplayModeState();
			this.syncVisualizationState();
			this.syncAnnotationLabels();
			this.emit();
		} );

		this.syncDisplayModeState();
		this.syncVisualizationState();
		this.syncAnnotationLabels();

	}

	subscribe(listener: () => void): () => void {

		this.listeners.add( listener );
		return () => {
			this.listeners.delete( listener );
		};

	}

	getState(): ThreeEngineSnapshot {

		const state = this.store.getState();
		return {
			...state,
			hasSelection: hasSelectedPipe( state ),
			currentStatus: this.currentStatus
		};

	}

	mount(hosts: ThreeEngineHosts): void {

		this.sceneHostRuntime.mount( hosts, this.xrButtonWrap );
		this.syncSceneHost();

	}

	async initialize(): Promise<void> {

		if ( this.initialized ) {
			return;
		}

		this.initialized = true;
		this.setStatus( '正在准备 AR 运行环境' );
		this.xrRuntime.setup();
		this.syncSceneHost();

		try {
			const supportInfo = await this.xrRuntime.detectSupport();
			this.store.patch( {
				arSupportState: supportInfo.supported ? 'supported' : 'unsupported',
				arSupportMessage: getArSupportMessage( supportInfo.supported )
			} );

			await this.modelSession.initializeCatalog();
			this.applyModelLayerVisibility();
			this.syncSceneHost();
			this.refreshSavedMarkerLocalizationResult( { silentStatus: true } );
		} catch ( error ) {
			console.error( 'AR engine initialization failed:', error );
			this.setStatus(
				error instanceof Error ? error.message : 'AR 运行环境初始化失败。'
			);
		}

		this.emit();

	}

	dispose(): void {

		if ( this.disposed ) {
			return;
		}

		this.disposed = true;
		this.sceneBundle.renderer.setAnimationLoop( null );
		this.sceneBundle.renderer.domElement.removeEventListener( 'pointerdown', this.pointerSelection.handlePointerDown );
		this.sceneBundle.renderer.domElement.removeEventListener( 'pointerup', this.pointerSelection.handlePointerUp );
		window.removeEventListener( 'pointerdown', this.handleGlobalArPointerDown, true );
		window.removeEventListener( 'pointerup', this.handleGlobalArPointerUp, true );
		window.removeEventListener( 'resize', this.handleWindowResize );
		this.sceneBundle.renderer.xr.removeEventListener( 'sessionstart', this.bindArSelectionSession );
		this.sceneBundle.renderer.xr.removeEventListener( 'sessionend', this.unbindArSelectionSession );
		this.displayModeController.dispose();
		this.visualizationStateRuntime.restoreVisualizationControllers();
		this.structureRevealController.dispose();
		this.layerPeelingController.dispose();
		this.sectionCutController.dispose();
		this.annotationLabelsController.dispose();
		this.sceneBundle.renderer.dispose();

	}

	handleArUiInteraction(): void {

		this.pointerSelection.cancelPendingSelection( 1400 );

	}

	closePropertyPanel(): void {

		this.pointerSelection.suppressSelectionFor( 1000 );
		this.propertySelection.clearSelection();
		this.clearAnnotationDetail();
		this.setStatus( '已关闭构件信息面板。' );

	}

	selectModel(modelId: string): void {

		this.modelSession.handleModelSelection( modelId );

	}

	setDisplayMode(mode: ArDisplayMode): void {

		if (
			mode !== 'solid-overlay'
			&& mode !== 'transparent-xray'
			&& mode !== 'layer-peeling'
			&& mode !== 'section-cut'
		) {
			return;
		}

		const state = this.store.getState();
		if ( state.displayMode === mode ) {
			return;
		}

		const previousMode = state.displayMode;
		this.store.patch( {
			displayMode: mode,
			structureRevealValue: getDisplayModeSliderValue( state, mode )
		} );

		if ( previousMode === 'layer-peeling' && mode !== 'layer-peeling' ) {
			this.layerVisibility.reset();
			this.applyModelLayerVisibility();
		} else if ( mode === 'layer-peeling' ) {
			this.layerVisibility.setHiddenLayerCount(
				percentToHiddenLayerCount( state.layerPeelingValue, this.layerVisibility.getState().length )
			);
			this.applyModelLayerVisibility();
		}

		this.setStatus( `显示模式已切换为：${getDisplayModeLabel( mode )}` );

	}

	setStructureRevealValue(value: number): void {

		const clampedValue = THREE.MathUtils.clamp( Math.round( value ), 0, 100 );
		const state = this.store.getState();
		if ( state.structureRevealValue === clampedValue && state.displayMode !== 'layer-peeling' ) {
			return;
		}

		switch ( state.displayMode ) {
			case 'transparent-xray':
				this.store.patch( {
					structureRevealValue: clampedValue,
					transparentXrayValue: clampedValue
				} );
				break;
			case 'layer-peeling':
				this.store.patch( {
					structureRevealValue: clampedValue,
					layerPeelingValue: clampedValue
				} );
				this.layerVisibility.setHiddenLayerCount(
					percentToHiddenLayerCount( clampedValue, this.layerVisibility.getState().length )
				);
				this.applyModelLayerVisibility();
				break;
			case 'section-cut':
				this.store.patch( {
					structureRevealValue: clampedValue,
					sectionCutValue: clampedValue
				} );
				break;
			default:
				this.store.patch( { structureRevealValue: clampedValue } );
				break;
		}

	}

	setSectionCutPlaneMode(mode: SectionCutPlaneMode): void {

		if (
			mode !== 'horizontal-section'
			&& mode !== 'cross-section'
			&& mode !== 'longitudinal-section'
		) {
			return;
		}

		const state = this.store.getState();
		if ( state.sectionCutPlaneMode === mode ) {
			return;
		}

		this.store.patch( { sectionCutPlaneMode: mode } );
		this.setStatus( `剖切方向已切换为：${getSectionCutPlaneModeLabel( mode )}` );

	}

	toggleUndergroundPreview(): void {

		const state = this.store.getState();
		const enabled = ! state.undergroundPreviewEnabled;
		this.placementSession.setUndergroundPreview( enabled, state.undergroundPreviewDepthMeters );
		this.store.patch( { undergroundPreviewEnabled: enabled } );
		this.setStatus(
			enabled
				? `地底预览已开启：模型下沉 ${state.undergroundPreviewDepthMeters.toFixed( 1 )}m。`
				: '地底预览已关闭：模型恢复正常高度。'
		);
		this.emit();

	}

	setWorkspaceMode(mode: WorkspaceMode): void {

		if ( this.store.getState().workspaceMode === mode ) {
			return;
		}

		this.workspaceRuntime.setWorkspaceMode( mode );
		this.emit();

	}

	setTimelineStage(index: number): void {

		this.workspaceRuntime.setTimelineStage( index );

	}

	timelinePrev(): void {

		this.workspaceRuntime.setTimelineStage( this.store.getState().currentTimelineStageIndex - 1 );

	}

	timelineNext(): void {

		this.workspaceRuntime.setTimelineStage( this.store.getState().currentTimelineStageIndex + 1 );

	}

	timelinePlay(): void {

		this.setStatus( '时间轴播放功能尚未接入。' );

	}

	setWorkflowMode(mode: ArWorkflowMode): void {

		if ( mode !== 'site-baseline-config' && mode !== 'ar-inspection' ) {
			return;
		}

		this.workflowMode = mode;
		this.store.patch( {
			workflowMode: mode,
			workspaceMode: mode === 'site-baseline-config' ? 'registration' : 'browse'
		} );
		this.syncArSessionContext();
		this.refreshSiteCalibrationBaselineState( { silentStatus: true } );
		this.syncRegistrationChainDebug();
		this.emit();

	}

	async refreshGeoLocation(): Promise<void> {

		console.info( '[RealtimeDeviceLocalizationDisabled]', {
			mode: this.workflowMode,
			siteId: this.demoModelConfig?.modelId ?? null,
			sessionId: this.currentArSessionId,
			reason: 'refreshGeoLocation disabled in formal route',
			createdAt: Date.now()
		} );
		this.setStatus( 'GPS 仅作为开发诊断或站点提示，不参与正式 AR 空间校正。' );

	}

	saveSiteCalibrationBaseline(): void {

		if ( this.workflowMode !== 'site-baseline-config' ) {
			this.setStatus( '当前页面为巡查模式，不能保存现场基准配置。' );
			return;
		}

		if ( this.demoModelConfig === null ) {
			this.setStatus( '站点配置尚未准备完成。' );
			return;
		}

		const baseline = this.buildSiteCalibrationBaseline( this.activeSiteCalibrationBaseline?.createdAt );
		for ( const target of baseline.controlTargets ) {
			console.info( '[SiteBaselineConfigControlTargetLoaded]', {
				mode: this.workflowMode,
				siteId: baseline.siteId,
				dataSource: repositories.dataSource,
				repository: 'siteBaseline',
				sessionId: this.currentArSessionId,
				targetId: target.id,
				centerEnu: target.centerEnu,
				createdAt: Date.now(),
				source: baseline.source
			} );
		}

		console.info( '[SiteBaselineSaveStarted]', {
			mode: this.workflowMode,
			siteId: baseline.siteId,
			dataSource: repositories.dataSource,
			repository: 'siteBaseline',
			sessionId: this.currentArSessionId,
			targetId: null,
			source: baseline.source,
			createdAt: Date.now(),
			controlTargetCount: baseline.controlTargets.length
		} );

		const validation = validateSiteCalibrationBaselineForStorage( baseline );
		if ( validation.ok === false ) {
			if ( validation.reason === 'forbidden-keys' ) {
				console.warn( '[SiteBaselineSaveRejectedArLocalMatrix]', {
					mode: this.workflowMode,
					siteId: baseline.siteId,
					dataSource: repositories.dataSource,
					repository: 'siteBaseline',
					sessionId: this.currentArSessionId,
					source: baseline.source,
					targetId: null,
					createdAt: Date.now(),
					trackingState: validation.forbiddenPath ?? 'forbidden-keys'
				} );
				console.warn( '[SiteBaselineRejectedArLocalMatrix]', {
					mode: this.workflowMode,
					siteId: baseline.siteId,
					sessionId: this.currentArSessionId,
					source: baseline.source,
					targetId: null,
					createdAt: Date.now(),
					trackingState: validation.forbiddenPath ?? 'forbidden-keys',
					stableFrameCount: 0
				} );
				this.setStatus( '现场基准配置包含会话矩阵字段，已拒绝保存。' );
				return;
			}

			console.error( '[SiteBaselineSaveFailed]', {
				mode: this.workflowMode,
				siteId: baseline.siteId,
				dataSource: repositories.dataSource,
				repository: 'siteBaseline',
				sessionId: this.currentArSessionId,
				targetId: null,
				createdAt: Date.now(),
				error: validation.reason
			} );
			this.setStatus( '现场基准配置保存失败，请稍后重试。' );
			return;
		}

		void repositories.siteBaseline.save( baseline ).then( () => {
			console.info( '[SiteBaselineSaveSucceeded]', {
				mode: this.workflowMode,
				siteId: baseline.siteId,
				dataSource: repositories.dataSource,
				repository: 'siteBaseline',
				sessionId: this.currentArSessionId,
				targetId: null,
				source: baseline.source,
				createdAt: baseline.updatedAt ?? baseline.createdAt,
				controlTargetCount: baseline.controlTargets.length
			} );
			this.activeSiteCalibrationBaseline = baseline;
			this.syncArSessionContext();
			this.refreshSiteCalibrationBaselineState( { silentStatus: true } );
			console.info( '[SiteBaselineSaved]', {
				mode: this.workflowMode,
				siteId: baseline.siteId,
				sessionId: this.currentArSessionId,
				source: baseline.source,
				targetId: null,
				createdAt: baseline.updatedAt ?? baseline.createdAt,
				trackingState: 'saved',
				stableFrameCount: 0,
				controlTargetCount: baseline.controlTargets.length
			} );
			this.setStatus( '现场基准配置已保存。AR 巡查将读取该配置，并在每次进入 AR 时重新完成空间校正。' );
			this.emit();
		} ).catch( ( error ) => {
			console.error( 'Site baseline save failed:', error );
			console.error( '[SiteBaselineSaveFailed]', {
				mode: this.workflowMode,
				siteId: baseline.siteId,
				dataSource: repositories.dataSource,
				repository: 'siteBaseline',
				sessionId: this.currentArSessionId,
				targetId: null,
				createdAt: Date.now(),
				error: error instanceof Error ? error.message : String( error )
			} );
			this.setStatus( '现场基准配置保存失败，请稍后重试。' );
		} );

	}

	resetPlacement(): void {

		this.sessionLifecycleRuntime.resetPlacement();

	}

	refreshSavedMarkerLocalization(): void {

		this.refreshSavedMarkerLocalizationResult();

	}

	startCurrentSessionMarkerCalibration(): void {

		this.markerCalibrationRuntime.startCurrentSessionCalibration();

	}

	captureCurrentSessionMarkerCorner(): void {

		this.markerCalibrationRuntime.captureCurrentSessionMarkerCorner();

	}

	resetCurrentSessionMarkerCalibration(): void {

		this.markerCalibrationRuntime.resetCurrentSessionCalibration();

	}

	solveAndApplyCurrentSessionMarkerCalibration(): boolean {

		return this.markerCalibrationRuntime.solveAndApplyCurrentSessionCalibration();

	}

	applySavedMarkerLocalizationCorrection(): boolean {

		this.setStatus( '旧的 /marker-test localStorage 结果已降级为调试用途，正式 Marker 校正请在当前 AR 会话内采集 4 个角点。' );
		console.warn( '[MarkerCorrectionRejected]', {
			reason: 'saved marker results are debug-only; formal apply now requires current AR session corner capture',
			currentSessionId: this.currentArSessionId
		} );
		return false;

	}

	applyMarkerLocalizationCorrection(savedResult: SavedMarkerLocalizationResult): boolean {

		void savedResult;
		this.setStatus( 'Saved marker result is debug-only. Use current-session marker calibration instead.' );
		console.warn( '[MarkerCorrectionRejected]', {
			reason: 'saved marker result apply is disabled',
			currentSessionId: this.currentArSessionId
		} );
		return false;

	}

	clearMarkerLocalizationCorrection(): void {

		if ( this.activeMarkerArFromEnuSolution === null ) {
			this.setStatus( '当前没有已应用的 Marker 校正。' );
			return;
		}

		const previousMarkerId = this.activeMarkerLocalizationResult?.markerId ?? null;
		const fallbackSolution = this.getMarkerCorrectionFallbackSolution();
		const fallbackSource = fallbackSolution?.source ?? 'unknown';

		this.activeMarkerArFromEnuSolution = null;
		this.activeMarkerLocalizationResult = null;
		this.markerCorrectionFallbackArFromEnuSolution = null;

		if ( fallbackSolution !== null ) {
			const appliedToPlacedModel = this.placementSession.applyArLocalizationSolution( {
				modelTemplate: this.modelTemplate,
				registrationSolution: this.registrationSolution,
				arFromEnuSolution: fallbackSolution,
				currentSessionId: this.currentArSessionId
			} );
			if ( appliedToPlacedModel ) {
				this.applyModelLayerVisibility();
				this.arSessionStateRuntime.markPlacementCommitted( true );
			}
		}

		this.syncRegistrationChainDebug();
		console.info( '[MarkerCorrectionCleared]', {
			previousMarkerId,
			fallbackSource
		} );
		this.markerCalibrationRuntime.syncState( {
			applied: false,
			lastUpdatedAt: Date.now()
		} );
		this.logRegistrationFinal();
		this.setStatus( `Marker 校正已清除，当前回退到 ${fallbackSource}。` );
		this.emit();

	}

	clearSavedMarkerLocalization(): void {

		const cleared = clearLastStableMarkerLocalizationResult();
		this.refreshSavedMarkerLocalizationResult( { silentStatus: true } );
		this.setStatus(
			cleared
				? 'Saved marker localization result cleared.'
				: 'No saved marker localization result was available to clear.'
		);

	}

	setInspectionPlacementSource(source: InspectionPlacementSource): void {

		this.store.patch( {
			inspectionPlacementSource: source
		} );

		this.markerCalibrationRuntime.resetCurrentSessionCalibration();
		if ( this.activeMarkerArFromEnuSolution !== null ) {
			this.resetMarkerLocalizationCorrection();
			this.syncRegistrationChainDebug();
		}

		this.setStatus(
			'已切换为手动 Marker 四角点校正：请采集控制标志四角点完成当前会话空间校正。'
		);

		this.emit();

	}

	toggleCpuDepthDebug(): void {

		const wantEnable = ! cpuDepthDebugState.enabled;

		if ( wantEnable ) {
			if ( this.sceneBundle.renderer.xr.isPresenting === false ) {
				setCpuDepthEnabled( true );
				this.enterAr( 'cpu-depth-debug' );
				this.emit();
				return;
			}
			if ( cpuDepthDebugState.depthSensingSessionEnabled === false ) {
				cpuDepthDebugState.errorMessage = '当前 AR 会话未启用 CPU Depth，请退出 AR 后重新进入深度调试模式。';
				return;
			}
		}

		setCpuDepthEnabled( wantEnable );
		this.emit();

	}

	enterAr(mode: ArSessionRequestMode = 'normal'): void {

		if ( this.store.getState().arSupportState !== 'supported' ) {
			this.setStatus( this.store.getState().arSupportMessage );
			return;
		}

		this.currentArSessionRequestMode = mode;
		void this.ensureArSessionContextReady().then( () => {
			this.pointerSelection.suppressSelectionFor( 1200 );
			this.xrRuntime.requestSession( { mode } );
		} );

	}

	async placeModel(): Promise<void> {

		if ( this.sceneBundle.renderer.xr.isPresenting === false ) {
			this.setStatus( 'AR 会话尚未开启。' );
			return;
		}

		const guard = this.validateEngineeringPlacementPreconditions();
		if ( guard.ok === false ) {
			this.logEngineeringPlacementBlocked( guard.reason ?? 'transform-missing' );
			this.setStatus( guard.message ?? '请先完成 Marker 四角点校正后再进行工程放置。' );
			return;
		}

		await this.placeModelFromCurrentMarkerSolution( guard );

	}

	exitAr(): void {

		if ( this.arSessionEndPending ) {
			this.setStatus( '正在退出 AR，请稍候。' );
			return;
		}

		const session = this.sceneBundle.renderer.xr.getSession();
		if ( session === null ) {
			this.setStatus( '当前没有活动中的 AR 会话。' );
			return;
		}

		this.arSessionEndPending = true;
		this.setStatus( '正在退出 AR 会话...' );
		void session.end().catch( ( error: unknown ) => {
			console.warn( '[ArSessionEndFailed]', error );
			this.arSessionEndPending = false;
			this.setStatus(
				error instanceof Error
					? `AR 会话退出失败：${error.message}`
					: 'AR 会话退出失败，请稍后重试。'
			);
		} );

	}

	saveInspectionRecord(input: Omit<CreateInspectionRecordInput, 'siteId'>): void {

		const siteId = this.demoModelConfig?.modelId ?? null;
		if ( siteId === null ) {
			this.setStatus( '当前站点尚未准备完成，无法保存巡查记录。' );
			return;
		}

		const nextRecord: CreateInspectionRecordInput = {
			siteId,
			createdAt: Date.now(),
			...input
		};
		console.info( '[InspectionRecordSaveStarted]', {
			mode: this.workflowMode,
			siteId,
			dataSource: repositories.dataSource,
			repository: 'inspection',
			targetId: null,
			imageUrl: nextRecord.snapshotUrl ?? null,
			createdAt: nextRecord.createdAt
		} );
		void repositories.inspection.create( nextRecord ).then( ( record ) => {
			console.info( '[InspectionRecordSaveSucceeded]', {
				mode: this.workflowMode,
				siteId,
				dataSource: repositories.dataSource,
				repository: 'inspection',
				targetId: record.inspectionId,
				imageUrl: record.snapshotUrl ?? null,
				createdAt: record.createdAt
			} );
			this.setStatus( `已保存巡查记录：${record.result}` );
			this.emit();
		} ).catch( ( error ) => {
			console.error( '[InspectionRecordSaveFailed]', {
				mode: this.workflowMode,
				siteId,
				dataSource: repositories.dataSource,
				repository: 'inspection',
				targetId: null,
				imageUrl: nextRecord.snapshotUrl ?? null,
				createdAt: nextRecord.createdAt,
				error: error instanceof Error ? error.message : String( error )
			} );
			this.setStatus( '巡查记录保存失败，请稍后重试。' );
		} );

	}

	exportInspectionRecords(): void {

		const siteId = this.demoModelConfig?.modelId ?? null;
		if ( siteId === null ) {
			this.setStatus( '当前站点尚未准备完成，无法导出巡查记录。' );
			return;
		}

		void repositories.inspection.listBySite( siteId ).then( ( records ) => {
			this.setStatus( `当前站点共有 ${records.length} 条巡查记录。` );
			this.emit();
		} ).catch( () => {
			this.setStatus( '巡查记录导出失败，请稍后重试。' );
		} );

	}

	takeSnapshot(): void {

		const result = exportSceneSnapshot( {
			renderer: this.sceneBundle.renderer,
			scene: this.sceneBundle.scene,
			camera: this.sceneBundle.camera,
			modelId: this.demoModelConfig?.modelId ?? null
		} );
		this.setStatus( result.statusMessage );

	}

	toggleAnnotationHelper(label: string): void {

		this.setStatus( label + ' 当前为功能占位。' );

	}

	exportRegistrationSnapshot(): void {

		const state = this.store.getState();
		const result = exportRegistrationSnapshotFile( {
			appMode: state.appMode,
			isPresenting: this.sceneBundle.renderer.xr.isPresenting,
			demoModelConfig: this.demoModelConfig,
			registrationSolution: this.registrationSolution,
			currentStage: state.timelineStages[ state.currentTimelineStageIndex ],
			placedModel: this.placementSession.getPlacedModel()
		} );
		this.setStatus( result.statusMessage );

	}

	private emit(): void {

		for ( const listener of this.listeners ) {
			listener();
		}

	}

	private setStatus(message: string): void {

		this.currentStatus = message;
		this.store.patch( { runtimeStatus: message } );

	}

	private syncRegistrationMetrics(): void {

		this.registrationStateRuntime.syncRegistrationMetrics();

	}

	private syncRegistrationChainDebug(): void {

		this.registrationStateRuntime.syncRegistrationChainDebug();

	}

	private refreshSiteCalibrationBaselineState(options?: {
		silentStatus?: boolean;
	}): void {

		void this.loadSiteCalibrationBaseline( options );

	}

	private buildSiteCalibrationBaseline(existingCreatedAt?: number): SiteCalibrationBaseline {

		return this.registrationStateRuntime.buildSiteCalibrationBaseline( existingCreatedAt );

	}

	private getCurrentControlTargets(): VisualControlTarget[] {

		return this.currentArSessionContext?.controlTargets ?? this.resolveBaselineControlTargets();

	}

	private async ensureArSessionContextReady(): Promise<void> {

		this.syncArSessionContext();
		if ( this.workflowMode !== 'ar-inspection' || this.demoModelConfig === null ) {
			return;
		}

		await this.loadSiteCalibrationBaseline( { silentStatus: true } );

	}

	private async loadSiteCalibrationBaseline(options?: {
		silentStatus?: boolean;
	}): Promise<SiteCalibrationBaseline | null> {

		const siteId = this.demoModelConfig?.modelId ?? null;
		if ( siteId === null ) {
			this.activeSiteCalibrationBaseline = null;
			this.syncArSessionContext();
			this.registrationStateRuntime.applySiteCalibrationBaselineState( null, options );
			return null;
		}

		const requestId = ++this.siteBaselineLoadRequestId;
		console.info( '[SiteBaselineLoadStarted]', {
			mode: this.workflowMode,
			siteId,
			dataSource: repositories.dataSource,
			repository: 'siteBaseline',
			sessionId: this.currentArSessionId,
			targetId: null,
			imageUrl: null,
			createdAt: Date.now()
		} );

		try {
			const baseline = await repositories.siteBaseline.load( siteId );
			if ( requestId !== this.siteBaselineLoadRequestId || this.demoModelConfig?.modelId !== siteId ) {
				return this.activeSiteCalibrationBaseline;
			}

			if ( baseline === null ) {
				console.info( '[SiteBaselineLoadMissing]', {
					mode: this.workflowMode,
					siteId,
					dataSource: repositories.dataSource,
					repository: 'siteBaseline',
					sessionId: this.currentArSessionId,
					targetId: null,
					imageUrl: null,
					createdAt: Date.now()
				} );
			} else {
				console.info( '[SiteBaselineLoadSucceeded]', {
					mode: this.workflowMode,
					siteId: baseline.siteId,
					dataSource: repositories.dataSource,
					repository: 'siteBaseline',
					sessionId: this.currentArSessionId,
					targetId: baseline.controlTargets[ 0 ]?.id ?? null,
					createdAt: baseline.updatedAt ?? baseline.createdAt,
					controlTargetCount: baseline.controlTargets.length
				} );
			}

			this.activeSiteCalibrationBaseline = baseline;
			this.syncArSessionContext();
			this.registrationStateRuntime.applySiteCalibrationBaselineState( baseline, options );
			this.syncRegistrationChainDebug();
			this.markerCalibrationRuntime.syncState();
			this.emit();
			return baseline;
		} catch ( error ) {
			if ( requestId !== this.siteBaselineLoadRequestId || this.demoModelConfig?.modelId !== siteId ) {
				return this.activeSiteCalibrationBaseline;
			}

			console.error( '[SiteBaselineLoadFailed]', {
				mode: this.workflowMode,
				siteId,
				dataSource: repositories.dataSource,
				repository: 'siteBaseline',
				sessionId: this.currentArSessionId,
				targetId: null,
				imageUrl: null,
				createdAt: Date.now(),
				error: error instanceof Error ? error.message : String( error )
			} );
			this.activeSiteCalibrationBaseline = null;
			this.syncArSessionContext();
			this.registrationStateRuntime.applySiteCalibrationBaselineState( null, { silentStatus: true } );
			this.syncRegistrationChainDebug();
			this.markerCalibrationRuntime.syncState();
			if ( options?.silentStatus !== true ) {
				this.setStatus( '现场基准加载失败，请稍后重试。' );
			}
			this.emit();
			return null;
		}

	}

	private syncArSessionContext(): void {

		if ( this.demoModelConfig === null ) {
			this.currentArSessionContext = null;
			this.lastArSessionContextLogSignature = '';
			return;
		}

		const resolved = this.resolveSessionContextControlTargets();
		const nextContext: ArSessionContext = {
			mode: this.workflowMode,
			siteId: this.demoModelConfig.modelId,
			siteConfig: this.demoModelConfig,
			baseline: this.activeSiteCalibrationBaseline,
			controlTargets: resolved.controlTargets
		};
		this.currentArSessionContext = nextContext;

		const signature = [
			nextContext.mode,
			nextContext.siteId,
			resolved.source,
			nextContext.baseline?.updatedAt ?? nextContext.baseline?.createdAt ?? 'none',
			resolved.controlTargets.length
		].join( '::' );
		if ( signature === this.lastArSessionContextLogSignature ) {
			return;
		}

		this.lastArSessionContextLogSignature = signature;
		console.info( '[ArSessionContextCreated]', {
			mode: nextContext.mode,
			siteId: nextContext.siteId,
			dataSource: repositories.dataSource,
			repository: 'arSessionContext',
			targetId: resolved.controlTargets[ 0 ]?.id ?? null,
			createdAt: Date.now(),
			controlTargetCount: resolved.controlTargets.length,
			baselineAvailable: nextContext.baseline !== null
		} );
		console.info(
			resolved.source === 'baseline'
				? '[ArSessionUsingBaselineControlTargets]'
				: '[ArSessionUsingSiteConfigControlTargets]',
			{
				mode: nextContext.mode,
				siteId: nextContext.siteId,
				dataSource: repositories.dataSource,
				repository: 'arSessionContext',
				targetId: resolved.controlTargets[ 0 ]?.id ?? null,
				createdAt: Date.now(),
				controlTargetCount: resolved.controlTargets.length
			}
		);

	}

	private resolveSessionContextControlTargets(): {
		controlTargets: VisualControlTarget[];
		source: 'baseline' | 'site-config';
	} {

		const siteConfigTargets = this.resolveBaselineControlTargets();
		const baselineTargets = this.activeSiteCalibrationBaseline?.controlTargets ?? [];
		const baselineMatchesSiteConfig = siteConfigTargets.length > 0
			&& areControlTargetsEquivalent( baselineTargets, siteConfigTargets );

		if (
			this.workflowMode === 'ar-inspection'
			&& baselineTargets.length > 0
			&& ( siteConfigTargets.length === 0 || baselineMatchesSiteConfig )
		) {
			return {
				controlTargets: baselineTargets,
				source: 'baseline'
			};
		}

		return {
			controlTargets: siteConfigTargets,
			source: 'site-config'
		};

	}

	private resolveBaselineControlTargets(): VisualControlTarget[] {

		if ( this.demoModelConfig === null ) {
			return [];
		}

		return this.demoModelConfig.controlTargets;

	}

	private refreshSavedMarkerLocalizationResult(options?: {
		silentStatus?: boolean;
	}): void {

		this.registrationStateRuntime.refreshSavedMarkerLocalizationResult( options );

	}

	private getPrimaryConfiguredMarkerPose(): MarkerPoseInEnu | null {

		const primaryControlTarget = this.getCurrentControlTargets()[ 0 ];
		if ( primaryControlTarget !== undefined ) {
			return createMarkerPoseInEnuFromControlTarget( primaryControlTarget );
		}

		return this.resolvedMarkerPosesInEnu[ 0 ] ?? null;

	}

	private getActiveEngineeringControlTarget(): VisualControlTarget | null {

		const controlTargets = this.getCurrentControlTargets();
		const activeMarkerId = this.activeMarkerLocalizationResult?.markerId
			?? this.store.getState().markerCalibration.markerId
			?? null;
		if ( activeMarkerId !== null ) {
			return controlTargets.find(
				(target) => target.id === activeMarkerId || target.markerId === activeMarkerId
			) ?? null;
		}

		return controlTargets[ 0 ] ?? null;

	}

	private validateEngineeringPlacementPreconditions(): EngineeringPlacementGuardResult {

		if ( this.demoModelConfig === null ) {
			return {
				ok: false,
				reason: 'model-config-missing',
				message: '模型工程配置尚未加载完成。'
			};
		}

		const siteOrigin = this.demoModelConfig.siteFrame.origin;
		const hasSiteOrigin = Number.isFinite( siteOrigin.lat )
			&& Number.isFinite( siteOrigin.lon )
			&& Number.isFinite( siteOrigin.alt );
		if ( hasSiteOrigin === false ) {
			return {
				ok: false,
				reason: 'site-origin-missing',
				message: '缺少工程原点 siteOrigin，无法正式放置模型。'
			};
		}

		if ( this.registrationSolution === null || this.modelTemplate === null ) {
			return {
				ok: false,
				reason: 'model-registration-missing',
				message: '模型工程配准尚未准备完成，无法正式放置模型。'
			};
		}

		const controlTargets = this.getCurrentControlTargets();
		if ( controlTargets.length === 0 ) {
			return {
				ok: false,
				reason: 'control-targets-missing',
				message: '缺少控制标志 controlTargets，无法正式放置模型。'
			};
		}

		const controlTarget = this.getActiveEngineeringControlTarget();
		if ( controlTarget === null || controlTarget.cornersEnu === undefined || controlTarget.cornersEnu.length !== 4 ) {
			return {
				ok: false,
				reason: 'corners-enu-missing',
				message: '当前控制标志缺少四角 ENU 坐标，无法正式放置模型。'
			};
		}

		const markerState = this.store.getState().markerCalibration;
		if ( markerState.capturedCornerCount < markerState.expectedCornerCount ) {
			return {
				ok: false,
				reason: 'corners-not-captured',
				message: '请先采集 Marker 四角点。'
			};
		}

		if ( markerState.applied === false ) {
			return {
				ok: false,
				reason: 'corners-captured-not-applied',
				message: '已采集 4/4，请完成 Marker 校正。'
			};
		}

		const arFromEnuSolution = this.activeMarkerArFromEnuSolution;
		if ( arFromEnuSolution === null || arFromEnuSolution.source !== 'marker' ) {
			return {
				ok: false,
				reason: 'transform-missing',
				message: '请先完成 Marker 四角点校正。'
			};
		}

		if ( arFromEnuSolution.sessionId !== this.currentArSessionId ) {
			return {
				ok: false,
				reason: 'transform-session-mismatch',
				message: 'AR 会话已变化，请重新进行 Marker 校正。'
			};
		}

		const hasMockEngineeringData = hasMockEngineeringDataInConfig( this.demoModelConfig, controlTargets );
		if ( hasMockEngineeringData && canApplyMockEngineeringCalibration() === false ) {
			return {
				ok: false,
				reason: 'mock-production-blocked',
				message: '当前为示例工程坐标，请替换为 RTK 实测数据。'
			};
		}

		return {
			ok: true,
			arFromEnuSolution,
			controlTarget
		};

	}

	private logEngineeringPlacementBlocked(reason: EngineeringPlacementBlockReason): void {

		console.warn( '[EngineeringPlacementBlocked]', {
			...this.createEngineeringPlacementDiagnosticPayload(),
			reason,
			createdAt: Date.now()
		} );

	}

	private logEngineeringPlacementApplied(
		arFromEnuSolution: ArFromEnuSolution | null,
		controlTarget: VisualControlTarget | null
	): void {

		const placedModel = this.placementSession.getArPlacedModel();
		placedModel?.updateMatrixWorld( true );
		const controlTargets = this.getCurrentControlTargets();
		const hasMockEngineeringData = this.demoModelConfig !== null
			&& hasMockEngineeringDataInConfig( this.demoModelConfig, controlTargets );
		console.info( '[EngineeringPlacementApplied]', {
			modelId: this.demoModelConfig?.modelId ?? this.store.getState().selectedModelId ?? null,
			configUrl: this.modelSession.getCurrentModelDefinition()?.configUrl ?? null,
			siteOrigin: this.demoModelConfig?.siteFrame.origin ?? null,
			controlTargetId: controlTarget?.id ?? this.activeMarkerLocalizationResult?.markerId ?? null,
			placementAnchorEnu: this.demoModelConfig?.placementAnchorEnu ?? null,
			hasModelLocalToEnu: this.registrationSolution !== null,
			hasEnuToArTransform: arFromEnuSolution !== null,
			transformSessionId: arFromEnuSolution?.sessionId ?? null,
			currentSessionId: this.currentArSessionId,
			finalPosition: placedModel === null ? null : vector3ToRoundedObject( placedModel.getWorldPosition( new THREE.Vector3() ) ),
			finalQuaternion: placedModel === null ? null : quaternionToRoundedObject( placedModel.getWorldQuaternion( new THREE.Quaternion() ) ),
			finalScale: placedModel === null ? null : vector3ToRoundedObject( placedModel.getWorldScale( new THREE.Vector3() ) ),
			placementMode: 'engineering',
			placementSource: 'marker-calibrated-enu',
			usedHitTestForFinalPlacement: false,
			hasMockEngineeringData,
			mockAllowedByDevEnv: hasMockEngineeringData && canApplyMockEngineeringCalibration(),
			createdAt: Date.now()
		} );

	}

	private createEngineeringPlacementDiagnosticPayload(): Record<string, unknown> {

		const controlTargets = this.getCurrentControlTargets();
		const controlTarget = this.getActiveEngineeringControlTarget();
		const markerState = this.store.getState().markerCalibration;
		const arFromEnuSolution = this.activeMarkerArFromEnuSolution;
		const hasMockEngineeringData = this.demoModelConfig !== null
			&& hasMockEngineeringDataInConfig( this.demoModelConfig, controlTargets );
		return {
			modelId: this.demoModelConfig?.modelId ?? this.store.getState().selectedModelId ?? null,
			configUrl: this.modelSession.getCurrentModelDefinition()?.configUrl ?? null,
			hasSiteOrigin: this.demoModelConfig !== null
				&& Number.isFinite( this.demoModelConfig.siteFrame.origin.lat )
				&& Number.isFinite( this.demoModelConfig.siteFrame.origin.lon )
				&& Number.isFinite( this.demoModelConfig.siteFrame.origin.alt ),
			controlTargetsCount: controlTargets.length,
			controlTargetId: controlTarget?.id ?? null,
			hasCornersEnu: controlTarget?.cornersEnu !== undefined && controlTarget.cornersEnu.length === 4,
			capturedCornerCount: markerState.capturedCornerCount,
			expectedCornerCount: markerState.expectedCornerCount,
			markerCalibrationStatus: markerState.applied
				? 'applied'
				: markerState.solved ? 'solved' : markerState.active ? 'capturing' : 'idle',
			hasEnuToArTransform: arFromEnuSolution !== null,
			transformSessionId: arFromEnuSolution?.sessionId ?? null,
			currentSessionId: this.currentArSessionId,
			hasMockEngineeringData,
			isDev: import.meta.env.DEV,
			allowMockCalibration: canApplyMockEngineeringCalibration()
		};

	}

	private renderEngineeringCornerDebug(
		arFromEnuSolution: ArFromEnuSolution,
		controlTarget: VisualControlTarget | null,
		capturedCornersAr: THREE.Vector3[] = []
	): void {

		this.clearEngineeringCornerDebug();
		if ( this.engineeringDebugLayers.showMarkerExpected && controlTarget?.cornersEnu !== undefined ) {
			this.addDebugQuad( {
				name: 'marker-expected',
				points: controlTarget.cornersEnu.map( ( point ) => enuTupleToArVector( point, arFromEnuSolution ) ),
				labels: [ 'leftTop', 'rightTop', 'rightBottom', 'leftBottom' ],
				color: 0x00d4ff
			} );
		}

		if ( this.engineeringDebugLayers.showMarkerCaptured && capturedCornersAr.length === 4 ) {
			this.addDebugQuad( {
				name: 'marker-captured',
				points: capturedCornersAr.map( ( point ) => point.clone() ),
				labels: [ 'captured-LT', 'captured-RT', 'captured-RB', 'captured-LB' ],
				color: 0x32ff8f
			} );
		}

		if ( this.engineeringDebugLayers.showFootprintExpected && this.registrationSolution !== null ) {
			const footprintControlPoints = this.registrationSolution.controlPoints.slice( 0, 4 );
			const footprintCornersAr = footprintControlPoints
				.map( ( point ) => point.worldEnu.clone().applyMatrix4( arFromEnuSolution.matrix ) );
			console.info( '[FootprintRenderDependencyCheck]', {
				source: arFromEnuSolution.source,
				sessionId: arFromEnuSolution.sessionId ?? null,
				matrixChain: 'controlPoint.worldEnu -> arFromEnu',
				usesHitTest: false,
				usesCameraPose: false,
				usesPlacedModelMatrix: false,
				footprintControlPointIds: footprintControlPoints.map( ( point ) => point.id ),
				footprintCornersAr: footprintCornersAr.map( vector3ToRoundedObject )
			} );
			this.addDebugQuad( {
				name: 'footprint-enu',
				points: footprintCornersAr,
				labels: footprintControlPoints.map( ( point ) => point.id ),
				color: 0xffd84d
			} );
			const markerCornersEnu = ( controlTarget?.cornersEnu ?? [] ).map( tupleToVector3 );
			if ( markerCornersEnu.length === 4 ) {
				const markerCenterAr = averageVectors( markerCornersEnu )
					.applyMatrix4( arFromEnuSolution.matrix );
				const footprintCenterAr = averageVectors( footprintControlPoints.map( ( point ) => point.worldEnu ) )
					.applyMatrix4( arFromEnuSolution.matrix );
				this.addDebugPoint( 'marker-center', markerCenterAr, 0x00d4ff );
				this.addDebugPoint( 'footprint-center', footprintCenterAr, 0xffd84d );
				this.addDebugLine( 'marker-to-footprint-center', [ markerCenterAr, footprintCenterAr ], 0xffd84d );
			}
		}

		const placedModel = this.placementSession.getArPlacedModel();
		if ( placedModel !== null && this.registrationSolution !== null ) {
			placedModel.updateMatrixWorld( true );
			if ( this.engineeringDebugLayers.showModelActualControlPoints ) {
				this.addDebugQuad( {
					name: 'model-cp-actual',
					points: this.registrationSolution.controlPoints
						.slice( 0, 4 )
						.map( ( point ) => placedModel.localToWorld( point.modelLocal.clone() ) ),
					labels: this.registrationSolution.controlPoints.slice( 0, 4 ).map( ( point ) => `actual-${point.id}` ),
					color: 0xff4dff
				} );
			}
			const bbox = new THREE.Box3().setFromObject( placedModel );
			if ( this.engineeringDebugLayers.showModelBoundingBox && bbox.isEmpty() === false ) {
				const helper = new THREE.Box3Helper( bbox, 0xffffff );
				helper.name = 'model-bbox';
				this.engineeringCornerDebugGroup.add( helper );
			}
		}

		console.info( '[EngineeringCornerDebugDrawn]', {
			controlTargetId: controlTarget?.id ?? null,
			markerCornerCount: controlTarget?.cornersEnu?.length ?? 0,
			capturedCornerCount: capturedCornersAr.length,
			modelControlPointCount: this.registrationSolution?.controlPoints.length ?? 0,
			layers: this.engineeringDebugLayers,
			placementMode: 'diagnostic-only',
			affectsPlacement: false,
			createdAt: Date.now()
		} );

	}

	private addDebugQuad(args: {
		name: string;
		points: THREE.Vector3[];
		labels: string[];
		color: number;
	}): void {

		if ( args.points.length !== 4 ) {
			return;
		}

		const material = new THREE.LineBasicMaterial( { color: args.color, depthTest: false } );
		const geometry = new THREE.BufferGeometry().setFromPoints( [ ...args.points, args.points[ 0 ] ] );
		const line = new THREE.Line( geometry, material );
		line.name = `${args.name}-quad`;
		this.engineeringCornerDebugGroup.add( line );

		for ( let index = 0; index < args.points.length; index += 1 ) {
			const sphere = new THREE.Mesh(
				new THREE.SphereGeometry( 0.035, 12, 8 ),
				new THREE.MeshBasicMaterial( { color: args.color, depthTest: false } )
			);
			sphere.position.copy( args.points[ index ] );
			sphere.name = `${args.name}-${args.labels[ index ]}`;
			this.engineeringCornerDebugGroup.add( sphere );

			const label = createDebugTextSprite( args.labels[ index ], args.color );
			label.position.copy( args.points[ index ] ).add( new THREE.Vector3( 0, 0.08, 0 ) );
			this.engineeringCornerDebugGroup.add( label );
		}

	}

	private addDebugPoint(labelText: string, position: THREE.Vector3, color: number): void {

		const sphere = new THREE.Mesh(
			new THREE.SphereGeometry( 0.045, 12, 8 ),
			new THREE.MeshBasicMaterial( { color, depthTest: false } )
		);
		sphere.name = labelText;
		sphere.position.copy( position );
		this.engineeringCornerDebugGroup.add( sphere );

		const label = createDebugTextSprite( labelText, color );
		label.position.copy( position ).add( new THREE.Vector3( 0, 0.1, 0 ) );
		this.engineeringCornerDebugGroup.add( label );

	}

	private addDebugLine(name: string, points: THREE.Vector3[], color: number): void {

		const material = new THREE.LineBasicMaterial( { color, depthTest: false } );
		const geometry = new THREE.BufferGeometry().setFromPoints( points );
		const line = new THREE.Line( geometry, material );
		line.name = name;
		this.engineeringCornerDebugGroup.add( line );

	}

	private clearEngineeringCornerDebug(): void {

		while ( this.engineeringCornerDebugGroup.children.length > 0 ) {
			const child = this.engineeringCornerDebugGroup.children.pop();
			if ( child !== undefined ) {
				disposeDebugObject( child );
			}
		}

	}

	private logCoordinateAxisMappingCheck(arFromEnuSolution: ArFromEnuSolution): void {

		const sampleEnuPoint = new THREE.Vector3( 1, 1, 1 );
		console.info( '[CoordinateAxisMappingCheck]', {
			enuToThreeMapping: {
				beforeArFromEnu: '[east,north,up] stored as Vector3(x=east,y=north,z=up)',
				afterArFromEnu: 'solution.matrix maps ENU meters into WebXR AR local coordinates'
			},
			arWorldUpAxis: 'WebXR/Three.js +Y',
			modelUpAxis: this.modelTemplate?.userData.__modelUpAxis ?? 'asset-transform-normalized',
			siteOrigin: this.demoModelConfig?.siteFrame.origin ?? null,
			sampleEnuPoint: vector3ToRoundedObject( sampleEnuPoint ),
			sampleArPoint: vector3ToRoundedObject( sampleEnuPoint.clone().applyMatrix4( arFromEnuSolution.matrix ) ),
			warningIfUpAxisMismatch: 'Do not render raw ENU [east,north,up] directly as AR [x,y,z]; apply arFromEnuSolution.matrix first.'
		} );

	}

	private logFootprintEnuToArCheck(
		arFromEnuSolution: ArFromEnuSolution,
		controlTarget: VisualControlTarget | null
	): void {

		if ( this.registrationSolution === null ) {
			console.warn( '[FootprintEnuToArCheck]', {
				modelId: this.demoModelConfig?.modelId ?? null,
				warnings: [ 'registrationSolution missing' ]
			} );
			return;
		}

		const footprintPoints = this.registrationSolution.controlPoints.slice( 0, 4 );
		const footprintCornersEnu = footprintPoints.map( ( point ) => point.worldEnu.clone() );
		const footprintCornersAr = footprintCornersEnu.map( ( point ) => point.clone().applyMatrix4( arFromEnuSolution.matrix ) );
		const markerCornersEnu = ( controlTarget?.cornersEnu ?? [] ).map( tupleToVector3 );
		const markerCornersAr = markerCornersEnu.map( ( point ) => point.clone().applyMatrix4( arFromEnuSolution.matrix ) );
		const footprintCenterEnu = averageVectors( footprintCornersEnu );
		const footprintCenterAr = averageVectors( footprintCornersAr );
		const markerCenterEnu = controlTarget?.centerEnu === undefined
			? averageVectors( markerCornersEnu )
			: tupleToVector3( controlTarget.centerEnu );
		const markerCenterAr = markerCenterEnu.clone().applyMatrix4( arFromEnuSolution.matrix );
		const vectorMarkerToFootprintCenterEnu = footprintCenterEnu.clone().sub( markerCenterEnu );
		const vectorMarkerToFootprintCenterAr = footprintCenterAr.clone().sub( markerCenterAr );
		const distanceMarkerToFootprintCenterEnu = vectorMarkerToFootprintCenterEnu.length();
		const distanceMarkerToFootprintCenterAr = Math.hypot( vectorMarkerToFootprintCenterAr.x, vectorMarkerToFootprintCenterAr.z );
		const headingMarkerToFootprintEnuDeg = normalizeSignedDegrees( radToDeg(
			Math.atan2( vectorMarkerToFootprintCenterEnu.x, vectorMarkerToFootprintCenterEnu.y )
		) );
		const headingMarkerToFootprintArDeg = normalizeSignedDegrees( radToDeg(
			Math.atan2( vectorMarkerToFootprintCenterAr.x, - vectorMarkerToFootprintCenterAr.z )
		) );
		const distanceDeltaMeters = Math.abs( distanceMarkerToFootprintCenterAr - distanceMarkerToFootprintCenterEnu );
		const headingDeltaDeg = Math.abs( normalizeSignedDegrees( headingMarkerToFootprintArDeg - headingMarkerToFootprintEnuDeg ) );
		const enuEdgeLengths = computeSideLengths( footprintCornersEnu );
		const arEdgeLengths = computeSideLengths( footprintCornersAr );
		const enuDiagonals = computeDiagonalLengths( footprintCornersEnu );
		const arDiagonals = computeDiagonalLengths( footprintCornersAr );
		const edgeLengthDelta = maxPairDelta( enuEdgeLengths, arEdgeLengths );
		const diagonalDelta = maxPairDelta( enuDiagonals, arDiagonals );
		const warnings: string[] = [];
		if ( distanceDeltaMeters > 0.2 ) {
			warnings.push( 'marker-to-footprint distance changed after ENU->AR transform; check transform scale/direction' );
		}
		if ( headingDeltaDeg > 5 ) {
			warnings.push( 'marker-to-footprint heading changed after ENU->AR transform; check east/north -> x/z mapping' );
		}
		if ( markerCornersEnu.length !== 4 ) {
			warnings.push( 'controlTarget marker corners missing or not 4 points' );
		}
		const footprintControlPointIds = footprintPoints.map( ( point ) => point.id );
		const configWithFootprintOrder = this.demoModelConfig as ( DemoModelConfig & { modelControlPointOrder?: string[] } ) | null;
		const expectedFootprintControlPointIds = configWithFootprintOrder?.modelControlPointOrder?.slice( 0, 4 )
			?? Object.keys( this.demoModelConfig?.controlPoints ?? {} ).slice( 0, 4 );
		const wrongFootprintControlPointsUsed = footprintControlPointIds.join( '|' ) !== expectedFootprintControlPointIds.join( '|' );

		console.info( '[FootprintEnuToArCheck]', {
			modelId: this.demoModelConfig?.modelId ?? null,
			footprintControlPointIds,
			footprintCornerOrder: [ 'leftTop', 'rightTop', 'rightBottom', 'leftBottom' ],
			footprintCornersEnu: footprintCornersEnu.map( vector3ToRoundedObject ),
			footprintCornersArExpected: footprintCornersAr.map( vector3ToRoundedObject ),
			sideLengthsFootprintEnu: enuEdgeLengths,
			sideLengthsFootprintAr: arEdgeLengths,
			diagonalLengthsFootprintEnu: enuDiagonals,
			diagonalLengthsFootprintAr: arDiagonals,
			footprintCenterEnu: vector3ToRoundedObject( footprintCenterEnu ),
			footprintCenterAr: vector3ToRoundedObject( footprintCenterAr ),
			markerCenterEnu: vector3ToRoundedObject( markerCenterEnu ),
			markerCenterAr: vector3ToRoundedObject( markerCenterAr ),
			vectorMarkerToFootprintCenterEnu: vector3ToRoundedObject( vectorMarkerToFootprintCenterEnu ),
			vectorMarkerToFootprintCenterAr: vector3ToRoundedObject( vectorMarkerToFootprintCenterAr ),
			distanceMarkerToFootprintCenterEnu: Number( distanceMarkerToFootprintCenterEnu.toFixed( 6 ) ),
			distanceMarkerToFootprintCenterAr: Number( distanceMarkerToFootprintCenterAr.toFixed( 6 ) ),
			headingMarkerToFootprintCenterEnu: Number( headingMarkerToFootprintEnuDeg.toFixed( 3 ) ),
			headingMarkerToFootprintCenterAr: Number( headingMarkerToFootprintArDeg.toFixed( 3 ) ),
			warnings
		} );
		const relationPayload = {
			markerCenterEnu: vector3ToRoundedObject( markerCenterEnu ),
			footprintCenterEnu: vector3ToRoundedObject( footprintCenterEnu ),
			vectorMarkerToFootprintEnu: vector3ToRoundedObject( vectorMarkerToFootprintCenterEnu ),
			distanceMarkerToFootprintEnu: Number( distanceMarkerToFootprintCenterEnu.toFixed( 6 ) ),
			headingMarkerToFootprintEnuDeg: Number( headingMarkerToFootprintEnuDeg.toFixed( 3 ) ),
			markerCenterAr: vector3ToRoundedObject( markerCenterAr ),
			footprintCenterAr: vector3ToRoundedObject( footprintCenterAr ),
			vectorMarkerToFootprintArXZ: {
				x: Number( vectorMarkerToFootprintCenterAr.x.toFixed( 6 ) ),
				z: Number( vectorMarkerToFootprintCenterAr.z.toFixed( 6 ) )
			},
			distanceMarkerToFootprintAr: Number( distanceMarkerToFootprintCenterAr.toFixed( 6 ) ),
			headingMarkerToFootprintArDeg: Number( headingMarkerToFootprintArDeg.toFixed( 3 ) ),
			yawDeg: Number( arFromEnuSolution.headingDeg.toFixed( 6 ) ),
			expectedArHeadingFromEnuDeg: Number( headingMarkerToFootprintEnuDeg.toFixed( 3 ) ),
			headingDeltaDeg: Number( headingDeltaDeg.toFixed( 6 ) ),
			distanceDeltaMeters: Number( distanceDeltaMeters.toFixed( 6 ) )
		};
		console.info( '[MarkerToFootprintRelationCheck]', relationPayload );
		if ( distanceDeltaMeters > 0.2 ) {
			console.error( '[MarkerToFootprintDistanceMismatch]', relationPayload );
		}
		if ( headingDeltaDeg > 5 ) {
			console.error( '[MarkerToFootprintHeadingMismatch]', relationPayload );
		}
		console.info( '[FootprintShapeCheck]', {
			footprintControlPointIds,
			footprintCornersEnu: footprintCornersEnu.map( vector3ToRoundedObject ),
			footprintCornersAr: footprintCornersAr.map( vector3ToRoundedObject ),
			enuEdgeLengths,
			arEdgeLengths,
			enuDiagonals,
			arDiagonals,
			enuCenter: vector3ToRoundedObject( footprintCenterEnu ),
			arCenter: vector3ToRoundedObject( footprintCenterAr ),
			enuYawDeg: Number( headingFromEnuPoints( footprintCornersEnu ).toFixed( 3 ) ),
			arYawDeg: Number( headingFromArPoints( footprintCornersAr ).toFixed( 3 ) ),
			edgeLengthDelta: Number( edgeLengthDelta.toFixed( 6 ) ),
			diagonalDelta: Number( diagonalDelta.toFixed( 6 ) ),
			warning: edgeLengthDelta > 0.05 || diagonalDelta > 0.05
				? 'footprint shape changed after ENU->AR; check scale/unit/matrix application'
				: null
		} );
		console.info( '[FootprintControlPointConfigCheck]', footprintPoints.map( ( point, index ) => {
			const rawPoint = this.demoModelConfig?.controlPoints[ point.id ];
			const rawPointRecord = rawPoint as unknown as Record<string, unknown> | undefined;
			return {
				controlPointId: point.id,
				cornerRole: rawPointRecord?.cornerRole ?? null,
				source: rawPointRecord?.modelLocalSource ?? 'config.controlPoints',
				worldEnu: vector3ToRoundedObject( point.worldEnu ),
				modelLocal: vector3ToRoundedObject( point.modelLocal ),
				note: rawPointRecord?.modelLocalSource ?? null,
				isFootprintControlPoint: expectedFootprintControlPointIds.includes( point.id ),
				roleOrder: index
			};
		} ) );
		if ( wrongFootprintControlPointsUsed ) {
			console.error( '[WrongFootprintControlPointsUsed]', {
				usedControlPointIds: footprintControlPointIds,
				expectedControlPointIds: expectedFootprintControlPointIds
			} );
		}
		console.info( '[EnuFieldUsageCheck]', footprintPoints.map( ( point ) => {
			const rawPoint = this.demoModelConfig?.controlPoints[ point.id ] as unknown as { enu?: [ number, number, number ] } | undefined;
			const configuredEnu = Array.isArray( rawPoint?.enu ) ? tupleToVector3( rawPoint.enu ) : null;
			const configuredDelta = configuredEnu === null ? 0 : configuredEnu.distanceTo( point.worldEnu );
			return {
				controlPointId: point.id,
				rawConfigValue: rawPoint ?? null,
				parsedWorldEnu: vector3ToRoundedObject( point.worldEnu ),
				passedToApplyArFromEnu: vector3ToRoundedObject( point.worldEnu ),
				isAlreadyEnu: true,
				appliedSiteOriginAgain: false,
				axisOrder: 'east,north,up -> Vector3.x,y,z',
				warning: configuredDelta > 0.05
					? `config enu differs from WGS-derived worldEnu by ${configuredDelta.toFixed( 3 )}m`
					: null
			};
		} ) );
		this.store.patch( {
			footprintDiagnostics: {
				...this.store.getState().footprintDiagnostics,
				markerToFootprintDistanceText: `ENU ${distanceMarkerToFootprintCenterEnu.toFixed( 3 )}m / AR ${distanceMarkerToFootprintCenterAr.toFixed( 3 )}m / Δ ${distanceDeltaMeters.toFixed( 3 )}m`,
				markerToFootprintHeadingText: `ENU ${headingMarkerToFootprintEnuDeg.toFixed( 1 )}° / AR ${headingMarkerToFootprintArDeg.toFixed( 1 )}° / Δ ${headingDeltaDeg.toFixed( 1 )}°`,
				footprintShapeText: `边长 ${enuEdgeLengths.map( ( value ) => value.toFixed( 2 ) ).join( '/' )}m，对角 ${enuDiagonals.map( ( value ) => value.toFixed( 2 ) ).join( '/' )}m`,
				footprintControlPointIdsText: footprintControlPointIds.join( ' / ' ),
				enuUsageText: wrongFootprintControlPointsUsed
					? 'footprint 控制点不是预期 707-1~4'
					: 'worldEnu 已是 ENU；未重复套 siteOrigin；轴序 east,north,up -> x,y,z',
				verdictText: distanceDeltaMeters > 0.2 || headingDeltaDeg > 5
					? 'marker->footprint ENU/AR 关系不一致：查 applyArFromEnu / worldEnu / siteOrigin / 轴映射'
					: 'marker 和 footprint 关系一致：若仍不贴现场黄线，优先查 707-1~4 数据语义',
				updatedAtText: new Date().toLocaleTimeString( 'zh-CN', { hour12: false } )
			}
		} );

	}

	private logModelLocalControlPointBoundsCheck(): void {

		if ( this.modelTemplate === null || this.registrationSolution === null ) {
			return;
		}

		const bounds = new THREE.Box3().setFromObject( this.modelTemplate );
		if ( bounds.isEmpty() ) {
			console.warn( '[ModelLocalControlPointBoundsCheck]', {
				modelId: this.demoModelConfig?.modelId ?? null,
				warnings: [ 'model bounding box empty' ]
			} );
			return;
		}

		const size = bounds.getSize( new THREE.Vector3() );
		const bottomTolerance = Math.max( size.y * 0.03, 0.05 );
		const expandedBounds = bounds.clone().expandByScalar( 0.02 );
		const points = this.registrationSolution.controlPoints.slice( 0, 4 ).map( ( point ) => {
			const distanceToBottomPlane = Math.abs( point.modelLocal.y - bounds.min.y );
			return {
				controlPointId: point.id,
				cornerRole: this.resolveControlPointCornerRole( point.id ),
				modelLocal: vector3ToRoundedObject( point.modelLocal ),
				distanceToBottomPlane: Number( distanceToBottomPlane.toFixed( 6 ) ),
				nearBottomPlane: distanceToBottomPlane <= bottomTolerance,
				insideModelBounds: expandedBounds.containsPoint( point.modelLocal )
			};
		} );
		const warnings: string[] = [];
		if ( points.some( ( point ) => point.nearBottomPlane === false ) ) {
			warnings.push( '当前 modelLocal 不是模型底面 footprint 四角，不能用于地面 footprint 配准。' );
		}
		if ( points.some( ( point ) => point.insideModelBounds === false ) ) {
			warnings.push( 'some modelLocal control points are outside model bounding box' );
		}
		const payload = {
			modelId: this.demoModelConfig?.modelId ?? null,
			modelBoundingBox: {
				min: vector3ToRoundedObject( bounds.min ),
				max: vector3ToRoundedObject( bounds.max )
			},
			modelBottomY: Number( bounds.min.y.toFixed( 6 ) ),
			modelTopY: Number( bounds.max.y.toFixed( 6 ) ),
			points,
			warnings
		};

		if ( warnings.length > 0 ) {
			console.warn( '[ModelLocalControlPointBoundsCheck]', payload );
			return;
		}
		console.info( '[ModelLocalControlPointBoundsCheck]', payload );

	}

	private logModelAxisMappingCheck(arFromEnuSolution: ArFromEnuSolution): void {

		const placedModel = this.placementSession.getArPlacedModel();
		if ( placedModel === null || this.registrationSolution === null ) {
			return;
		}

		placedModel.updateMatrixWorld( true );
		const modelDefinition = this.modelSession.getCurrentModelDefinition();
		const primaryAsset = modelDefinition?.assets.find( ( asset ) => asset.id === modelDefinition.primaryAssetId );
		const arFromEnuRotation = tempQuaternion.setFromRotationMatrix(
			tempMatrix.copy( arFromEnuSolution.matrix ).extractRotation( arFromEnuSolution.matrix )
		);
		const finalModelQuaternion = placedModel.getWorldQuaternion( new THREE.Quaternion() );
		const determinant = placedModel.matrixWorld.determinant();
		const finalUp = new THREE.Vector3( 0, 1, 0 ).transformDirection( placedModel.matrixWorld );
		const possibleFlipOrMirror = determinant < 0 || finalUp.y < 0;
		const payload = {
			modelId: this.demoModelConfig?.modelId ?? null,
			modelUpAxis: this.modelTemplate?.userData.__modelUpAxis ?? 'asset-transform-normalized',
			configuredUpAxis: primaryAsset?.assetTransform?.upAxis ?? 'y',
			gltfSceneUpAssumption: 'Three.js +Y after assetTransform normalization',
			enuUpAxis: '+Z',
			arUpAxis: '+Y',
			modelToSiteRotation: quaternionToRoundedObject( this.registrationSolution.modelToSite.rotation ),
			arFromEnuRotation: quaternionToRoundedObject( arFromEnuRotation ),
			finalModelQuaternion: quaternionToRoundedObject( finalModelQuaternion ),
			determinantSign: determinant < 0 ? 'negative' : 'positive',
			determinant: Number( determinant.toFixed( 6 ) ),
			finalUp: vector3ToRoundedObject( finalUp ),
			possibleFlipOrMirror
		};

		if ( possibleFlipOrMirror ) {
			console.warn( '[ModelAxisMappingCheck]', {
				...payload,
				warning: '模型最终矩阵存在翻转 / 镜像 / up 轴朝下'
			} );
			return;
		}
		console.info( '[ModelAxisMappingCheck]', payload );

	}

	private logModelControlPointPlacementCheck(arFromEnuSolution: ArFromEnuSolution): void {

		const placedModel = this.placementSession.getArPlacedModel();
		if ( placedModel === null || this.registrationSolution === null ) {
			console.warn( '[ModelControlPointPlacementCheck]', {
				modelId: this.demoModelConfig?.modelId ?? null,
				warnings: [ 'placed model or registrationSolution missing' ]
			} );
			return;
		}

		placedModel.updateMatrixWorld( true );
		const modelContent = this.getModelContentObject( placedModel );
		modelContent?.updateMatrixWorld( true );
		const rootErrors: number[] = [];
		const contentErrors: number[] = [];
		const points = this.registrationSolution.controlPoints.slice( 0, 4 ).map( ( point ) => {
			const expectedAr = point.worldEnu.clone().applyMatrix4( arFromEnuSolution.matrix );
			const actualArUsingPlacedRoot = placedModel.localToWorld( point.modelLocal.clone() );
			const actualArUsingModelContent = modelContent === null
				? null
				: modelContent.localToWorld( point.modelLocal.clone() );
			const errorRoot = expectedAr.distanceTo( actualArUsingPlacedRoot );
			const errorContent = actualArUsingModelContent === null
				? null
				: expectedAr.distanceTo( actualArUsingModelContent );
			rootErrors.push( errorRoot );
			if ( errorContent !== null ) {
				contentErrors.push( errorContent );
			}
			return {
				controlPointId: point.id,
				cornerRole: this.resolveControlPointCornerRole( point.id ),
				modelLocal: vector3ToRoundedObject( point.modelLocal ),
				targetEnu: vector3ToRoundedObject( point.worldEnu ),
				expectedAr: vector3ToRoundedObject( expectedAr ),
				actualArUsingPlacedRoot: vector3ToRoundedObject( actualArUsingPlacedRoot ),
				actualArUsingModelContent: actualArUsingModelContent === null ? null : vector3ToRoundedObject( actualArUsingModelContent ),
				errorRoot: Number( errorRoot.toFixed( 6 ) ),
				errorContent: errorContent === null ? null : Number( errorContent.toFixed( 6 ) )
			};
		} );
		const maxErrorRoot = Math.max( ...rootErrors, 0 );
		const rmsErrorRoot = computeRms( rootErrors );
		const maxErrorContent = Math.max( ...contentErrors, 0 );
		const rmsErrorContent = computeRms( contentErrors );
		const warnings: string[] = [];
		if ( rmsErrorRoot > MODEL_CONTROL_POINT_PLACEMENT_RMS_LIMIT_METERS ) {
			warnings.push( `root-space RMS ${rmsErrorRoot.toFixed( 3 )}m exceeds ${MODEL_CONTROL_POINT_PLACEMENT_RMS_LIMIT_METERS}m` );
		}
		if ( contentErrors.length > 0 && rmsErrorContent + 0.02 < rmsErrorRoot ) {
			warnings.push( 'modelLocal appears closer in model content local space than placed root local space' );
		}
		const roundedMaxErrorRoot = Number( maxErrorRoot.toFixed( 6 ) );
		const roundedRmsErrorRoot = Number( rmsErrorRoot.toFixed( 6 ) );
		const roundedMaxErrorContent = contentErrors.length === 0 ? null : Number( maxErrorContent.toFixed( 6 ) );
		const roundedRmsErrorContent = contentErrors.length === 0 ? null : Number( rmsErrorContent.toFixed( 6 ) );
		const payload = {
			modelId: this.demoModelConfig?.modelId ?? null,
			placedRootName: placedModel.name || placedModel.type,
			contentObjectName: modelContent?.name || modelContent?.type || null,
			placedRootMatrixWorld: matrixToRoundedArray( placedModel.matrixWorld ),
			contentMatrixWorld: modelContent === null ? null : matrixToRoundedArray( modelContent.matrixWorld ),
			points: points.map( ( point ) => ( {
				...point,
				maxErrorRoot: roundedMaxErrorRoot,
				rmsErrorRoot: roundedRmsErrorRoot,
				maxErrorContent: roundedMaxErrorContent,
				rmsErrorContent: roundedRmsErrorContent
			} ) ),
			maxErrorRoot: roundedMaxErrorRoot,
			rmsErrorRoot: roundedRmsErrorRoot,
			maxErrorContent: roundedMaxErrorContent,
			rmsErrorContent: roundedRmsErrorContent,
			warning: warnings
		};

		console.info( '[ModelControlPointPlacementCheck]', payload );
		const severity = maxErrorRoot > 0.5
			? '模型控制点严重不对齐，请检查 modelLocal 坐标空间 / upAxis / 放置矩阵。'
			: rmsErrorRoot > MODEL_CONTROL_POINT_PLACEMENT_RMS_LIMIT_METERS
				? '模型控制点偏差较大'
				: '控制点基本对齐';
		const message = `模型控制点误差：RMS ${rmsErrorRoot.toFixed( 3 )}m / Max ${maxErrorRoot.toFixed( 3 )}m，状态：${severity}`;
		this.store.patch( { registrationStatusDetail: message } );
		if ( rmsErrorRoot > MODEL_CONTROL_POINT_PLACEMENT_RMS_LIMIT_METERS ) {
			console.error( '[ModelControlPointPlacementMismatch]', payload );
			this.setStatus( message );
		}

	}

	private logModelHierarchyCoordinateSpaceCheck(): void {

		const placedModel = this.placementSession.getArPlacedModel();
		if ( placedModel === null || this.registrationSolution === null ) {
			return;
		}

		placedModel.updateMatrixWorld( true );
		const modelContent = this.getModelContentObject( placedModel );
		modelContent?.updateMatrixWorld( true );
		const rootBounds = computeBoundsInLocalSpace( placedModel, placedModel );
		const contentBounds = modelContent === null ? null : computeBoundsInLocalSpace( modelContent, modelContent );
		const report = readPlaceableTemplateReport( this.modelTemplate ?? placedModel );
		console.info( '[ModelHierarchyCoordinateSpaceCheck]', {
			loadedModelRootName: placedModel.name || placedModel.type,
			contentObjectName: modelContent?.name || modelContent?.type || null,
			rootChildren: placedModel.children.map( ( child ) => child.name || child.type ),
			rootMatrix: matrixToRoundedArray( placedModel.matrix ),
			rootMatrixWorld: matrixToRoundedArray( placedModel.matrixWorld ),
			contentMatrix: modelContent === null ? null : matrixToRoundedArray( modelContent.matrix ),
			contentMatrixWorld: modelContent === null ? null : matrixToRoundedArray( modelContent.matrixWorld ),
			modelUpAxisConfig: this.modelTemplate?.userData.__modelUpAxis ?? 'asset-transform-normalized',
			unitScale: report?.unitScale ?? null,
			pivotOffset: report === null ? null : vector3ToRoundedObject( report.pivotOffset ),
			assetCorrectionRotation: modelContent === null ? null : {
				rotation: {
					x: Number( modelContent.rotation.x.toFixed( 6 ) ),
					y: Number( modelContent.rotation.y.toFixed( 6 ) ),
					z: Number( modelContent.rotation.z.toFixed( 6 ) )
				}
			},
			bboxRoot: boxToRoundedObject( rootBounds ),
			bboxContent: contentBounds === null ? null : boxToRoundedObject( contentBounds ),
			controlPoints: this.registrationSolution.controlPoints.slice( 0, 4 ).map( ( point ) => ( {
				controlPointId: point.id,
				modelLocal: vector3ToRoundedObject( point.modelLocal ),
				insideRootBBox: rootBounds.containsPoint( point.modelLocal ),
				insideContentBBox: contentBounds?.containsPoint( point.modelLocal ) ?? null,
				nearRootBottom: Math.abs( point.modelLocal.y - rootBounds.min.y ) <= 0.05,
				nearContentBottom: contentBounds === null ? null : Math.abs( point.modelLocal.y - contentBounds.min.y ) <= 0.05
			} ) )
		} );

	}

	private logModelLocalFootprintCheck(): void {

		const placedModel = this.placementSession.getArPlacedModel();
		if ( placedModel === null || this.registrationSolution === null ) {
			return;
		}

		const modelContent = this.getModelContentObject( placedModel );
		const bboxRoot = computeBoundsInLocalSpace( placedModel, placedModel );
		const bboxContent = modelContent === null ? null : computeBoundsInLocalSpace( modelContent, modelContent );
		const toleranceRoot = Math.max( bboxRoot.getSize( new THREE.Vector3() ).y * 0.03, 0.05 );
		const toleranceContent = bboxContent === null ? 0 : Math.max( bboxContent.getSize( new THREE.Vector3() ).y * 0.03, 0.05 );
		let rootHits = 0;
		let contentHits = 0;
		const points = this.registrationSolution.controlPoints.slice( 0, 4 ).map( ( point ) => {
			const distanceToBottomPlaneRoot = Math.abs( point.modelLocal.y - bboxRoot.min.y );
			const distanceToBottomPlaneContent = bboxContent === null ? null : Math.abs( point.modelLocal.y - bboxContent.min.y );
			const isInsideBBoxRoot = bboxRoot.containsPoint( point.modelLocal );
			const isInsideBBoxContent = bboxContent?.containsPoint( point.modelLocal ) ?? false;
			if ( isInsideBBoxRoot && distanceToBottomPlaneRoot <= toleranceRoot ) {
				rootHits += 1;
			}
			if ( isInsideBBoxContent && distanceToBottomPlaneContent !== null && distanceToBottomPlaneContent <= toleranceContent ) {
				contentHits += 1;
			}
			return {
				controlPointId: point.id,
				modelLocal: vector3ToRoundedObject( point.modelLocal ),
				distanceToBottomPlaneRoot: Number( distanceToBottomPlaneRoot.toFixed( 6 ) ),
				distanceToBottomPlaneContent: distanceToBottomPlaneContent === null ? null : Number( distanceToBottomPlaneContent.toFixed( 6 ) ),
				isInsideBBoxRoot,
				isInsideBBoxContent
			};
		} );
		const likelySpace = contentHits > rootHits ? 'content' : rootHits > 0 ? 'root' : 'unknown';
		const warning = likelySpace === 'unknown'
			? '707-1~707-4.modelLocal 不是模型底面 footprint 四角，模型无法落入黄色框。请重新量取模型底面四角或启用 bbox footprint 临时测试。'
			: null;
		const payload = {
			bboxRoot: boxToRoundedObject( bboxRoot ),
			bboxContent: bboxContent === null ? null : boxToRoundedObject( bboxContent ),
			bottomYRoot: Number( bboxRoot.min.y.toFixed( 6 ) ),
			bottomYContent: bboxContent === null ? null : Number( bboxContent.min.y.toFixed( 6 ) ),
			points,
			likelySpace,
			warning
		};

		if ( warning !== null ) {
			console.warn( '[ModelLocalFootprintCheck]', payload );
			return;
		}
		console.info( '[ModelLocalFootprintCheck]', payload );

	}

	private applyDirectControlPointPlacementIfEnabled(arFromEnuSolution: ArFromEnuSolution): void {

		if ( DIRECT_CONTROL_POINT_PLACEMENT_ENABLED === false ) {
			return;
		}

		const placedModel = this.placementSession.getArPlacedModel();
		if ( placedModel === null || this.registrationSolution === null ) {
			return;
		}

		const modelContent = this.getModelContentObject( placedModel );
		const controlPoints = this.registrationSolution.controlPoints.slice( 0, 4 );
		const targetAr = controlPoints.map( ( point ) => point.worldEnu.clone().applyMatrix4( arFromEnuSolution.matrix ) );
		const contentLocalToRootMatrix = modelContent === null
			? null
			: getRelativeMatrix( modelContent, placedModel );
		const rootCandidate = this.createDirectPlacementCandidate(
			'root',
			controlPoints.map( ( point ) => point.modelLocal.clone() ),
			targetAr,
			placedModel,
			null
		);
		const contentCandidate = contentLocalToRootMatrix === null
			? null
			: this.createDirectPlacementCandidate(
				'content',
				controlPoints.map( ( point ) => point.modelLocal.clone() ),
				targetAr,
				placedModel,
				contentLocalToRootMatrix
			);
		const candidate = contentCandidate !== null && contentCandidate.rmsError + 0.02 < rootCandidate.rmsError
			? contentCandidate
			: rootCandidate;

		console.warn( '[DirectControlPointPlacementEnabled]', {
			reason: 'dev verification only; fitting modelLocal control points to expected AR footprint',
			modelId: this.demoModelConfig?.modelId ?? null,
			chosenControlPointSpace: candidate.controlPointSpace,
			rootRmsError: Number( rootCandidate.rmsError.toFixed( 6 ) ),
			contentRmsError: contentCandidate === null ? null : Number( contentCandidate.rmsError.toFixed( 6 ) )
		} );

		this.applyPlacedRootWorldMatrix( placedModel, candidate.placedRootMatrixWorld );
		if ( candidate.controlPointSpace === 'content' && contentLocalToRootMatrix !== null ) {
			console.info( '[ContentSpacePlacementMatrixComputed]', {
				controlPointSpace: 'content',
				contentLocalToRootMatrix: matrixToRoundedArray( contentLocalToRootMatrix ),
				inverseContentLocalToRootMatrix: matrixToRoundedArray( contentLocalToRootMatrix.clone().invert() ),
				contentLocalToArMatrix: matrixToRoundedArray( candidate.sourceLocalToArMatrix ),
				placedRootMatrixWorld: matrixToRoundedArray( candidate.placedRootMatrixWorld ),
				verificationRmsError: Number( candidate.rmsError.toFixed( 6 ) )
			} );
			return;
		}
		console.info( '[RootSpacePlacementMatrixComputed]', {
			controlPointSpace: 'root',
			rootLocalToArMatrix: matrixToRoundedArray( candidate.sourceLocalToArMatrix ),
			placedRootMatrixWorld: matrixToRoundedArray( candidate.placedRootMatrixWorld ),
			verificationRmsError: Number( candidate.rmsError.toFixed( 6 ) )
		} );

	}

	private createDirectPlacementCandidate(
		controlPointSpace: 'root' | 'content',
		sourceLocalPoints: THREE.Vector3[],
		targetArPoints: THREE.Vector3[],
		placedModel: THREE.Group,
		contentLocalToRootMatrix: THREE.Matrix4 | null
	): {
		controlPointSpace: 'root' | 'content';
		sourceLocalToArMatrix: THREE.Matrix4;
		placedRootMatrixWorld: THREE.Matrix4;
		rmsError: number;
	} {

		const fit = solveSimilarityTransform( sourceLocalPoints, targetArPoints, 'similarity' );
		const sourceLocalToArMatrix = fit.matrix.clone();
		const placedRootMatrixWorld = controlPointSpace === 'content' && contentLocalToRootMatrix !== null
			? sourceLocalToArMatrix.clone().multiply( contentLocalToRootMatrix.clone().invert() )
			: sourceLocalToArMatrix.clone();
		const verificationErrors = this.registrationSolution?.controlPoints.slice( 0, 4 ).map( ( point, index ) => {
			const rootLocal = controlPointSpace === 'content' && contentLocalToRootMatrix !== null
				? point.modelLocal.clone().applyMatrix4( contentLocalToRootMatrix )
				: point.modelLocal.clone();
			return rootLocal.applyMatrix4( placedRootMatrixWorld ).distanceTo( targetArPoints[ index ] );
		} ) ?? [];

		void placedModel;
		return {
			controlPointSpace,
			sourceLocalToArMatrix,
			placedRootMatrixWorld,
			rmsError: computeRms( verificationErrors )
		};

	}

	private applyPlacedRootWorldMatrix(placedModel: THREE.Group, rootWorldMatrix: THREE.Matrix4): void {

		const parentInverse = placedModel.parent === null
			? new THREE.Matrix4()
			: placedModel.parent.matrixWorld.clone().invert();
		const localMatrix = rootWorldMatrix.clone().premultiply( parentInverse );
		placedModel.matrixAutoUpdate = false;
		placedModel.matrix.copy( localMatrix );
		placedModel.matrix.decompose( placedModel.position, placedModel.quaternion, placedModel.scale );
		placedModel.updateMatrixWorld( true );

	}

	private logModelFinalAxisCheck(): void {

		const placedModel = this.placementSession.getArPlacedModel();
		if ( placedModel === null ) {
			return;
		}

		placedModel.updateMatrixWorld( true );
		const modelContent = this.getModelContentObject( placedModel );
		const origin = placedModel.localToWorld( new THREE.Vector3() );
		const upPoint = placedModel.localToWorld( new THREE.Vector3( 0, 1, 0 ) );
		const modelWorldUp = upPoint.sub( origin ).normalize();
		const dotWithArUp = modelWorldUp.dot( new THREE.Vector3( 0, 1, 0 ) );
		const determinant = placedModel.matrixWorld.determinant();
		const payload = {
			finalQuaternion: quaternionToRoundedObject( placedModel.getWorldQuaternion( new THREE.Quaternion() ) ),
			modelWorldUp: vector3ToRoundedObject( modelWorldUp ),
			dotWithArUp: Number( dotWithArUp.toFixed( 6 ) ),
			determinant: Number( determinant.toFixed( 6 ) ),
			modelUpAxis: this.modelTemplate?.userData.__modelUpAxis ?? 'asset-transform-normalized',
			contentRotation: modelContent === null ? null : {
				x: Number( modelContent.rotation.x.toFixed( 6 ) ),
				y: Number( modelContent.rotation.y.toFixed( 6 ) ),
				z: Number( modelContent.rotation.z.toFixed( 6 ) )
			},
			warning: dotWithArUp < 0 || determinant < 0
				? '模型最终 up 轴朝下，检查 upAxis、content.rotation、modelLocal 坐标空间和矩阵乘法顺序。'
				: null
		};
		if ( dotWithArUp < 0 ) {
			console.error( '[ModelUpsideDownDetected]', payload );
			const rootPosition = placedModel.getWorldPosition( new THREE.Vector3() );
			const rootQuaternion = placedModel.getWorldQuaternion( new THREE.Quaternion() );
			const rootScale = placedModel.getWorldScale( new THREE.Vector3() );
			const correction = new THREE.Quaternion().setFromUnitVectors( modelWorldUp, new THREE.Vector3( 0, 1, 0 ) );
			const correctedQuaternion = correction.multiply( rootQuaternion );
			const correctedMatrix = new THREE.Matrix4().compose( rootPosition, correctedQuaternion, rootScale );
			this.applyPlacedRootWorldMatrix( placedModel, correctedMatrix );
			placedModel.updateMatrixWorld( true );
			const correctedUp = new THREE.Vector3( 0, 1, 0 ).transformDirection( placedModel.matrixWorld ).normalize();
			console.warn( '[ModelUpwardCorrectionApplied]', {
				reason: 'model local up was facing down after engineering placement',
				beforeDotWithArUp: Number( dotWithArUp.toFixed( 6 ) ),
				afterDotWithArUp: Number( correctedUp.dot( new THREE.Vector3( 0, 1, 0 ) ).toFixed( 6 ) ),
				rootPosition: vector3ToRoundedObject( rootPosition ),
				finalQuaternion: quaternionToRoundedObject( placedModel.getWorldQuaternion( new THREE.Quaternion() ) )
			} );
			return;
		}
		if ( determinant < 0 ) {
			console.warn( '[ModelFinalAxisCheck]', payload );
			return;
		}
		console.info( '[ModelFinalAxisCheck]', payload );

	}

	private getModelContentObject(root: THREE.Group): THREE.Object3D | null {

		return root.children.find( ( child ) => child.userData.__nonSelectableHelper !== true ) ?? root.children[ 0 ] ?? null;

	}

	private resolveControlPointCornerRole(controlPointId: string): unknown {

		const rawPoint = this.demoModelConfig?.controlPoints[ controlPointId ] as unknown as Record<string, unknown> | undefined;
		return rawPoint?.cornerRole ?? null;

	}

	private applyCurrentSessionMarkerSolution(
		solution: MarkerLocalizationSolution,
		metadata: {
			markerId: string;
			markerConfigId: string;
			source?: 'marker-calibration';
			placeModel?: boolean;
			capturedCornersAr?: THREE.Vector3[];
		}
	): boolean {

		return this.applyCurrentSessionMarkerSolutionOnly( solution, metadata );

	}

	private applyCurrentSessionMarkerSolutionOnly(
		solution: MarkerLocalizationSolution,
		metadata: {
			markerId: string;
			markerConfigId: string;
			source?: 'marker-calibration';
			placeModel?: boolean;
			capturedCornersAr?: THREE.Vector3[];
		}
	): boolean {

		if ( this.currentArSessionId === null ) {
			this.setStatus( '当前 AR Session 已失效，请重新开始 Marker 校正。' );
			return false;
		}

		if ( solution.arFromEnuSolution.sessionId !== this.currentArSessionId ) {
			console.warn( '[CrossSessionSolutionRejected]', {
				mode: this.workflowMode,
				siteId: this.demoModelConfig?.modelId ?? null,
				sessionId: this.currentArSessionId,
				source: solution.arFromEnuSolution.source,
				targetId: metadata.markerId,
				createdAt: solution.arFromEnuSolution.timestamp,
				trackingState: 'session-mismatch',
				stableFrameCount: 0,
				solutionSessionId: solution.arFromEnuSolution.sessionId ?? null
			} );
			this.setStatus( 'Marker 校正结果属于旧会话，不能应用到当前 AR Session。' );
			return false;
		}

		if ( this.registrationSolution === null || this.modelTemplate === null ) {
			this.setStatus( '模型工程配准尚未准备完成，暂时无法应用 Marker 校正。' );
			return false;
		}

		const currentControlTargets = this.getCurrentControlTargets();
		const hasMockEngineeringData = this.demoModelConfig !== null
			&& hasMockEngineeringDataInConfig( this.demoModelConfig, currentControlTargets );
		if (
			this.demoModelConfig !== null
			&& hasMockEngineeringData
			&& canApplyMockEngineeringCalibration() === false
		) {
			console.warn( '[MockEngineeringMarkerLocalizationRejected]', {
				mode: this.workflowMode,
				siteId: this.demoModelConfig.modelId,
				modelId: this.demoModelConfig.modelId,
				sessionId: this.currentArSessionId,
				source: solution.arFromEnuSolution.source,
				targetId: metadata.markerId,
				capturedPointCount: solution.correspondenceCount,
				hasCornersEnu: currentControlTargets.some(
					(target) => (
						target.id === metadata.markerId || target.markerId === metadata.markerId
					) && target.cornersEnu !== undefined
				),
				createdAt: Date.now()
			} );
			this.setStatus( '当前为示例工程坐标，请替换为 RTK 实测数据后再完成正式空间校正。' );
			return false;
		}
		if ( this.demoModelConfig !== null && hasMockEngineeringData ) {
			console.warn( '[MockEngineeringMarkerLocalizationAllowedInDev]', {
				mode: this.workflowMode,
				siteId: this.demoModelConfig.modelId,
				sessionId: this.currentArSessionId,
				targetId: metadata.markerId,
				allowMockCalibration: true,
				createdAt: Date.now()
			} );
		}

		const fallbackSolution = this.activeMarkerArFromEnuSolution === null
			? this.getCurrentNonMarkerArFromEnuSolution()
			: this.markerCorrectionFallbackArFromEnuSolution;
		this.markerCorrectionFallbackArFromEnuSolution = fallbackSolution === null
			? null
			: cloneArFromEnuSolution( fallbackSolution );
		this.activeMarkerArFromEnuSolution = cloneArFromEnuSolution( solution.arFromEnuSolution );
		this.activeMarkerLocalizationResult = {
			markerId: metadata.markerId,
			markerConfigId: metadata.markerConfigId,
			timestamp: solution.arFromEnuSolution.timestamp,
			source: 'marker',
			matrix: solution.matrix.clone(),
			siteOriginArPosition: vector3ToObject( solution.siteOriginArPosition ),
			headingDeg: solution.headingDeg,
			rmsErrorMeters: solution.rmsErrorMeters,
			sampleCount: solution.correspondenceCount
		};
		const currentTarget = currentControlTargets
			.find( ( target ) => target.id === metadata.markerId || target.markerId === metadata.markerId );
		console.info( '[CurrentSessionLocalizationCached]', {
			mode: 'marker-corners-4',
			workflowMode: this.workflowMode,
			siteId: this.demoModelConfig?.modelId ?? null,
			modelId: this.demoModelConfig?.modelId ?? null,
			sessionId: this.currentArSessionId,
			targetId: metadata.markerId,
			currentCorner: null,
			capturedPointCount: solution.correspondenceCount,
			arLocalPosition: null,
			cornersEnu: currentTarget?.cornersEnu ?? null,
			source: solution.arFromEnuSolution.source,
			hasSiteOrigin: this.demoModelConfig !== null,
			hasModelLocalToEnu: this.registrationSolution !== null,
			modelLocalToEnuSource: this.demoModelConfig?.configCompleteness.hasExplicitModelLocalToEnu === true
				? 'explicit'
				: this.registrationSolution === null ? 'missing' : 'control-points',
			hasCornersEnu: currentTarget?.cornersEnu !== undefined,
			hasRtkSurveyDataset: ( this.demoModelConfig?.rtkSurveyDataset?.points.length ?? 0 ) > 0,
			hitTestReady: this.xrRuntime.getHitTestController().hasGroundHit(),
			localizationReady: true,
			modelPlaced: this.placementSession.getPlacedModel() !== null,
			createdAt: Date.now()
		} );

		this.logCoordinateAxisMappingCheck( solution.arFromEnuSolution );
		this.logFootprintEnuToArCheck( solution.arFromEnuSolution, currentTarget ?? null );
		const autoPlacementPendingBefore = this.placementSession.getAutoPlacementPending();
		const placedModelBefore = this.placementSession.getPlacedModel();
		const modelPlacedBefore = placedModelBefore !== null;
		const modelVisibleBefore = placedModelBefore?.visible === true;
		const placeModel = metadata.placeModel === true;
		this.placementSession.cancelAutoPlacement();
		this.renderEngineeringCornerDebug(
			solution.arFromEnuSolution,
			currentTarget ?? null,
			metadata.capturedCornersAr ?? []
		);
		const appliedToPlacedModel = false;
		const autoPlacementPendingAfter = this.placementSession.getAutoPlacementPending();
		const placedModelAfter = this.placementSession.getPlacedModel();
		const modelPlacedAfter = placedModelAfter !== null;
		const modelVisibleAfter = placedModelAfter?.visible === true;
		const modelWasPlacedAutomatically = modelPlacedBefore === false
			&& modelPlacedAfter;
		console.info( '[MarkerCalibrationApplyFlow]', {
			clickedApplyCalibration: true,
			solveAndApplyCalled: true,
			applyCurrentSessionMarkerSolutionCalled: true,
			applyArLocalizationSolutionCalled: false,
			attemptLocalizedPlacementCalled: false,
			autoPlacementPendingBefore,
			autoPlacementPendingAfter,
			placeFromPlacementBaseCalled: false,
			modelWasPlacedAutomatically,
			placeModelRequested: placeModel,
			autoPlaceAfterMarkerCalibration: AUTO_PLACE_AFTER_MARKER_CALIBRATION
		} );
		console.info( '[MarkerCalibrationCompletedWithoutPlacement]', {
			markerId: metadata.markerId,
			sessionId: this.currentArSessionId,
			hasArFromEnuSolution: this.activeMarkerArFromEnuSolution !== null,
			autoPlacementPendingBefore,
			autoPlacementPendingAfter,
			modelVisibleBefore,
			modelVisibleAfter,
			modelPlacedBefore,
			modelPlacedAfter
		} );
		if ( autoPlacementPendingAfter ) {
			console.warn( '[MarkerCalibrationAutoPlacementPendingNotCleared]', {
				markerId: metadata.markerId,
				sessionId: this.currentArSessionId,
				autoPlacementPendingBefore,
				autoPlacementPendingAfter
			} );
		}
		if ( placeModel ) {
			console.warn( '[MarkerCalibrationPlaceModelIgnored]', {
				markerId: metadata.markerId,
				sessionId: this.currentArSessionId,
				reason: 'marker calibration never places model; use engineering placement action'
			} );
		}
		if ( modelWasPlacedAutomatically ) {
			this.logUnexpectedAutoPlacementAfterCalibration( 'applyCurrentSessionMarkerSolutionOnly', metadata.markerId );
		}

		this.syncRegistrationChainDebug();
		if ( this.workflowMode === 'site-baseline-config' ) {
			console.info( '[SiteBaselineConfigTemporarySolutionCreated]', {
				mode: this.workflowMode,
				siteId: this.demoModelConfig?.modelId ?? null,
				sessionId: this.currentArSessionId,
				source: solution.arFromEnuSolution.source,
				targetId: metadata.markerId,
				createdAt: solution.arFromEnuSolution.timestamp,
				trackingState: 'applied',
				stableFrameCount: solution.correspondenceCount
			} );
		} else {
			console.info( '[ArInspectionLocalizationApplied]', {
				mode: this.workflowMode,
				siteId: this.demoModelConfig?.modelId ?? null,
				sessionId: this.currentArSessionId,
				source: solution.arFromEnuSolution.source,
				targetId: metadata.markerId,
				createdAt: solution.arFromEnuSolution.timestamp,
				trackingState: 'applied',
				stableFrameCount: solution.correspondenceCount
			} );
		}
		console.info( '[MarkerCorrectionApplied]', {
			sessionId: this.currentArSessionId,
			markerId: metadata.markerId,
			markerConfigId: metadata.markerConfigId,
			timestamp: solution.arFromEnuSolution.timestamp,
			ageSeconds: 0,
			rmsErrorMeters: solution.rmsErrorMeters,
			headingDeg: solution.headingDeg,
			siteOriginArPosition: vector3ToObject( solution.siteOriginArPosition ),
			matrix: solution.matrix.toArray(),
			appliedToPlacedModel
		} );
		this.logRegistrationFinal();
		this.setStatus(
			'Marker 校正已完成，工程坐标已对齐，请点击工程放置模型。'
		);
		this.emit();
		return true;

	}

	private logUnexpectedAutoPlacementAfterCalibration(caller: string, markerId: string): void {

		console.error( '[UnexpectedAutoPlacementAfterCalibration]', {
			caller,
			markerId,
			sessionId: this.currentArSessionId,
			autoPlacementPending: this.placementSession.getAutoPlacementPending(),
			hasArFromEnuSolution: this.activeMarkerArFromEnuSolution !== null,
			stack: new Error().stack
		} );

	}

	private async placeModelFromCurrentMarkerSolution(guard: EngineeringPlacementGuardResult): Promise<void> {

		const arFromEnuSolution = guard.arFromEnuSolution ?? this.getActiveMarkerArFromEnuSolutionForCurrentSession();
		if ( arFromEnuSolution === null ) {
			this.setStatus( '请先完成 Marker 四角点校正后再进行工程放置。' );
			return;
		}

		await this.placementWorkflow.placeLocalizedModel();
		if ( this.placementSession.getPlacedModel() === null ) {
			return;
		}

		this.logModelHierarchyCoordinateSpaceCheck();
		this.logModelLocalFootprintCheck();
		this.applyDirectControlPointPlacementIfEnabled( arFromEnuSolution );
		this.logModelFinalAxisCheck();
		this.renderEngineeringCornerDebug(
			arFromEnuSolution,
			guard.controlTarget ?? this.getActiveEngineeringControlTarget(),
			[]
		);
		this.logModelAxisMappingCheck( arFromEnuSolution );
		this.logModelControlPointPlacementCheck( arFromEnuSolution );
		this.logEngineeringPlacementApplied( arFromEnuSolution, guard.controlTarget ?? null );

	}

	private getActiveArFromEnuSolution(): ArFromEnuSolution | null {

		return this.arLocalizationRuntime.getActiveArFromEnuSolution();

	}

	private getCurrentNonMarkerArFromEnuSolution(): ArFromEnuSolution | null {

		return this.arLocalizationRuntime.getCurrentNonMarkerArFromEnuSolution();

	}

	private getPreferredFormalLocalizationOverride(): ArFromEnuSolution | null {

		const markerSolution = this.getActiveMarkerArFromEnuSolutionForCurrentSession();
		if ( markerSolution !== null ) {
			console.info( '[LocalizationPriorityResolved]', {
				mode: this.workflowMode,
				siteId: this.demoModelConfig?.modelId ?? null,
				sessionId: this.currentArSessionId,
				source: markerSolution.source,
				createdAt: Date.now()
			} );
			return markerSolution;
		}

		const nonMarkerSolution = this.getCurrentNonMarkerArFromEnuSolution();
		if ( nonMarkerSolution !== null && nonMarkerSolution.source === 'rtk' ) {
			console.info( '[LocalizationPriorityResolved]', {
				mode: this.workflowMode,
				siteId: this.demoModelConfig?.modelId ?? null,
				sessionId: this.currentArSessionId,
				source: nonMarkerSolution.source,
				createdAt: Date.now()
			} );
			return nonMarkerSolution;
		}

		return null;

	}

	private getMarkerCorrectionFallbackSolution(): ArFromEnuSolution | null {

		return this.arLocalizationRuntime.getMarkerCorrectionFallbackSolution();

	}

	private getActiveMarkerArFromEnuSolutionForCurrentSession(): ArFromEnuSolution | null {

		return this.arLocalizationRuntime.getActiveMarkerArFromEnuSolutionForCurrentSession();

	}

	private resetMarkerLocalizationCorrection(): void {

		this.activeMarkerArFromEnuSolution = null;
		this.activeMarkerLocalizationResult = null;
		this.markerCorrectionFallbackArFromEnuSolution = null;
		this.clearEngineeringCornerDebug();

	}

	private logRegistrationFinal(): void {

		const arFromEnuSolution = this.getActiveArFromEnuSolution();
		const placedModel = this.placementSession.getArPlacedModel();
		placedModel?.updateMatrixWorld( true );
		console.info( '[RegistrationFinal]', {
			currentArLocalizationSource: this.store.getState().registrationChainDebug.arSessionLocalization.source,
			arFromEnuSource: arFromEnuSolution?.source ?? 'unknown',
			modelRootMatrix: placedModel === null ? null : placedModel.matrixWorld.toArray()
		} );

	}

	private resolveConfiguredMarkerPoses(config: DemoModelConfig): MarkerPoseInEnu[] {

		return config.markers.flatMap( ( marker ) => {
			try {
				return [ resolveMarkerPoseInEnu( config, marker.id ) ];
			} catch ( error ) {
				console.warn(
					`Failed to resolve marker engineering pose for ${marker.id}:`,
					error
				);
				return [];
			}
		} );

	}

	private appendLog(message: string): void {

		const currentLogs = this.store.getState().logMessages;
		if ( currentLogs[ 0 ]?.endsWith( message ) ) {
			return;
		}

		const timestamp = new Date().toLocaleTimeString( 'zh-CN', {
			hour12: false,
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		} );
		this.store.patch( {
			logMessages: [ `[${timestamp}] ${message}`, ...currentLogs ].slice( 0, MAX_LOG_ITEMS )
		} );

	}

	private getCurrentViewerArPosition(): THREE.Vector3 | null {

		if ( this.sceneBundle.renderer.xr.isPresenting === false ) {
			return null;
		}

		return this.sceneBundle.renderer.xr.getCamera().getWorldPosition( tempViewerArPosition ).clone();

	}


	private handleXRSessionStart(): void {

		this.sessionLifecycleRuntime.handleXRSessionStart();

	}

	private handleXRSessionEnd(): void {

		this.arSessionEndPending = false;
		this.currentArSessionRequestMode = 'normal';
		this.sessionLifecycleRuntime.handleXRSessionEnd();

	}

	private handlePlacementCompleted(): void {

		this.sessionLifecycleRuntime.handlePlacementCompleted();

	}

	private syncSceneHost(): void {

		this.sceneBundle.arPlacementAnchor.visible = this.sceneBundle.renderer.xr.isPresenting;
		this.sceneBundle.arModelAnchor.visible = this.sceneBundle.renderer.xr.isPresenting;
		this.syncAttachmentInfoBoardVisibility();
		this.sceneHostRuntime.sync();

	}

	private syncDisplayModeState(): void {

		this.visualizationStateRuntime.syncDisplayModeState();

	}

	private syncVisualizationState(): void {

		this.visualizationStateRuntime.syncVisualizationState();

	}

	private syncAnnotationLabels(): void {

		const state = this.store.getState();
		const placedModel = state.appMode === 'ar-session'
			&& state.arSessionPhase === 'placed'
			? this.placementSession.getArPlacedModel()
			: null;
		const signature = [
			state.appMode,
			state.arSessionPhase,
			placedModel?.uuid ?? 'none',
			state.modelLayers.map( ( layer ) => `${layer.id}:${layer.visible ? '1' : '0'}` ).join( '|' )
		].join( '::' );
		if ( signature === this.lastAnnotationLabelsSignature ) {
			return;
		}

		this.lastAnnotationLabelsSignature = signature;
		if ( placedModel === null ) {
			this.annotationLabelsController.clear();
			this.clearAnnotationDetail();
			console.info( '[ArAnnotationLabels]', {
				labelCount: 0,
				source: 'terrain-layer',
				modelPlaced: false,
				visible: false
			} );
			return;
		}

		const items = this.buildAnnotationItemsForPlacedModel( placedModel );
		this.annotationLabelsController.setItems( items );
		console.info( '[ArAnnotationLabels]', {
			labelCount: items.length,
			source: 'terrain-layer',
			modelPlaced: true,
			visible: items.length > 0
		} );

	}

	private buildAnnotationItemsForPlacedModel(placedModel: THREE.Group): ArAnnotationItem[] {

		const items: ArAnnotationItem[] = [];
		for ( const layer of this.store.getState().modelLayers ) {
			const targetObject = findLayerObjectById( placedModel, layer.id );
			if ( targetObject === null || targetObject.visible === false ) {
				continue;
			}

			const businessName = getBusinessNameFromObject( targetObject );
			const properties = businessName.length > 0
				? this.pipesByName.get( businessName ) ?? null
				: null;
			items.push( {
				id: layer.id,
				title: layer.label,
				subtitle: `terrain-layer #${layer.orderIndex + 1}`,
				description: properties?.remark,
				layerName: layer.label,
				objectName: targetObject.name || businessName,
				properties: properties === null ? undefined : recordToAnnotationProperties( properties ),
				targetObject
			} );
		}

		return items;

	}

	private handleAnnotationSelection(item: ArAnnotationItem): void {

		const businessName = getBusinessNameFromObject( item.targetObject );
		const properties = businessName.length > 0
			? this.pipesByName.get( businessName ) ?? null
			: null;
		this.propertySelection.selectBusinessObject( item.targetObject, properties );
		this.updateAnnotationDetailFromSelection( item.targetObject, properties, item.layerName );
		console.info( '[ArAnnotationSelected]', {
			id: item.id,
			title: item.title,
			objectName: item.objectName ?? item.targetObject.name,
			layerName: item.layerName ?? ''
		} );
		this.setStatus( `已选择 ${item.title}。` );
		this.emit();

	}

	private updateAnnotationDetailFromSelection(
		businessObject: THREE.Object3D,
		properties: PipeRecord | null,
		preferredLayerName?: string
	): void {

		const detailState = this.createAnnotationDetailState(
			businessObject,
			properties,
			preferredLayerName
		);
		this.store.patch( {
			annotationDetail: detailState
		} );
		this.annotationLabelsController.setDetail(
			this.createAnnotationDetailOverlay( businessObject, detailState )
		);

	}

	private clearAnnotationDetail(): void {

		const current = this.store.getState().annotationDetail;
		if ( current.visible === false && current.fields.length === 0 ) {
			return;
		}

		this.store.patch( { annotationDetail: createDefaultAnnotationDetailState() } );
		this.annotationLabelsController.setDetail( null );

	}

	private createAnnotationDetailState(
		businessObject: THREE.Object3D,
		properties: PipeRecord | null,
		preferredLayerName?: string
	): AnnotationDetailState {

		const bounds = new THREE.Box3().setFromObject( businessObject );
		const center = bounds.getCenter( new THREE.Vector3() );
		const size = bounds.getSize( new THREE.Vector3() );
		const materialName = getObjectMaterialName( businessObject );
		const layerName = preferredLayerName
			?? getLayerLabelForObject( businessObject, this.store.getState().modelLayers )
			?? '未分层';
		const thickness = properties?.diameter
			?? `${size.y.toFixed( 2 )}m`;
		const remark = properties?.remark
			?? `尺寸 ${size.x.toFixed( 2 )} x ${size.y.toFixed( 2 )} x ${size.z.toFixed( 2 )}m`;

		return {
			visible: true,
			title: properties?.name ?? ( getBusinessNameFromObject( businessObject ) || businessObject.name || '未命名构件' ),
			subtitle: layerName,
			fields: [
				{ label: '类型', value: properties?.type || businessObject.type || '-' },
				{ label: '材质', value: properties?.material || materialName || '-' },
				{ label: '高程', value: `${center.y.toFixed( 2 )}m` },
				{ label: '厚度', value: thickness },
				{ label: '状态', value: properties?.status || ( businessObject.visible ? '可见' : '隐藏' ) },
				{ label: '备注', value: remark }
			]
		};

	}

	private createAnnotationDetailOverlay(
		targetObject: THREE.Object3D,
		detailState: AnnotationDetailState
	): ArAnnotationDetailOverlay | null {

		if ( detailState.visible === false || detailState.fields.length === 0 ) {
			return null;
		}

		return {
			targetObject,
			title: detailState.title,
			subtitle: detailState.subtitle,
			fields: detailState.fields
		};

	}

	private syncArSessionPhase(): void {

		this.arSessionStateRuntime.syncPhase();

	}

	private updateTargetGuidance(): void {

		const nextGuidance = this.sceneBundle.renderer.xr.isPresenting
			? computeTargetGuidanceState(
				this.placementSession.getPlacedModel(),
				this.sceneBundle.renderer.xr.getCamera()
			)
			: createDefaultTargetGuidanceState();
		const nextSignature = nextGuidance.visible
			? `${nextGuidance.alignment}|${nextGuidance.directionText}|${nextGuidance.distanceText}|${nextGuidance.detailText}`
			: 'hidden';

		if ( nextSignature === this.targetGuidanceSignature ) {
			return;
		}

		this.targetGuidanceSignature = nextSignature;
		this.store.patch( { targetGuidance: nextGuidance } );

	}

	private bindArSelectionSession = (): void => {

		const session = this.sceneBundle.renderer.xr.getSession();
		session?.addEventListener( 'select', this.pointerSelection.handleArSelect );

	};

	private unbindArSelectionSession = (): void => {

		const session = this.sceneBundle.renderer.xr.getSession();
		session?.removeEventListener( 'select', this.pointerSelection.handleArSelect );

	};

	private shouldHandleGlobalArPointerEvent(event: PointerEvent): boolean {

		if ( this.sceneBundle.renderer.xr.isPresenting === false ) {
			return false;
		}

		const target = event.target;
		if ( target instanceof Element ) {
			return target.closest( '[data-ar-ui="true"]' ) === null;
		}

		return true;

	}

	private handleGlobalArPointerDown = (event: PointerEvent): void => {

		if ( this.shouldHandleGlobalArPointerEvent( event ) === false ) {
			return;
		}

		this.pointerSelection.handleScreenPointerDown( event.clientX, event.clientY );

	};

	private handleGlobalArPointerUp = (event: PointerEvent): void => {

		if ( this.shouldHandleGlobalArPointerEvent( event ) === false ) {
			return;
		}

		this.pointerSelection.handleScreenPointerUp( event.clientX, event.clientY );

	};

	private handleWindowResize = (): void => {

		this.sceneHostRuntime.resize();

	};

	private rebuildModelLayers(): void {

		this.layerVisibility.rebuild( {
			modelRoot: this.modelTemplate,
			pipesByName: this.pipesByName
		} );
		if ( this.store.getState().displayMode === 'layer-peeling' ) {
			this.layerVisibility.setHiddenLayerCount(
				percentToHiddenLayerCount(
					this.store.getState().layerPeelingValue,
					this.layerVisibility.getState().length
				)
			);
		}
		const modelLayers = this.layerVisibility.getState();
		this.store.patch( {
			layerNames: modelLayers.length > 0
				? modelLayers.map( ( layer ) => layer.label )
				: STATIC_LAYER_NAMES,
			modelLayers
		} );

	}

	private applyModelLayerVisibility(): void {

		this.visualizationStateRuntime.applyModelLayerVisibility();

	}

	private syncLayerPeelingValueFromLayers(): void {

		const layers = this.layerVisibility.getState();
		const nextValue = hiddenLayerCountToPercent( countHiddenLayers( layers ), layers.length );
		const patch: Partial<RegistrationStoreState> = {
			layerPeelingValue: nextValue
		};
		if ( this.store.getState().displayMode === 'layer-peeling' ) {
			patch.structureRevealValue = nextValue;
		}
		this.store.patch( patch );

	}

	private syncAttachmentInfoBoardVisibility(): void {

		setAttachmentInfoBoardVisibility(
			this.placementSession.getArPlacedModel(),
			this.sceneBundle.renderer.xr.isPresenting
		);

	}

}

function formatVector3Text(vector: THREE.Vector3): string {

	return `${vector.x.toFixed( 3 )}, ${vector.y.toFixed( 3 )}, ${vector.z.toFixed( 3 )}`;

}

function formatAccuracyText(value: number | null | undefined): string {

	return typeof value === 'number' && Number.isFinite( value )
		? `${value.toFixed( 1 )}m`
		: '-';

}

function cloneArFromEnuSolution(solution: ArFromEnuSolution): ArFromEnuSolution {

	return {
		matrix: solution.matrix.clone(),
		siteOriginArPosition: solution.siteOriginArPosition.clone(),
		orientation: solution.orientation.clone(),
		headingDeg: solution.headingDeg,
		source: solution.source,
		sessionId: solution.sessionId ?? null,
		accuracyMeters: solution.accuracyMeters,
		yawAccuracyDegrees: solution.yawAccuracyDegrees,
		timestamp: solution.timestamp
	};

}

function vector3ToObject(vector: THREE.Vector3): { x: number; y: number; z: number } {

	return {
		x: vector.x,
		y: vector.y,
		z: vector.z
	};

}

function vector3ToRoundedObject(vector: THREE.Vector3): { x: number; y: number; z: number } {

	return {
		x: Number( vector.x.toFixed( 6 ) ),
		y: Number( vector.y.toFixed( 6 ) ),
		z: Number( vector.z.toFixed( 6 ) )
	};

}

function quaternionToRoundedObject(quaternion: THREE.Quaternion): { x: number; y: number; z: number; w: number } {

	return {
		x: Number( quaternion.x.toFixed( 6 ) ),
		y: Number( quaternion.y.toFixed( 6 ) ),
		z: Number( quaternion.z.toFixed( 6 ) ),
		w: Number( quaternion.w.toFixed( 6 ) )
	};

}

function matrixToRoundedArray(matrix: THREE.Matrix4): number[] {

	return matrix.toArray().map( ( value ) => Number( value.toFixed( 6 ) ) );

}

function boxToRoundedObject(box: THREE.Box3): {
	min: { x: number; y: number; z: number };
	max: { x: number; y: number; z: number };
} {

	return {
		min: vector3ToRoundedObject( box.min ),
		max: vector3ToRoundedObject( box.max )
	};

}

function computeRms(errors: number[]): number {

	if ( errors.length === 0 ) {
		return 0;
	}
	return Math.sqrt( errors.reduce( ( total, error ) => total + error * error, 0 ) / errors.length );

}

function getRelativeMatrix(object: THREE.Object3D, root: THREE.Object3D): THREE.Matrix4 {

	root.updateMatrixWorld( true );
	object.updateMatrixWorld( true );
	return root.matrixWorld.clone().invert().multiply( object.matrixWorld );

}

function computeBoundsInLocalSpace(object: THREE.Object3D, localRoot: THREE.Object3D): THREE.Box3 {

	const bounds = new THREE.Box3();
	const inverseRoot = localRoot.matrixWorld.clone().invert();
	object.updateMatrixWorld( true );
	object.traverse( ( child ) => {
		if ( child instanceof THREE.Mesh && child.geometry !== undefined ) {
			child.geometry.computeBoundingBox();
			if ( child.geometry.boundingBox !== null ) {
				const relativeMatrix = inverseRoot.clone().multiply( child.matrixWorld );
				bounds.union( child.geometry.boundingBox.clone().applyMatrix4( relativeMatrix ) );
			}
		}
	} );
	return bounds;

}

function enuTupleToArVector(
	tuple: [ number, number, number ],
	arFromEnuSolution: ArFromEnuSolution
): THREE.Vector3 {

	return new THREE.Vector3( tuple[ 0 ], tuple[ 1 ], tuple[ 2 ] ).applyMatrix4( arFromEnuSolution.matrix );

}

function tupleToVector3(tuple: [ number, number, number ]): THREE.Vector3 {

	return new THREE.Vector3( tuple[ 0 ], tuple[ 1 ], tuple[ 2 ] );

}

function readDebugLayerFlag(name: string, defaultValue: boolean): boolean {

	const value = import.meta.env[ name ];
	if ( value === 'true' ) {
		return true;
	}
	if ( value === 'false' ) {
		return false;
	}
	return defaultValue;

}

function averageVectors(vectors: THREE.Vector3[]): THREE.Vector3 {

	if ( vectors.length === 0 ) {
		return new THREE.Vector3();
	}
	const total = vectors.reduce(
		(sum, vector) => sum.add( vector ),
		new THREE.Vector3()
	);
	return total.multiplyScalar( 1 / vectors.length );

}

function maxPairDelta(left: number[], right: number[]): number {

	return left.reduce(
		(max, value, index) => Math.max( max, Math.abs( value - ( right[ index ] ?? value ) ) ),
		0
	);

}

function headingFromEnuPoints(points: THREE.Vector3[]): number {

	if ( points.length < 2 ) {
		return 0;
	}
	const edge = points[ 1 ].clone().sub( points[ 0 ] );
	return normalizeSignedDegrees( radToDeg( Math.atan2( edge.x, edge.y ) ) );

}

function headingFromArPoints(points: THREE.Vector3[]): number {

	if ( points.length < 2 ) {
		return 0;
	}
	const edge = points[ 1 ].clone().sub( points[ 0 ] );
	return normalizeSignedDegrees( radToDeg( Math.atan2( edge.x, - edge.z ) ) );

}

function radToDeg(value: number): number {

	return THREE.MathUtils.radToDeg( value );

}

function createDebugTextSprite(text: string, color: number): THREE.Sprite {

	const canvas = document.createElement( 'canvas' );
	canvas.width = 256;
	canvas.height = 96;
	const context = canvas.getContext( '2d' );
	if ( context !== null ) {
		context.font = 'bold 28px sans-serif';
		context.fillStyle = 'rgba(0,0,0,0.72)';
		context.fillRect( 0, 0, canvas.width, canvas.height );
		context.fillStyle = `#${color.toString( 16 ).padStart( 6, '0' )}`;
		context.fillText( text, 16, 58 );
	}
	const texture = new THREE.CanvasTexture( canvas );
	texture.minFilter = THREE.LinearFilter;
	texture.magFilter = THREE.LinearFilter;
	const sprite = new THREE.Sprite( new THREE.SpriteMaterial( {
		map: texture,
		depthTest: false,
		transparent: true
	} ) );
	sprite.scale.set( 0.38, 0.14, 1 );
	sprite.name = `corner-debug-label-${text}`;
	return sprite;

}

function disposeDebugObject(object: THREE.Object3D): void {

	object.traverse( ( child ) => {
		if ( child instanceof THREE.Mesh || child instanceof THREE.Line ) {
			child.geometry.dispose();
			disposeMaterial( child.material );
		}
		if ( child instanceof THREE.Sprite ) {
			disposeMaterial( child.material );
		}
	} );

}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {

	if ( Array.isArray( material ) ) {
		material.forEach( disposeMaterial );
		return;
	}
	const maybeTextured = material as THREE.Material & { map?: THREE.Texture };
	maybeTextured.map?.dispose();
	material.dispose();

}

function findLayerObjectById(root: THREE.Object3D, layerId: string): THREE.Object3D | null {

	let resolved: THREE.Object3D | null = null;
	root.traverse( ( child ) => {
		if ( resolved !== null ) {
			return;
		}

		if ( child.userData.__layerId === layerId && child.userData.__layerSelectable === true ) {
			resolved = child;
		}
	} );

	return resolved;

}

function getBusinessNameFromObject(object: THREE.Object3D | null): string {

	if ( object === null ) {
		return '';
	}

	const businessName = object.userData.__businessName;
	if ( typeof businessName === 'string' && businessName.length > 0 ) {
		return businessName;
	}

	return object.name || '';

}

function getObjectMaterialName(root: THREE.Object3D): string {

	let resolvedMaterialName = '';
	root.traverse( ( child ) => {
		if ( resolvedMaterialName.length > 0 || ( child instanceof THREE.Mesh ) === false ) {
			return;
		}

		if ( Array.isArray( child.material ) ) {
			const names = child.material
				.map( ( material ) => material.name )
				.filter( ( name ) => name.length > 0 );
			resolvedMaterialName = names.join( ', ' );
			return;
		}

		resolvedMaterialName = child.material.name || '';
	} );

	return resolvedMaterialName || '-';

}

function getLayerLabelForObject(
	object: THREE.Object3D,
	layers: RegistrationStoreState['modelLayers']
): string | null {

	let current: THREE.Object3D | null = object;
	while ( current !== null ) {
		const layerId = current.userData.__layerId;
		if ( typeof layerId === 'string' ) {
			return layers.find( ( layer ) => layer.id === layerId )?.label ?? layerId;
		}
		current = current.parent;
	}

	return null;

}

function recordToAnnotationProperties(record: PipeRecord): Record<string, string | number> {

	return {
		name: record.name,
		type: record.type ?? '-',
		diameter: record.diameter ?? '-',
		material: record.material ?? '-',
		depth: record.depth ?? '-',
		status: record.status ?? '-',
		remark: record.remark ?? '-'
	};

}

function normalizeSignedDegrees(value: number): number {

	const normalized = ( ( value + 180 ) % 360 + 360 ) % 360 - 180;
	return normalized === -180 ? 180 : normalized;

}

function countHiddenLayers(layers: Array<{ visible: boolean }>): number {

	return layers.reduce( ( count, layer ) => count + ( layer.visible ? 0 : 1 ), 0 );

}

function percentToHiddenLayerCount(value: number, totalLayerCount: number): number {

	const maxHideCount = Math.max( 0, totalLayerCount - 1 );
	if ( maxHideCount === 0 ) {
		return 0;
	}

	return Math.round( THREE.MathUtils.clamp( value, 0, 100 ) / 100 * maxHideCount );

}

function hiddenLayerCountToPercent(hiddenLayerCount: number, totalLayerCount: number): number {

	const maxHideCount = Math.max( 0, totalLayerCount - 1 );
	if ( maxHideCount === 0 ) {
		return 0;
	}

	return Math.round( THREE.MathUtils.clamp( hiddenLayerCount, 0, maxHideCount ) / maxHideCount * 100 );

}

function getDisplayModeSliderValue(
	state: RegistrationStoreState,
	mode: ArDisplayMode = state.displayMode
): number {

	switch ( mode ) {
		case 'transparent-xray':
			return state.transparentXrayValue;
		case 'layer-peeling':
			return state.layerPeelingValue;
		case 'section-cut':
			return state.sectionCutValue;
		default:
			return 0;
	}

}












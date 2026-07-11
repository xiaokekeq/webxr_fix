import * as THREE from 'three';
import type { PipeRecord } from '@/models/types/pipe-record.js';
import { createPointerSelectionSession } from '@/engine/interaction/pointer-selection.js';
import { createPropertySelectionController } from '@/engine/interaction/property-selection.js';
import { createModelSession } from '@/engine/model/session.js';
import {
	createPlacementSession,
	deriveUndergroundRegistrationSolution
} from '@/engine/placement/session.js';
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
	resolveModelObjectProperties,
	resolveModelObjectSelection,
	type CanvasModelPropertyPanelData
} from '@/engine/models/model-property-resolver.js';
import {
	PROJECT_NAME,
	STATIC_LAYER_NAMES,
	TIMELINE_STAGES
} from '@/models/catalog/model-api.js';
import {
	createDefaultAnnotationDetailState,
	createDefaultFootprintDiagnosticsState,
	createDefaultMarkerCalibrationState,
	createDefaultModelPlacementDebugState,
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
	type DebugScreenPoint,
	type ModelPlacementDebugState,
	type RegistrationStore,
	type RegistrationStoreState,
	type SectionCutPlaneMode,
	type WorkspaceMode
} from '@/localization/core/registration-store.js';
import {
	type EngineeringControlPoint,
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
import { UndergroundTopPortal } from '@/engine/visualization/underground-top-portal.js';
import { VisualizationStateRuntime } from '@/engine/visualization/visualization-state-runtime.js';
import {
	createArAnnotationLabelController,
	type ArAnnotationDetailOverlay,
	type ArAnnotationItem
} from '@/engine/annotation/ar-annotation-labels.js';
import { AnnotationLayer } from '@/engine/annotation/annotation-layer.js';
import type { EngineeringAnnotation } from '@/engine/annotation/annotation-types.js';
import { ArCoordinateService } from '@/engine/coordinates/ar-coordinate-service.js';
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
import { composeModelRawLocalToArMatrix } from '@/engine/placement/runtime.js';
import type {
	ArWorkflowMode,
	SiteCalibrationBaseline,
	VisualControlTarget
} from '@/features/ar/types/workflow.js';
import type { ArSessionStartResult } from '@/features/ar/types/runtime-types.js';
import type { ArSessionContext } from '@/features/ar/types/ar-session-context.js';
import { repositories } from '@/services/repository-factory.js';
import type { CreateInspectionRecordInput } from '@/services/repositories/inspection-repository.js';
import { validateSiteCalibrationBaselineForStorage } from '@/services/repositories/site-baseline-repository.js';
import { RealDepthProvider } from '@/engine/depth/real-depth-provider.js';
import { readPlaceableTemplateReport } from '@/engine/core/model.js';
import { arInfo } from '@/engine/debug/ar-logger.js';

const MAX_LOG_ITEMS = 24;
const MODEL_CONTROL_POINT_PLACEMENT_RMS_LIMIT_METERS = 0.2;
const AUTO_PLACE_AFTER_MARKER_CALIBRATION = import.meta.env.VITE_AUTO_PLACE_AFTER_MARKER_CALIBRATION === 'true';

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
		timelineStages: TIMELINE_STAGES,
		currentTimelineStageIndex: 2,
		layerNames: STATIC_LAYER_NAMES,
		modelLayers: [],
		pipeList: [],
		selectedAnnotationId: null,
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
		modelPlacementDebug: createDefaultModelPlacementDebugState(),
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
	private readonly annotationLayer = new AnnotationLayer();
	private readonly arCoordinateService = new ArCoordinateService();
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
	private siteOriginReferencePanelOpen = false;
	private readonly realDepthProvider = new RealDepthProvider();
	private readonly undergroundPortal: UndergroundTopPortal;
	private portalUpdateArgs: Parameters<UndergroundTopPortal['update']>[ 0 ] | null = null;
	private readonly footprintCornersAr = [ new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3() ];
	private readonly emptyFootprintCorners: THREE.Vector3[] = [];
	private readonly frameTaskErrorCounts = new Map<string, number>();
	private readonly frameTaskLastErrorLogAt = new Map<string, number>();
	private workflowMode: ArWorkflowMode = 'ar-inspection';
	private arSessionEndPending = false;
	private lastAnnotationLabelsSignature = '';
	private lastArSessionContextLogSignature = '';
	private siteBaselineLoadRequestId = 0;
	private pipesByName = new Map<string, PipeRecord>();
	private fixedEngineeringMatrix: THREE.Matrix4 | null = null;
	private fixedVisualMatrix: THREE.Matrix4 | null = null;
	private yellowSurfaceInitialCenterWorld: THREE.Vector3 | null = null;
	private purpleEngineeringInitialCenterWorld: THREE.Vector3 | null = null;
	private undergroundExpectedInitialCenterWorld: THREE.Vector3 | null = null;
	private yellowScreenInitial: DebugScreenPoint | null = null;
	private purpleEngineeringScreenInitial: DebugScreenPoint | null = null;
	private undergroundExpectedScreenInitial: DebugScreenPoint | null = null;
	private yellowToUndergroundScreenDistanceInitialPx: number | null = null;
	private diagnosticSampleCount = 0;
	private yellowUpdateCount = 0;
	private purpleEngineeringUpdateCount = 0;
	private undergroundExpectedUpdateCount = 0;
	private currentModelActualUpdateCount = 0;
	private yellowLastUpdateReason = 'none';
	private purpleEngineeringLastUpdateReason = 'none';
	private undergroundExpectedLastUpdateReason = 'none';
	private currentModelActualLastUpdateReason = 'none';
	private purpleDiagnosticsUpdatedInFrameLoop = false;
	private canvasPropertyPanelAuditLogged = false;
	private groundAwareArAuditLogged = false;
	private placementDebugLastWorldLockUpdateAt = 0;
	private engineeringPlacementCallCount = 0;
	private replacedModelCount = 0;
	private lastPlacementReason = '-';
	private lastPlacementTimestamp = 0;
	private lastPortalDebugAt = 0;
	private readonly handleWebglContextLost = ( event: Event ) => {
		( event as WebGLContextEvent ).preventDefault();
		console.error( '[WebGLContextLost]', { xrPresenting: this.sceneBundle.renderer.xr.isPresenting } );
	};
	private readonly handleWebglContextRestored = () => {
		console.info( '[WebGLContextRestored]' );
	};

	constructor() {

		this.store = createRegistrationStore( createInitialState() );
		this.xrButtonWrap = document.createElement( 'div' );
		this.xrButtonWrap.className = 'xr-button-wrap';
		this.sceneBundle = createARScene( document.createElement( 'div' ) );
		this.undergroundPortal = new UndergroundTopPortal( this.sceneBundle.scene );
		this.portalUpdateArgs = {
			renderer: this.sceneBundle.renderer,
			mainCamera: this.sceneBundle.renderer.xr.getCamera(),
			model: null,
			footprintCorners: this.emptyFootprintCorners,
			depthFrame: this.realDepthProvider.getCurrentFrame(),
			enabled: false
		};
		this.engineeringCornerDebugGroup.name = '__engineering-corner-debug';
		this.sceneBundle.scene.add( this.engineeringCornerDebugGroup );
		this.sceneBundle.scene.add( this.annotationLayer.group );

		const statusRuntime = createStatusRuntime( {
			store: this.store,
			updateStatusText: ( message ) => {
				this.currentStatus = message;
			},
			maxLogItems: MAX_LOG_ITEMS
		} );

		this.propertySelection = createPropertySelectionController( {
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
					this.undergroundPortal.markDirty();
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
				this.showCanvasModelPropertyPanel(
					selection.businessObject,
					selection.properties
				);
			},
			onSelectionCleared: () => {
				this.clearAnnotationDetail();
				this.undergroundPortal.markDirty();
			},
			handlePreSelectionRaycast: ( selection ) => {
				if ( this.annotationLabelsController.hitDetailPanel( selection.raycaster ) ) {
					return true;
				}

				if ( this.handleBusinessAnnotationPick( selection.raycaster ) ) {
					return true;
				}

				if ( this.handleSiteOriginReferencePick( selection.raycaster ) ) {
					return true;
				}

				if ( this.handleUndergroundPortalPick( selection.raycaster ) ) {
					return true;
				}

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
				this.undergroundPortal.reset();
				this.syncArSessionPhase();
				this.emit();
			},
			onRuntimeReset: () => {
				this.undergroundPortal.reset();
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
				this.annotationLayer.setAnnotations( [] );
				this.arCoordinateService.clear( 'runtime-reset' );
				this.store.patch( {
					layerNames: STATIC_LAYER_NAMES,
					modelLayers: [],
					selectedAnnotationId: null,
					annotationDetail: createDefaultAnnotationDetailState(),
					modelPlacementDebug: createDefaultModelPlacementDebugState(),
					siteCalibrationBaseline: createDefaultSiteCalibrationBaselineState(),
					engineeringConfigStatus: createDefaultEngineeringConfigStatusState()
				} );
				this.refreshSavedMarkerLocalizationResult( { silentStatus: true } );
				this.markerCalibrationRuntime.syncState();
				this.syncRegistrationChainDebug();
				this.syncModelPlacementDebug( this.getActiveArFromEnuSolution() );
			},
			onRuntimeBundleLoaded: ( bundle ) => {
				this.pipesByName = bundle.pipesByName;
				this.demoModelConfig = bundle.demoModelConfig;
				this.modelTemplate = bundle.modelTemplate;
				this.registrationSolution = bundle.registrationSolution;
				this.logGroundAwareArAudit( bundle.demoModelConfig );
				this.annotationLayer.setAnnotations(
					bundle.demoModelConfig.annotations,
					bundle.demoModelConfig.annotationStyleRules
				);
				this.store.patch( {
					footprintDiagnostics: {
						...this.store.getState().footprintDiagnostics,
						undergroundDisplayText: formatUndergroundDisplayText(
							bundle.demoModelConfig,
							bundle.modelTemplate
						)
					}
				} );
				if ( bundle.demoModelConfig.undergroundPlacement?.enabled === true ) {
					const opacity = resolveXrayOpacityPercent( bundle.demoModelConfig.undergroundDisplay?.xrayOpacity );
					this.store.patch( {
						displayMode: bundle.demoModelConfig.modelInstances[ 0 ]?.display.belowGroundMode === 'top-portal'
							? 'underground-portal'
							: 'transparent-xray',
						structureRevealValue: opacity,
						transparentXrayValue: opacity
					} );
				}
				this.resolvedMarkerPosesInEnu = this.resolveConfiguredMarkerPoses( bundle.demoModelConfig );
				this.rebuildModelLayers();
				this.syncArSessionContext();
				this.logModelLocalControlPointBoundsCheck();
				this.refreshSiteCalibrationBaselineState( { silentStatus: true } );
				this.refreshSavedMarkerLocalizationResult( { silentStatus: true } );
				this.markerCalibrationRuntime.syncState();
				this.syncRegistrationChainDebug();
				this.syncModelPlacementDebug( this.getActiveArFromEnuSolution() );
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
			onSessionStart: ( result ) => {
				this.handleXRSessionStart( result );
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
				this.safeFrameTask( 'real-depth', () => {
					this.updateRealDepth( frame );
				} );
				this.safeFrameTask( 'underground-portal', () => {
					this.updateUndergroundPortal();
				} );
				this.safeFrameTask( 'marker-hints', () => {
					this.inspectionMarkerWorkflow.syncHints();
				} );
				this.safeFrameTask( 'placement-anchor', () => {
					this.placementSession.updateArPlacementAnchor( frame );
				} );
				this.safeFrameTask( 'session-phase', () => {
					this.syncArSessionPhase();
				} );
				this.safeFrameTask( 'annotation-labels', () => {
					this.annotationLabelsController.update( this.sceneBundle.renderer.xr.getCamera() );
				} );
				this.safeFrameTask( 'target-guidance', () => {
					this.updateTargetGuidance();
				} );
				this.safeFrameTask( 'world-lock-verify', () => {
					this.placementSession.verifyWorldLockedPlacement( 'xr-frame' );
				} );
				this.safeFrameTask( 'world-lock-debug', () => {
					this.updateModelPlacementWorldLockDebug();
				} );
			}
		} );

		this.sceneBundle.renderer.setAnimationLoop( this.xrRuntime.renderFrame );
		this.sceneBundle.renderer.domElement.addEventListener( 'pointerdown', this.pointerSelection.handlePointerDown );
		this.sceneBundle.renderer.domElement.addEventListener( 'pointerup', this.pointerSelection.handlePointerUp );
		this.sceneBundle.renderer.domElement.addEventListener( 'webglcontextlost', this.handleWebglContextLost );
		this.sceneBundle.renderer.domElement.addEventListener( 'webglcontextrestored', this.handleWebglContextRestored );
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
		this.realDepthProvider.dispose();
		this.sceneBundle.renderer.domElement.removeEventListener( 'pointerdown', this.pointerSelection.handlePointerDown );
		this.sceneBundle.renderer.domElement.removeEventListener( 'pointerup', this.pointerSelection.handlePointerUp );
		this.sceneBundle.renderer.domElement.removeEventListener( 'webglcontextlost', this.handleWebglContextLost );
		this.sceneBundle.renderer.domElement.removeEventListener( 'webglcontextrestored', this.handleWebglContextRestored );
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
		this.undergroundPortal.dispose();
		this.annotationLabelsController.dispose();
		this.annotationLayer.dispose();
		this.sceneBundle.renderer.dispose();

	}

	handleArUiInteraction(): void {

		this.pointerSelection.cancelPendingSelection( 1400 );

	}

	closePropertyPanel(): void {

		this.pointerSelection.suppressSelectionFor( 1000 );
		this.propertySelection.clearSelection();
		this.undergroundPortal.markDirty();
		this.clearAnnotationDetail();
		this.annotationLayer.setSelected( null );
		this.setStatus( '已关闭构件信息面板。' );

	}

	selectModel(modelId: string): void {

		this.modelSession.handleModelSelection( modelId );

	}

	setDisplayMode(mode: ArDisplayMode): void {

		if (
			mode !== 'solid-overlay'
			&& mode !== 'transparent-xray'
			&& mode !== 'underground-portal'
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
		this.undergroundPortal.markDirty();

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

		arInfo( 'RealtimeDeviceLocalizationDisabled', {
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
			arInfo( 'SiteBaselineConfigControlTargetLoaded', {
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

		arInfo( 'SiteBaselineSaveStarted', {
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
			arInfo( 'SiteBaselineSaveSucceeded', {
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
			arInfo( 'SiteBaselineSaved', {
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
		arInfo( 'MarkerCorrectionCleared', {
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

	enterAr(): void {

		if ( this.store.getState().arSupportState !== 'supported' ) {
			this.setStatus( this.store.getState().arSupportMessage );
			return;
		}

		void this.ensureArSessionContextReady().then( () => {
			this.pointerSelection.suppressSelectionFor( 1200 );
			this.xrRuntime.requestSession();
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
		arInfo( 'InspectionRecordSaveStarted', {
			mode: this.workflowMode,
			siteId,
			dataSource: repositories.dataSource,
			repository: 'inspection',
			targetId: null,
			imageUrl: nextRecord.snapshotUrl ?? null,
			createdAt: nextRecord.createdAt
		} );
		void repositories.inspection.create( nextRecord ).then( ( record ) => {
			arInfo( 'InspectionRecordSaveSucceeded', {
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

	private safeFrameTask(stage: string, task: () => void): void {

		const startedAt = performance.now();
		try {
			task();
		} catch ( error ) {
			this.reportFrameTaskError( stage, error );
		} finally {
			const durationMs = performance.now() - startedAt;
			if ( import.meta.env.VITE_AR_DEBUG === 'true' && durationMs > 33 ) {
				console.warn( '[ThreeEngineFrameTaskSlow]', {
					stage,
					durationMs: Number( durationMs.toFixed( 2 ) )
				} );
			}
		}

	}

	private reportFrameTaskError(stage: string, error: unknown): void {

		const now = performance.now();
		const previousLogAt = this.frameTaskLastErrorLogAt.get( stage ) ?? 0;
		const count = ( this.frameTaskErrorCounts.get( stage ) ?? 0 ) + 1;
		this.frameTaskErrorCounts.set( stage, count );
		if ( now - previousLogAt < 3000 ) {
			return;
		}
		this.frameTaskLastErrorLogAt.set( stage, now );
		const message = error instanceof Error ? error.message : String( error );
		console.error( '[ThreeEngineFrameTaskError]', {
			stage,
			errorName: error instanceof Error ? error.name : typeof error,
			errorMessage: message,
			stack: error instanceof Error ? error.stack : undefined,
			timestamp: Date.now(),
			errorCount: count,
			isPresenting: this.sceneBundle.renderer.xr.isPresenting
		} );
		this.setStatus( `XR 帧任务异常：${stage}；已继续渲染。` );
		this.emit();

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
		arInfo( 'SiteBaselineLoadStarted', {
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
				arInfo( 'SiteBaselineLoadMissing', {
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
				arInfo( 'SiteBaselineLoadSucceeded', {
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
		arInfo( 'ArSessionContextCreated', {
			mode: nextContext.mode,
			siteId: nextContext.siteId,
			dataSource: repositories.dataSource,
			repository: 'arSessionContext',
			targetId: resolved.controlTargets[ 0 ]?.id ?? null,
			createdAt: Date.now(),
			controlTargetCount: resolved.controlTargets.length,
			baselineAvailable: nextContext.baseline !== null
		} );
		arInfo(
			resolved.source === 'baseline'
				? 'ArSessionUsingBaselineControlTargets'
				: 'ArSessionUsingSiteConfigControlTargets',
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
		arInfo( 'EngineeringPlacementApplied', {
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
		capturedCornersAr: THREE.Vector3[] = [],
		updateReason = 'unknown'
	): void {

		this.clearEngineeringCornerDebug();
		this.addSiteOriginReferenceMarker( arFromEnuSolution );
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
		if ( controlTarget?.cornersEnu !== undefined ) {
			const markerCornersEnu = controlTarget.cornersEnu.map( tupleToVector3 );
			const markerPhysicalText = capturedCornersAr.length === 4
				? `RTK marker 边长 ${computeSideLengths( markerCornersEnu ).map( ( value ) => value.toFixed( 2 ) ).join( '/' )}m；采集边长 ${computeSideLengths( capturedCornersAr ).map( ( value ) => value.toFixed( 2 ) ).join( '/' )}m。请确认 RTK marker 四角和当前采集的三角桶底座四角是同一组物理点。`
				: '请确认 RTK 测量的 marker 四角和当前采集的三角桶底座四角是同一组物理点。三角桶如果被移动或旋转，校正会稳定但整体偏移。';
			arInfo( 'MarkerCornerPhysicalDefinitionCheck', {
				markerCornerIds: controlTarget.cornerOrder ?? [],
				cornerRoles: controlTarget.cornerOrder ?? [],
				cornersEnu: markerCornersEnu.map( vector3ToRoundedObject ),
				expectedEdgeLengths: computeSideLengths( markerCornersEnu ),
				expectedDiagonals: computeDiagonalLengths( markerCornersEnu ),
				capturedEdgeLengths: capturedCornersAr.length === 4 ? computeSideLengths( capturedCornersAr ) : [],
				capturedDiagonals: capturedCornersAr.length === 4 ? computeDiagonalLengths( capturedCornersAr ) : [],
				note: markerPhysicalText
			} );
			this.store.patch( {
				footprintDiagnostics: {
					...this.store.getState().footprintDiagnostics,
					markerPhysicalText,
					updatedAtText: new Date().toLocaleTimeString( 'zh-CN', { hour12: false } )
				}
			} );
		}

		if ( this.engineeringDebugLayers.showFootprintExpected && this.registrationSolution !== null ) {
			const footprintControlPoints = this.registrationSolution.controlPoints.slice( 0, 4 );
			const footprintCornersAr = this.getCurrentFootprintCornersAr();
			const footprintCenterAr = averageVectors( footprintControlPoints.map( ( point ) => point.worldEnu ) )
				.applyMatrix4( arFromEnuSolution.matrix );
			this.yellowUpdateCount += 1;
			this.yellowLastUpdateReason = updateReason;
			if ( this.yellowSurfaceInitialCenterWorld === null ) {
				this.yellowSurfaceInitialCenterWorld = footprintCenterAr.clone();
			}
			arInfo( 'FootprintRenderDependencyCheck', {
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
				this.addDebugPoint( 'marker-center', markerCenterAr, 0x00d4ff );
				this.addDebugPoint( 'footprint-center', footprintCenterAr, 0xffd84d );
				this.addDebugLine( 'marker-to-footprint-center', [ markerCenterAr, footprintCenterAr ], 0xffd84d );
			}
		}

		const placedModel = this.placementSession.getArPlacedModel();
		if ( placedModel !== null && this.registrationSolution !== null ) {
			const controlPoints = this.registrationSolution.controlPoints.slice( 0, 4 );
			const engineeringMatrix = this.fixedEngineeringMatrix ?? composeModelRawLocalToArMatrix( {
				arFromEnuSolution,
				registrationSolution: this.registrationSolution as EngineeringRegistrationSolution
			} );
			const undergroundPlacement = this.modelTemplate === null
				? null
				: deriveUndergroundRegistrationSolution( {
					registrationSolution: this.registrationSolution as EngineeringRegistrationSolution,
					modelTemplate: this.modelTemplate
				} );
			placedModel.updateMatrixWorld( true );
			const engineeringPoints = controlPoints
				.map( ( point ) => point.modelLocal.clone().applyMatrix4( engineeringMatrix ) );
			const undergroundExpectedPoints = controlPoints
				.map( ( _point, index ) => undergroundPlacement?.undergroundControlPoints[ index ]?.worldEnu.clone().applyMatrix4( arFromEnuSolution.matrix ) )
				.filter( ( point ): point is THREE.Vector3 => point !== undefined );
			const currentModelActualPoints = controlPoints
				.map( ( point ) => placedModel.localToWorld( point.modelLocal.clone() ) );
			this.purpleEngineeringUpdateCount += 1;
			this.undergroundExpectedUpdateCount += 1;
			this.purpleEngineeringLastUpdateReason = updateReason;
			this.undergroundExpectedLastUpdateReason = updateReason;
			this.purpleDiagnosticsUpdatedInFrameLoop = updateReason === 'xr-frame';
			if ( this.purpleEngineeringInitialCenterWorld === null ) {
				this.purpleEngineeringInitialCenterWorld = averageVectors( engineeringPoints ).clone();
			}
			if ( this.undergroundExpectedInitialCenterWorld === null && undergroundExpectedPoints.length > 0 ) {
				this.undergroundExpectedInitialCenterWorld = averageVectors( undergroundExpectedPoints ).clone();
			}
			if ( this.engineeringDebugLayers.showModelActualControlPoints ) {
				this.addDebugQuad( {
					name: 'model-cp-actual-engineering',
					points: engineeringPoints,
					labels: controlPoints.map( ( point ) => `actual-${point.id}-engineering` ),
					color: 0xff4dff
				} );
				if ( import.meta.env.VITE_AR_DEBUG === 'true' ) {
					this.addDebugQuad( {
						name: 'model-cp-underground-expected',
						points: undergroundExpectedPoints,
						labels: controlPoints.map( ( point ) => `underground-${point.id}` ),
						color: 0x38bdf8
					} );
					this.addDebugQuad( {
						name: 'model-cp-current-runtime',
						points: currentModelActualPoints,
						labels: controlPoints.map( ( point ) => `current-${point.id}` ),
						color: 0xf97316
					} );
				}
			}
			const bbox = new THREE.Box3().setFromObject( placedModel );
			if ( this.engineeringDebugLayers.showModelBoundingBox && bbox.isEmpty() === false ) {
				const helper = new THREE.Box3Helper( bbox, 0xffffff );
				helper.name = 'model-bbox';
				this.engineeringCornerDebugGroup.add( helper );
			}
		}

		arInfo( 'EngineeringCornerDebugDrawn', {
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

	private addSiteOriginReferenceMarker(arFromEnuSolution: ArFromEnuSolution): void {

		const originAr = new THREE.Vector3( 0, 0, 0 ).applyMatrix4( arFromEnuSolution.matrix );
		const labelPosition = originAr.clone().add( new THREE.Vector3( 0.22, 0.42, 0 ) );
		const point = new THREE.Mesh(
			new THREE.SphereGeometry( 0.055, 16, 10 ),
			new THREE.MeshBasicMaterial( { color: 0x38bdf8, depthTest: false } )
		);
		point.name = 'site-origin-reference-point';
		point.position.copy( originAr );
		markSiteOriginReferenceObject( point );
		this.engineeringCornerDebugGroup.add( point );

		this.addDebugLine( 'site-origin-reference-line', [ originAr, labelPosition ], 0x38bdf8 );
		const label = createCanvasPanelSprite( {
			title: '参考原点',
			subtitle: 'siteOrigin / ENU (0,0,0)',
			width: 0.72,
			color: '#38bdf8'
		} );
		label.name = 'site-origin-reference-label';
		label.position.copy( labelPosition );
		markSiteOriginReferenceObject( label );
		this.engineeringCornerDebugGroup.add( label );

		if ( this.siteOriginReferencePanelOpen ) {
			const detail = createCanvasPanelSprite( {
				title: '工程参考原点',
				subtitle: `AR ${originAr.x.toFixed( 2 )}, ${originAr.y.toFixed( 2 )}, ${originAr.z.toFixed( 2 )}`,
				body: '这是 ENU 坐标系原点映射到当前 WebXR AR local 的参考点。再次点击关闭。',
				width: 1.08,
				color: '#facc15'
			} );
			detail.name = 'site-origin-reference-detail';
			detail.position.copy( labelPosition ).add( new THREE.Vector3( 0, 0.34, 0 ) );
			markSiteOriginReferenceObject( detail );
			this.engineeringCornerDebugGroup.add( detail );
		}

	}

	private handleSiteOriginReferencePick(raycaster: THREE.Raycaster): boolean {

		const hit = raycaster.intersectObjects( this.engineeringCornerDebugGroup.children, true )
			.find( ( intersection ) => hasSiteOriginReferenceObject( intersection.object ) );
		if ( hit === undefined ) {
			return false;
		}

		this.siteOriginReferencePanelOpen = ! this.siteOriginReferencePanelOpen;
		if ( this.activeMarkerArFromEnuSolution !== null ) {
			this.renderEngineeringCornerDebug(
				this.activeMarkerArFromEnuSolution,
				this.getActiveEngineeringControlTarget(),
				[],
				'site-origin-reference-toggle'
			);
		}
		this.setStatus( this.siteOriginReferencePanelOpen ? '已显示参考原点说明。' : '已关闭参考原点说明。' );
		return true;

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
		arInfo( 'CoordinateAxisMappingCheck', {
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
		const previousRawHeadingDeltaDeg = Math.abs( normalizeSignedDegrees( headingMarkerToFootprintArDeg - headingMarkerToFootprintEnuDeg ) );
		const yawDegFromGroundPlane2D = arFromEnuSolution.headingDeg;
		const expectedHeadingInArDeg = normalizeSignedDegrees( headingMarkerToFootprintEnuDeg - yawDegFromGroundPlane2D );
		const actualHeadingInArDeg = headingMarkerToFootprintArDeg;
		const headingDeltaDeg = Math.abs( normalizeSignedDegrees( expectedHeadingInArDeg - actualHeadingInArDeg ) );
		const reversedVectorWouldHeadingDeg = normalizeSignedDegrees( radToDeg(
			Math.atan2( - vectorMarkerToFootprintCenterAr.x, vectorMarkerToFootprintCenterAr.z )
		) );
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
		if ( distanceDeltaMeters < 0.05 && previousRawHeadingDeltaDeg > 150 ) {
			console.warn( '[MarkerToFootprintHeadingAlmostReversed]', {
				distanceDeltaMeters: Number( distanceDeltaMeters.toFixed( 6 ) ),
				previousRawHeadingDeltaDeg: Number( previousRawHeadingDeltaDeg.toFixed( 6 ) ),
				correctedHeadingDeltaDeg: Number( headingDeltaDeg.toFixed( 6 ) ),
				note: '距离和形状正确，但 raw heading 接近反向。当前诊断已按 AR z 轴符号和 yaw 约定修正。'
			} );
		}
		const footprintControlPointIds = footprintPoints.map( ( point ) => point.id );
		const configWithFootprintOrder = this.demoModelConfig as ( DemoModelConfig & { modelControlPointOrder?: string[] } ) | null;
		const expectedFootprintControlPointIds = configWithFootprintOrder?.modelControlPointOrder?.slice( 0, 4 )
			?? Object.keys( this.demoModelConfig?.controlPoints ?? {} ).slice( 0, 4 );
		const wrongFootprintControlPointsUsed = footprintControlPointIds.join( '|' ) !== expectedFootprintControlPointIds.join( '|' );

		arInfo( 'FootprintEnuToArCheck', {
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
		arInfo( 'MarkerToFootprintVectorDirectionCheck', {
			markerCenterEnu: vector3ToRoundedObject( markerCenterEnu ),
			footprintCenterEnu: vector3ToRoundedObject( footprintCenterEnu ),
			vectorMarkerToFootprintEnu: vector3ToRoundedObject( vectorMarkerToFootprintCenterEnu ),
			markerCenterAr: vector3ToRoundedObject( markerCenterAr ),
			footprintCenterAr: vector3ToRoundedObject( footprintCenterAr ),
			vectorMarkerToFootprintAr: vector3ToRoundedObject( vectorMarkerToFootprintCenterAr ),
			reversedVectorWouldHeadingDeg: Number( reversedVectorWouldHeadingDeg.toFixed( 3 ) ),
			warning: null
		} );
		arInfo( 'HeadingConventionCheck', {
			convention: 'ar-x-minus-z',
			enuHeadingFormula: 'atan2(deltaEast, deltaNorth)',
			arHeadingFormula: 'atan2(deltaX, -deltaZ)',
			deltaEast: Number( vectorMarkerToFootprintCenterEnu.x.toFixed( 6 ) ),
			deltaNorth: Number( vectorMarkerToFootprintCenterEnu.y.toFixed( 6 ) ),
			deltaX: Number( vectorMarkerToFootprintCenterAr.x.toFixed( 6 ) ),
			deltaZ: Number( vectorMarkerToFootprintCenterAr.z.toFixed( 6 ) ),
			headingEnuDeg: Number( headingMarkerToFootprintEnuDeg.toFixed( 3 ) ),
			yawDeg: Number( yawDegFromGroundPlane2D.toFixed( 3 ) ),
			expectedHeadingInArDeg: Number( expectedHeadingInArDeg.toFixed( 3 ) ),
			actualHeadingInArDeg: Number( actualHeadingInArDeg.toFixed( 3 ) ),
			correctedHeadingDeltaDeg: Number( headingDeltaDeg.toFixed( 6 ) )
		} );
		arInfo( 'GroundPlaneYawConventionCheck', createGroundPlaneYawConventionPayload( arFromEnuSolution ) );
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
			yawDeg: Number( yawDegFromGroundPlane2D.toFixed( 6 ) ),
			expectedArHeadingFromEnuDeg: Number( expectedHeadingInArDeg.toFixed( 3 ) ),
			headingDeltaDeg: Number( headingDeltaDeg.toFixed( 6 ) ),
			distanceDeltaMeters: Number( distanceDeltaMeters.toFixed( 6 ) )
		};
		arInfo( 'MarkerToFootprintRelationCheck', relationPayload );
		const headingPayload = {
			headingMarkerToFootprintEnuDeg: Number( headingMarkerToFootprintEnuDeg.toFixed( 3 ) ),
			yawDegFromGroundPlane2D: Number( yawDegFromGroundPlane2D.toFixed( 3 ) ),
			expectedHeadingInArDeg: Number( expectedHeadingInArDeg.toFixed( 3 ) ),
			actualHeadingInArDeg: Number( actualHeadingInArDeg.toFixed( 3 ) ),
			headingDeltaDeg: Number( headingDeltaDeg.toFixed( 6 ) ),
			previousRawHeadingDeltaDeg: Number( previousRawHeadingDeltaDeg.toFixed( 6 ) ),
			diagnosticWasRawHeadingComparison: previousRawHeadingDeltaDeg !== headingDeltaDeg
		};
		arInfo( 'MarkerToFootprintHeadingCheck', headingPayload );
		if ( distanceDeltaMeters > 0.2 ) {
			console.error( '[MarkerToFootprintDistanceMismatch]', relationPayload );
		}
		if ( headingDeltaDeg > 5 ) {
			console.error( '[MarkerToFootprintHeadingMismatch]', relationPayload );
		}
		arInfo( 'FootprintShapeCheck', {
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
		arInfo( 'FootprintControlPointConfigCheck', footprintPoints.map( ( point, index ) => {
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
		arInfo( 'PhysicalMarkerFootprintRelationReminder', {
			markerId: controlTarget?.id ?? controlTarget?.markerId ?? null,
			markerControlPointIds: controlTarget?.cornerOrder ?? [],
			markerCenterEnu: vector3ToRoundedObject( markerCenterEnu ),
			footprintControlPointIds,
			footprintCenterEnu: vector3ToRoundedObject( footprintCenterEnu ),
			distanceMarkerToFootprintEnu: Number( distanceMarkerToFootprintCenterEnu.toFixed( 6 ) ),
			headingMarkerToFootprintEnuDeg: Number( headingMarkerToFootprintEnuDeg.toFixed( 3 ) ),
			note: `当前数据认为：marker 中心到 footprint 中心距离为 ${distanceMarkerToFootprintCenterEnu.toFixed( 3 )}m，方向为 ENU ${headingMarkerToFootprintEnuDeg.toFixed( 1 )}°。请现场确认三角桶中心到真实黄框中心是否确实约 ${distanceMarkerToFootprintCenterEnu.toFixed( 2 )}m，且方向一致。`
		} );
		arInfo( 'EnuFieldUsageCheck', footprintPoints.map( ( point ) => {
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
				markerToFootprintHeadingText: `ENU ${headingMarkerToFootprintEnuDeg.toFixed( 1 )}° - yaw ${yawDegFromGroundPlane2D.toFixed( 1 )}° => expected AR ${expectedHeadingInArDeg.toFixed( 1 )}° / actual AR ${actualHeadingInArDeg.toFixed( 1 )}° / Δ ${headingDeltaDeg.toFixed( 1 )}°`,
				markerToFootprintHeadingCheckText: `raw Δ ${previousRawHeadingDeltaDeg.toFixed( 1 )}°；AR 平面约定为 atan2(deltaX, -deltaZ)，已改用 ENU heading - yaw 后对比`,
				footprintShapeText: `边长 ${enuEdgeLengths.map( ( value ) => value.toFixed( 2 ) ).join( '/' )}m，对角 ${enuDiagonals.map( ( value ) => value.toFixed( 2 ) ).join( '/' )}m`,
				footprintControlPointIdsText: footprintControlPointIds.join( ' / ' ),
				enuUsageText: wrongFootprintControlPointsUsed
					? 'footprint 控制点不是预期 707-1~4'
					: 'worldEnu 已是 ENU；未重复套 siteOrigin；轴序 east,north,up -> x,y,z',
				physicalRelationText: `当前数据认为：marker 中心到 footprint 中心 ${distanceMarkerToFootprintCenterEnu.toFixed( 3 )}m，方向 ENU ${headingMarkerToFootprintEnuDeg.toFixed( 1 )}°。请现场确认三角桶中心到真实黄框中心是否约 ${distanceMarkerToFootprintCenterEnu.toFixed( 2 )}m 且方向一致。`,
				verdictText: distanceDeltaMeters > 0.2 || headingDeltaDeg > 5
					? 'marker->footprint ENU/AR 关系不一致：查 applyArFromEnu / worldEnu / siteOrigin / 轴映射'
					: '变换关系自洽；若仍不贴真实黄线，请检查 707-1~707-4 或 marker 物理点位语义。',
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
		arInfo( 'ModelLocalControlPointBoundsCheck', payload );

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
		arInfo( 'ModelAxisMappingCheck', payload );

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
		const engineeringMatrix = composeModelRawLocalToArMatrix( {
			arFromEnuSolution,
			registrationSolution: this.registrationSolution
		} );
		const rootErrors: number[] = [];
		const contentErrors: number[] = [];
		const visualErrors: number[] = [];
		const points = this.registrationSolution.controlPoints.slice( 0, 4 ).map( ( point ) => {
			const expectedAr = point.worldEnu.clone().applyMatrix4( arFromEnuSolution.matrix );
			const actualArEngineering = point.modelLocal.clone().applyMatrix4( engineeringMatrix );
			const actualArFromWrapper = placedModel.localToWorld( point.modelLocal.clone() );
			const actualArFromContent = modelContent === null
				? null
				: modelContent.localToWorld( point.modelLocal.clone() );
			const engineeringError = expectedAr.distanceTo( actualArEngineering );
			const errorWrapper = expectedAr.distanceTo( actualArFromWrapper );
			const errorContent = actualArFromContent === null
				? null
				: expectedAr.distanceTo( actualArFromContent );
			rootErrors.push( engineeringError );
			visualErrors.push( errorWrapper );
			if ( errorContent !== null ) {
				contentErrors.push( errorContent );
			}
			return {
				controlPointId: point.id,
				cornerRole: this.resolveControlPointCornerRole( point.id ),
				modelLocal: vector3ToRoundedObject( point.modelLocal ),
				worldEnu: vector3ToRoundedObject( point.worldEnu ),
				expectedAr: vector3ToRoundedObject( expectedAr ),
				actualArEngineering: vector3ToRoundedObject( actualArEngineering ),
				actualArFromWrapper: vector3ToRoundedObject( actualArFromWrapper ),
				actualArFromContent: actualArFromContent === null ? null : vector3ToRoundedObject( actualArFromContent ),
				engineeringError: Number( engineeringError.toFixed( 6 ) ),
				errorWrapper: Number( errorWrapper.toFixed( 6 ) ),
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
		const roundedVisualRmsError = Number( computeRms( visualErrors ).toFixed( 6 ) );
		const roundedVisualMaxError = Number( Math.max( ...visualErrors, 0 ).toFixed( 6 ) );
		const roundedMaxErrorContent = contentErrors.length === 0 ? null : Number( maxErrorContent.toFixed( 6 ) );
		const roundedRmsErrorContent = contentErrors.length === 0 ? null : Number( rmsErrorContent.toFixed( 6 ) );
		const likelyModelLocalSpace = contentErrors.length > 0 && rmsErrorContent + 0.02 < rmsErrorRoot
			? 'content'
			: 'wrapper';
		const payload = {
			modelId: this.demoModelConfig?.modelId ?? null,
			modelLocalLikelySpace: likelyModelLocalSpace,
			placedWrapperName: placedModel.name || placedModel.type,
			contentObjectName: modelContent?.name || modelContent?.type || null,
			placedWrapperMatrixWorld: matrixToRoundedArray( placedModel.matrixWorld ),
			modelContentMatrixWorld: modelContent === null ? null : matrixToRoundedArray( modelContent.matrixWorld ),
			engineeringMatrix: matrixToRoundedArray( engineeringMatrix ),
			points: points.map( ( point ) => ( {
				...point,
				maxErrorWrapper: roundedMaxErrorRoot,
				rmsErrorWrapper: roundedRmsErrorRoot,
				maxErrorContent: roundedMaxErrorContent,
				rmsErrorContent: roundedRmsErrorContent
			} ) ),
			maxErrorWrapper: roundedMaxErrorRoot,
			rmsErrorWrapper: roundedRmsErrorRoot,
			maxErrorEngineering: roundedMaxErrorRoot,
			rmsErrorEngineering: roundedRmsErrorRoot,
			maxErrorVisual: roundedVisualMaxError,
			rmsErrorVisual: roundedVisualRmsError,
			maxErrorContent: roundedMaxErrorContent,
			rmsErrorContent: roundedRmsErrorContent,
			warning: warnings,
			placedWrapper: {
				matrixWorld: matrixToRoundedArray( placedModel.matrixWorld )
			},
			modelContent: {
				matrixWorld: modelContent === null ? null : matrixToRoundedArray( modelContent.matrixWorld )
			}
		};

		arInfo( 'ModelControlPointPlacementCheck', payload );
		const severity = maxErrorRoot > 0.5
			? '模型控制点严重不对齐，请检查 modelLocal 坐标空间 / upAxis / 放置矩阵。'
			: rmsErrorRoot > MODEL_CONTROL_POINT_PLACEMENT_RMS_LIMIT_METERS
				? '模型控制点偏差较大'
				: '控制点基本对齐';
		const message = `模型控制点误差：RMS ${rmsErrorRoot.toFixed( 3 )}m / Max ${maxErrorRoot.toFixed( 3 )}m，状态：${severity}`;
		this.store.patch( {
			registrationStatusDetail: message,
			footprintDiagnostics: {
				...this.store.getState().footprintDiagnostics,
				modelControlPointPlacementText: `engineering RMS ${rmsErrorRoot.toFixed( 3 )}m / Max ${maxErrorRoot.toFixed( 3 )}m；visual RMS ${roundedVisualRmsError.toFixed( 3 )}m；content RMS ${
					roundedRmsErrorContent === null ? '-' : `${roundedRmsErrorContent.toFixed( 3 )}m`
				}；likely ${likelyModelLocalSpace}${warnings.length > 0 ? `；${warnings.join( '；' )}` : ''}`
			}
		} );
		if ( rmsErrorRoot > MODEL_CONTROL_POINT_PLACEMENT_RMS_LIMIT_METERS ) {
			console.error( '[ModelControlPointPlacementMismatch]', payload );
			this.setStatus( message );
		}

	}

	private logModelControlPointOrderCheck(): void {

		if ( this.registrationSolution === null ) {
			return;
		}

		const controlPoints = this.registrationSolution.controlPoints.slice( 0, 4 );
		const modelLocalPoints = controlPoints.map( ( point ) => point.modelLocal.clone() );
		const worldEnuPoints = controlPoints.map( ( point ) => point.worldEnu.clone() );
		const modelLocalEdgeLengths = computeSideLengths( modelLocalPoints );
		const worldEnuFootprintEdgeLengths = computeSideLengths( worldEnuPoints );
		const bestLengthMatch = findBestControlPointLengthMatch( controlPoints );
		const modelLocalSignedArea = signedArea2D( modelLocalPoints, 'xz' );
		const worldEnuSignedArea = signedArea2D( worldEnuPoints, 'xy' );
		const warning: string[] = [];
		if ( Math.sign( modelLocalSignedArea ) !== Math.sign( worldEnuSignedArea ) ) {
			warning.push( 'modelLocal order direction differs from worldEnu order; possible mirrored control point order' );
		}
		if ( maxPairDelta( modelLocalEdgeLengths, worldEnuFootprintEdgeLengths ) > 0.5 ) {
			warning.push(
				bestLengthMatch.bestMaxEdgeDelta <= 0.2
					? 'modelLocal/worldEnu correspondence may be swapped; another point order matches lengths better'
					: 'modelLocal edge lengths differ from worldEnu footprint edge lengths; modelLocal geometry is likely wrong'
			);
		}
		const payload = {
			controlPointIds: controlPoints.map( ( point ) => point.id ),
			cornerRoles: controlPoints.map( ( point ) => this.resolveControlPointCornerRole( point.id ) ),
			modelLocal: modelLocalPoints.map( vector3ToRoundedObject ),
			worldEnu: worldEnuPoints.map( vector3ToRoundedObject ),
			modelLocalEdgeLengths,
			worldEnuFootprintEdgeLengths,
			modelLocalDiagonals: computeDiagonalLengths( modelLocalPoints ),
			worldEnuDiagonals: computeDiagonalLengths( worldEnuPoints ),
			modelLocalYaw: Number( headingFromModelLocalPoints( modelLocalPoints ).toFixed( 3 ) ),
			worldEnuYaw: Number( headingFromEnuPoints( worldEnuPoints ).toFixed( 3 ) ),
			modelLocalOrderSign: Math.sign( modelLocalSignedArea ),
			worldEnuOrderSign: Math.sign( worldEnuSignedArea ),
			bestLengthMatch,
			warning
		};
		const correspondenceVerdict = bestLengthMatch.bestMaxEdgeDelta <= 0.2
			? '疑似 707 点对应关系错，换序可匹配'
			: bestLengthMatch.bestMaxEdgeDelta > 0.5
				? '不是换序问题，modelLocal 几何尺寸不匹配'
				: '点对应关系不确定，需复核';

		arInfo( 'ModelControlPointOrderCheck', payload );
		this.store.patch( {
			footprintDiagnostics: {
				...this.store.getState().footprintDiagnostics,
				modelControlPointOrderText: warning.length > 0
					? `结论：${correspondenceVerdict}；modelLocal 边长 ${modelLocalEdgeLengths.join( '/' )}m；ENU 边长 ${worldEnuFootprintEdgeLengths.join( '/' )}m；最佳换序 ${bestLengthMatch.suggestedWorldPointIds.join( '->' )}，MaxΔ ${bestLengthMatch.bestMaxEdgeDelta.toFixed( 3 )}m`
					: `结论：当前顺序自洽；modelLocal 边长 ${modelLocalEdgeLengths.join( '/' )}m；ENU 边长 ${worldEnuFootprintEdgeLengths.join( '/' )}m；modelYaw ${payload.modelLocalYaw.toFixed( 1 )}° / enuYaw ${payload.worldEnuYaw.toFixed( 1 )}°`
			}
		} );
		if ( warning.length > 0 ) {
			console.error( '[ModelControlPointOrderMismatch]', payload );
			if ( bestLengthMatch.bestMaxEdgeDelta <= 0.2 ) {
				console.error( '[ModelControlPointCorrespondenceLikelyWrong]', payload );
			} else {
				console.error( '[ModelControlPointGeometryMismatch]', payload );
			}
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
		arInfo( 'ModelHierarchyCoordinateSpaceCheck', {
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
		let wrapperHits = 0;
		let contentHits = 0;
		const points = this.registrationSolution.controlPoints.slice( 0, 4 ).map( ( point ) => {
			const distanceToBottomPlaneWrapper = Math.abs( point.modelLocal.y - bboxRoot.min.y );
			const distanceToBottomPlaneContent = bboxContent === null ? null : Math.abs( point.modelLocal.y - bboxContent.min.y );
			const isInsideWrapperBBox = bboxRoot.containsPoint( point.modelLocal );
			const isInsideBBoxContent = bboxContent?.containsPoint( point.modelLocal ) ?? false;
			if ( isInsideWrapperBBox && distanceToBottomPlaneWrapper <= toleranceRoot ) {
				wrapperHits += 1;
			}
			if ( isInsideBBoxContent && distanceToBottomPlaneContent !== null && distanceToBottomPlaneContent <= toleranceContent ) {
				contentHits += 1;
			}
			return {
				controlPointId: point.id,
				modelLocal: vector3ToRoundedObject( point.modelLocal ),
				isInsideWrapperBBox,
				isInsideContentBBox: isInsideBBoxContent,
				distanceToBottomPlaneWrapper: Number( distanceToBottomPlaneWrapper.toFixed( 6 ) ),
				distanceToBottomPlaneContent: distanceToBottomPlaneContent === null ? null : Number( distanceToBottomPlaneContent.toFixed( 6 ) ),
			};
		} );
		const likelySpace = contentHits > wrapperHits ? 'content' : wrapperHits > 0 ? 'wrapper' : 'unknown';
		const warning = likelySpace === 'unknown'
			? '707-1~707-4.modelLocal 不是模型底面 footprint 四角，模型无法落入黄色框。请重新量取模型底面四角或启用 bbox footprint 临时测试。'
			: null;
		const payload = {
			modelBBoxInWrapperLocal: boxToRoundedObject( bboxRoot ),
			modelBBoxInContentLocal: bboxContent === null ? null : boxToRoundedObject( bboxContent ),
			bottomYWrapper: Number( bboxRoot.min.y.toFixed( 6 ) ),
			bottomYContent: bboxContent === null ? null : Number( bboxContent.min.y.toFixed( 6 ) ),
			points,
			likelySpace,
			warning
		};

		if ( warning !== null ) {
			this.store.patch( {
				footprintDiagnostics: {
					...this.store.getState().footprintDiagnostics,
					modelLocalFootprintText: `likely ${likelySpace}；${warning}`
				}
			} );
			console.warn( '[ModelLocalFootprintCheck]', payload );
			return;
		}
		this.store.patch( {
			footprintDiagnostics: {
				...this.store.getState().footprintDiagnostics,
				modelLocalFootprintText: `likely ${likelySpace}；wrapperHits ${wrapperHits}/4；contentHits ${contentHits}/4`
			}
		} );
		arInfo( 'ModelLocalFootprintCheck', payload );

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

	private logModelFinalAxisCheck(arFromEnuSolution: ArFromEnuSolution): void {

		const placedModel = this.placementSession.getArPlacedModel();
		if ( placedModel === null ) {
			return;
		}

		placedModel.updateMatrixWorld( true );
		const modelContent = this.getModelContentObject( placedModel );
		modelContent?.updateMatrixWorld( true );
		const origin = placedModel.localToWorld( new THREE.Vector3() );
		const upPoint = placedModel.localToWorld( new THREE.Vector3( 0, 1, 0 ) );
		const wrapperWorldUp = upPoint.sub( origin ).normalize();
		const contentWorldUp = modelContent === null
			? null
			: new THREE.Vector3( 0, 1, 0 ).transformDirection( modelContent.matrixWorld ).normalize();
		const arWorldUp = new THREE.Vector3( 0, 1, 0 );
		const dotWithArUp = wrapperWorldUp.dot( arWorldUp );
		const determinant = placedModel.matrixWorld.determinant();
		const determinantContent = modelContent === null ? null : modelContent.matrixWorld.determinant();
		const payload = {
			finalQuaternion: quaternionToRoundedObject( placedModel.getWorldQuaternion( new THREE.Quaternion() ) ),
			wrapperWorldUp: vector3ToRoundedObject( wrapperWorldUp ),
			contentWorldUp: contentWorldUp === null ? null : vector3ToRoundedObject( contentWorldUp ),
			arWorldUp: vector3ToRoundedObject( arWorldUp ),
			dotWrapperUp: Number( dotWithArUp.toFixed( 6 ) ),
			dotContentUp: contentWorldUp === null ? null : Number( contentWorldUp.dot( arWorldUp ).toFixed( 6 ) ),
			determinantWrapper: Number( determinant.toFixed( 6 ) ),
			determinantContent: determinantContent === null ? null : Number( determinantContent.toFixed( 6 ) ),
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
		let headingText = 'heading -';
		if ( this.registrationSolution !== null ) {
			const controlPoints = this.registrationSolution.controlPoints.slice( 0, 4 );
			const expectedAr = controlPoints.map( ( point ) => point.worldEnu.clone().applyMatrix4( arFromEnuSolution.matrix ) );
			const actualWrapperAr = controlPoints.map( ( point ) => placedModel.localToWorld( point.modelLocal.clone() ) );
			const expectedFootprintYawDeg = headingFromArPoints( expectedAr );
			const actualModelFootprintYawDeg = headingFromArPoints( actualWrapperAr );
			const headingDeltaDeg = Math.abs( normalizeSignedDegrees( actualModelFootprintYawDeg - expectedFootprintYawDeg ) );
			headingText = `expectedYaw ${expectedFootprintYawDeg.toFixed( 1 )}° / actualYaw ${actualModelFootprintYawDeg.toFixed( 1 )}° / Δ ${headingDeltaDeg.toFixed( 1 )}°`;
			if ( headingDeltaDeg > 5 ) {
				console.error( '[ModelHeadingMismatch]', {
					expectedFootprintYawDeg: Number( expectedFootprintYawDeg.toFixed( 3 ) ),
					actualModelFootprintYawDeg: Number( actualModelFootprintYawDeg.toFixed( 3 ) ),
					headingDeltaDeg: Number( headingDeltaDeg.toFixed( 6 ) )
				} );
			}
		}
		this.store.patch( {
			footprintDiagnostics: {
				...this.store.getState().footprintDiagnostics,
				modelAxisText: `upDot ${dotWithArUp.toFixed( 3 )}；det ${determinant.toFixed( 3 )}；${headingText}${payload.warning === null ? '' : `；${payload.warning}`}`
			}
		} );
		if ( dotWithArUp < 0 ) {
			console.error( '[ModelUpsideDownDetected]', payload );
			const rootPosition = placedModel.getWorldPosition( new THREE.Vector3() );
			const rootQuaternion = placedModel.getWorldQuaternion( new THREE.Quaternion() );
			const rootScale = placedModel.getWorldScale( new THREE.Vector3() );
			const correction = new THREE.Quaternion().setFromUnitVectors( wrapperWorldUp, new THREE.Vector3( 0, 1, 0 ) );
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
		arInfo( 'ModelFinalAxisCheck', payload );

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
		this.arCoordinateService.setArFromEnuSolution( this.activeMarkerArFromEnuSolution, this.currentArSessionId );
		this.annotationLayer.updateFromCalibration( this.arCoordinateService );
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
		arInfo( 'CurrentSessionLocalizationCached', {
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
			metadata.capturedCornersAr ?? [],
			'marker-calibration'
		);
		const appliedToPlacedModel = false;
		const autoPlacementPendingAfter = this.placementSession.getAutoPlacementPending();
		const placedModelAfter = this.placementSession.getPlacedModel();
		const modelPlacedAfter = placedModelAfter !== null;
		const modelVisibleAfter = placedModelAfter?.visible === true;
		const modelWasPlacedAutomatically = modelPlacedBefore === false
			&& modelPlacedAfter;
		arInfo( 'MarkerCalibrationApplyFlow', {
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
		arInfo( 'MarkerCalibrationCompletedWithoutPlacement', {
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
			arInfo( 'SiteBaselineConfigTemporarySolutionCreated', {
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
			arInfo( 'ArInspectionLocalizationApplied', {
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
		arInfo( 'MarkerCorrectionApplied', {
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

		const hadPlacedModel = this.placementSession.getPlacedModel() !== null;
		this.engineeringPlacementCallCount += 1;
		this.replacedModelCount += hadPlacedModel ? 1 : 0;
		this.lastPlacementReason = 'engineering-place-button';
		this.lastPlacementTimestamp = Date.now();
		await this.placementWorkflow.placeLocalizedModel();
		if ( this.placementSession.getPlacedModel() === null ) {
			this.syncModelPlacementDebug( arFromEnuSolution );
			return;
		}

		this.resetModelPlacementWorldLockBaseline();
		this.logModelHierarchyCoordinateSpaceCheck();
		this.logModelControlPointOrderCheck();
		this.logModelLocalFootprintCheck();
		this.logModelFinalAxisCheck( arFromEnuSolution );
		this.renderEngineeringCornerDebug(
			arFromEnuSolution,
			guard.controlTarget ?? this.getActiveEngineeringControlTarget(),
			[],
			'engineering-place-button'
		);
		this.logModelAxisMappingCheck( arFromEnuSolution );
		this.logModelControlPointPlacementCheck( arFromEnuSolution );
		this.logEngineeringPlacementApplied( arFromEnuSolution, guard.controlTarget ?? null );
		this.syncModelPlacementDebug( arFromEnuSolution );

	}

	private resetModelPlacementWorldLockBaseline(): void {

		const diagnostics = this.placementSession.getWorldLockDiagnostics();
		this.fixedEngineeringMatrix = diagnostics.initialSnapshot?.engineeringMatrix?.clone() ?? null;
		this.fixedVisualMatrix = diagnostics.initialSnapshot?.visualMatrix?.clone() ?? null;
		this.yellowSurfaceInitialCenterWorld = null;
		this.purpleEngineeringInitialCenterWorld = null;
		this.undergroundExpectedInitialCenterWorld = null;
		this.yellowScreenInitial = null;
		this.purpleEngineeringScreenInitial = null;
		this.undergroundExpectedScreenInitial = null;
		this.yellowToUndergroundScreenDistanceInitialPx = null;
		this.diagnosticSampleCount = 0;
		this.yellowUpdateCount = 0;
		this.purpleEngineeringUpdateCount = 0;
		this.undergroundExpectedUpdateCount = 0;
		this.currentModelActualUpdateCount = 0;
		this.yellowLastUpdateReason = 'none';
		this.purpleEngineeringLastUpdateReason = 'none';
		this.undergroundExpectedLastUpdateReason = 'none';
		this.currentModelActualLastUpdateReason = 'none';
		this.purpleDiagnosticsUpdatedInFrameLoop = false;
		this.placementDebugLastWorldLockUpdateAt = 0;

	}

	private updateModelPlacementWorldLockDebug(): void {

		const now = Date.now();
		if ( now - this.placementDebugLastWorldLockUpdateAt < 1000 ) {
			return;
		}

		if ( this.placementSession.getArPlacedModel() === null ) {
			return;
		}

		this.placementDebugLastWorldLockUpdateAt = now;
		this.syncModelPlacementDebug( this.getActiveArFromEnuSolution() );

	}

	private syncModelPlacementDebug(arFromEnuSolution: ArFromEnuSolution | null): void {

		const placedModel = this.placementSession.getArPlacedModel();
		const registrationSolution = this.registrationSolution;
		const modelTemplate = this.modelTemplate;
		const worldLockDiagnostics = this.placementSession.getWorldLockDiagnostics();
		const initialSnapshot = worldLockDiagnostics.initialSnapshot;
		const currentSnapshot = worldLockDiagnostics.currentSnapshot;
		const activeCamera = this.sceneBundle.renderer.xr.isPresenting
			? this.sceneBundle.renderer.xr.getCamera()
			: this.sceneBundle.camera;
		this.sceneBundle.scene.updateMatrixWorld( true );
		this.sceneBundle.camera.updateMatrixWorld( true );
		activeCamera.updateMatrixWorld( true );
		this.sceneBundle.arModelAnchor.updateMatrixWorld( true );
		this.sceneBundle.arPlacementAnchor.updateMatrixWorld( true );
		this.sceneBundle.reticle.updateMatrixWorld( true );
		placedModel?.updateMatrixWorld( true );
		const partial: ModelPlacementDebugState = {
			sessionId: this.currentArSessionId,
			buildCommit: __BUILD_COMMIT__,
			updatedAt: Date.now(),
			diagnosticSampleCount: this.diagnosticSampleCount,
			engineeringPlacementCallCount: this.engineeringPlacementCallCount,
			lastPlacementReason: this.lastPlacementReason,
			lastPlacementTimestamp: this.lastPlacementTimestamp || undefined,
			replacedModelCount: this.replacedModelCount,
			hasExistingPlacedModel: placedModel !== null,
			modelParentName: placedModel?.parent?.name || placedModel?.parent?.type || '-',
			arModelAnchorParentName: this.sceneBundle.arModelAnchor.parent?.name || this.sceneBundle.arModelAnchor.parent?.type || '-',
			arPlacementAnchorParentName: this.sceneBundle.arPlacementAnchor.parent?.name || this.sceneBundle.arPlacementAnchor.parent?.type || '-',
			placedModelParentChain: placedModel === null ? [] : formatParentChain( placedModel ),
			modelAnchorParentChain: formatParentChain( this.sceneBundle.arModelAnchor ),
			placementAnchorParentChain: formatParentChain( this.sceneBundle.arPlacementAnchor ),
			arModelAnchorParentChain: formatParentChain( this.sceneBundle.arModelAnchor ),
			arPlacementAnchorParentChain: formatParentChain( this.sceneBundle.arPlacementAnchor ),
			reticleParentChain: formatParentChain( this.sceneBundle.reticle ),
			cameraParentChain: formatParentChain( activeCamera ),
			unexpectedArModelAnchorParent: this.sceneBundle.arModelAnchor.parent !== this.sceneBundle.scene,
			isPlacedModelChildOfPlacementAnchor: placedModel === null ? false : isDescendantOf( placedModel, this.sceneBundle.arPlacementAnchor ),
			isArModelAnchorChildOfPlacementAnchor: isDescendantOf( this.sceneBundle.arModelAnchor, this.sceneBundle.arPlacementAnchor ),
			isArModelAnchorChildOfCamera: isDescendantOf( this.sceneBundle.arModelAnchor, this.sceneBundle.camera ),
			isArModelAnchorChildOfReticle: isDescendantOf( this.sceneBundle.arModelAnchor, this.sceneBundle.reticle ),
			isArModelAnchorChildOfScene: isDescendantOf( this.sceneBundle.arModelAnchor, this.sceneBundle.scene ),
			isModelChildOfCamera: placedModel === null ? false : isDescendantOf( placedModel, activeCamera ),
			isModelChildOfReticle: placedModel === null ? false : isDescendantOf( placedModel, this.sceneBundle.reticle ),
			isModelChildOfPlacementAnchor: placedModel === null ? false : isDescendantOf( placedModel, this.sceneBundle.arPlacementAnchor ),
			isModelAnchorChildOfScene: isDescendantOf( this.sceneBundle.arModelAnchor, this.sceneBundle.scene ),
			isPlacementAnchorChildOfScene: isDescendantOf( this.sceneBundle.arPlacementAnchor, this.sceneBundle.scene ),
			placementAnchorUpdateCount: worldLockDiagnostics.placementAnchorUpdateCount,
			lastPlacementAnchorUpdateReason: worldLockDiagnostics.lastPlacementAnchorUpdateReason,
			lastPlacementAnchorUpdateTimestamp: worldLockDiagnostics.lastPlacementAnchorUpdateTimestamp ?? undefined,
			placementAnchorUpdatedFromFrameLoop: worldLockDiagnostics.placementAnchorUpdatedFromFrameLoop,
			placementAnchorUpdatedFromHitTest: worldLockDiagnostics.placementAnchorUpdatedFromHitTest,
			placementAnchorUpdatedFromReticle: worldLockDiagnostics.placementAnchorUpdatedFromReticle,
			updatedPlacementAnchorFromFrameLoop: worldLockDiagnostics.placementAnchorUpdatedFromFrameLoop,
			calledFromFrameLoop: false,
			calledFromHitTest: false,
			calledFromButton: this.lastPlacementReason === 'engineering-place-button'
		};

		if ( placedModel !== null && initialSnapshot !== null && currentSnapshot !== null ) {
			this.diagnosticSampleCount += 1;
			partial.diagnosticSampleCount = this.diagnosticSampleCount;
			const currentModelWorldPosition = currentSnapshot.placedModelWorldPosition;
			const currentArModelAnchorWorldPosition = currentSnapshot.arModelAnchorWorldPosition;
			const currentArPlacementAnchorWorldPosition = currentSnapshot.arPlacementAnchorWorldPosition;
			const currentCameraWorldPosition = currentSnapshot.cameraWorldPosition;
			const modelWorldDeltaXZ = horizontalDistanceXZ(
				initialSnapshot.placedModelWorldPosition,
				currentModelWorldPosition
			);
			const arModelAnchorWorldDeltaXZ = horizontalDistanceXZ(
				initialSnapshot.arModelAnchorWorldPosition,
				currentArModelAnchorWorldPosition
			);
			const arPlacementAnchorWorldDeltaXZ = horizontalDistanceXZ(
				initialSnapshot.arPlacementAnchorWorldPosition,
				currentArPlacementAnchorWorldPosition
			);
			const modelWorldDeltaY = Math.abs( currentModelWorldPosition.y - initialSnapshot.placedModelWorldPosition.y );
			const arModelAnchorWorldDeltaY = Math.abs( currentArModelAnchorWorldPosition.y - initialSnapshot.arModelAnchorWorldPosition.y );
			const arPlacementAnchorWorldDeltaY = Math.abs( currentArPlacementAnchorWorldPosition.y - initialSnapshot.arPlacementAnchorWorldPosition.y );
			const cameraMovedDistance = initialSnapshot.cameraWorldPosition.distanceTo( currentCameraWorldPosition );
			const cameraToModelDistance = currentSnapshot.cameraToModelDistance;
			const worldLock = resolveWorldLockStatus( cameraMovedDistance, modelWorldDeltaXZ );
			Object.assign( partial, {
				placedModelInitialWorld: vector3ToRoundedObject( initialSnapshot.placedModelWorldPosition ),
				placedModelCurrentWorld: vector3ToRoundedObject( currentModelWorldPosition ),
				placedModelDeltaX: roundMeters( currentModelWorldPosition.x - initialSnapshot.placedModelWorldPosition.x ),
				placedModelDeltaY: roundMeters( currentModelWorldPosition.y - initialSnapshot.placedModelWorldPosition.y ),
				placedModelDeltaZ: roundMeters( currentModelWorldPosition.z - initialSnapshot.placedModelWorldPosition.z ),
				placedModelDeltaXZ: roundMeters( modelWorldDeltaXZ ),
				modelAnchorInitialWorld: vector3ToRoundedObject( initialSnapshot.arModelAnchorWorldPosition ),
				modelAnchorCurrentWorld: vector3ToRoundedObject( currentArModelAnchorWorldPosition ),
				modelAnchorDeltaX: roundMeters( currentArModelAnchorWorldPosition.x - initialSnapshot.arModelAnchorWorldPosition.x ),
				modelAnchorDeltaY: roundMeters( currentArModelAnchorWorldPosition.y - initialSnapshot.arModelAnchorWorldPosition.y ),
				modelAnchorDeltaZ: roundMeters( currentArModelAnchorWorldPosition.z - initialSnapshot.arModelAnchorWorldPosition.z ),
				modelAnchorDeltaXZ: roundMeters( arModelAnchorWorldDeltaXZ ),
				placementAnchorInitialWorld: vector3ToRoundedObject( initialSnapshot.arPlacementAnchorWorldPosition ),
				placementAnchorCurrentWorld: vector3ToRoundedObject( currentArPlacementAnchorWorldPosition ),
				placementAnchorDeltaX: roundMeters( currentArPlacementAnchorWorldPosition.x - initialSnapshot.arPlacementAnchorWorldPosition.x ),
				placementAnchorDeltaY: roundMeters( currentArPlacementAnchorWorldPosition.y - initialSnapshot.arPlacementAnchorWorldPosition.y ),
				placementAnchorDeltaZ: roundMeters( currentArPlacementAnchorWorldPosition.z - initialSnapshot.arPlacementAnchorWorldPosition.z ),
				placementAnchorDeltaXZ: roundMeters( arPlacementAnchorWorldDeltaXZ ),
				cameraInitialWorld: vector3ToRoundedObject( initialSnapshot.cameraWorldPosition ),
				cameraCurrentWorld: vector3ToRoundedObject( currentCameraWorldPosition ),
				initialModelWorldPosition: vector3ToRoundedObject( initialSnapshot.placedModelWorldPosition ),
				currentModelWorldPosition: vector3ToRoundedObject( currentModelWorldPosition ),
				modelWorldDeltaXZ: roundMeters( modelWorldDeltaXZ ),
				modelWorldDeltaY: roundMeters( modelWorldDeltaY ),
				arModelAnchorWorldDeltaXZ: roundMeters( arModelAnchorWorldDeltaXZ ),
				arModelAnchorWorldDeltaY: roundMeters( arModelAnchorWorldDeltaY ),
				arPlacementAnchorWorldDeltaXZ: roundMeters( arPlacementAnchorWorldDeltaXZ ),
				arPlacementAnchorWorldDeltaY: roundMeters( arPlacementAnchorWorldDeltaY ),
				initialCameraWorldPosition: vector3ToRoundedObject( initialSnapshot.cameraWorldPosition ),
				currentCameraWorldPosition: vector3ToRoundedObject( currentCameraWorldPosition ),
				cameraMovedDistance: roundMeters( cameraMovedDistance ),
				cameraToModelDistanceInitial: roundMeters( initialSnapshot.cameraToModelDistance ),
				cameraToModelDistanceCurrent: roundMeters( cameraToModelDistance ),
				cameraToModelDistance: roundMeters( cameraToModelDistance ),
				cameraToModelDistanceDelta: roundMeters( Math.abs( cameraToModelDistance - initialSnapshot.cameraToModelDistance ) ),
				isWorldLocked: worldLock.isWorldLocked,
				worldLockStatus: worldLock.status,
				placedModelMatrixWorldChanged: matrixChanged( initialSnapshot.placedModelMatrixWorld, placedModel.matrixWorld ),
				placedModelMatrixTranslationDelta: matrixTranslationDistance( initialSnapshot.placedModelMatrixWorld, placedModel.matrixWorld ),
				placedModelMatrixWorldElements: roundMatrixElements( placedModel.matrixWorld ),
				modelAnchorMatrixWorldElements: roundMatrixElements( this.sceneBundle.arModelAnchor.matrixWorld ),
				placementAnchorMatrixWorldElements: roundMatrixElements( this.sceneBundle.arPlacementAnchor.matrixWorld ),
				arModelAnchorMatrixWorldChanged: matrixChanged( initialSnapshot.arModelAnchorMatrixWorld, this.sceneBundle.arModelAnchor.matrixWorld ),
				arPlacementAnchorMatrixWorldChanged: matrixChanged( initialSnapshot.arPlacementAnchorMatrixWorld, this.sceneBundle.arPlacementAnchor.matrixWorld ),
				modelAnchorMatrixWorldChanged: matrixChanged( initialSnapshot.arModelAnchorMatrixWorld, this.sceneBundle.arModelAnchor.matrixWorld ),
				placementAnchorMatrixWorldChanged: matrixChanged( initialSnapshot.arPlacementAnchorMatrixWorld, this.sceneBundle.arPlacementAnchor.matrixWorld )
			} );
		}

		if ( registrationSolution !== null && modelTemplate !== null ) {
			const undergroundPlacement = deriveUndergroundRegistrationSolution( {
				registrationSolution,
				modelTemplate
			} );
			Object.assign( partial, {
				undergroundPlacementMode: undergroundPlacement.enabled ? 'rtk-derived-elevation' : 'surface',
				undergroundMode: registrationSolution.undergroundDisplay?.defaultMode ?? undefined,
				modelHeightSource: undergroundPlacement.modelHeightSource,
				modelHeight: undergroundPlacement.modelHeightMeters,
				modelHeightAxis: undergroundPlacement.modelHeightAxis ?? undefined,
				modelHeightX: undergroundPlacement.modelSizeX ?? undefined,
				modelHeightY: undergroundPlacement.modelSizeY ?? undefined,
				modelHeightZ: undergroundPlacement.modelSizeZ ?? undefined,
				modelSizeX: undergroundPlacement.modelSizeX ?? undefined,
				modelSizeY: undergroundPlacement.modelSizeY ?? undefined,
				modelSizeZ: undergroundPlacement.modelSizeZ ?? undefined,
				chosenModelHeight: undergroundPlacement.modelHeightMeters,
				modelHeightToYDifferenceMeters: undergroundPlacement.modelHeightToYDifferenceMeters,
				coverDepthMeters: roundMeters( undergroundPlacement.coverDepthMeters ),
				totalBottomDepthMeters: roundMeters( undergroundPlacement.totalBottomDepthMeters ),
				engineeringUndergroundOffsetY: roundMeters( - undergroundPlacement.totalBottomDepthMeters ),
				surfaceElevationText: formatControlPointElevations( registrationSolution.controlPoints ),
				undergroundElevationText: formatControlPointElevations( undergroundPlacement.undergroundControlPoints ),
				depthMeters: roundMeters( undergroundPlacement.totalBottomDepthMeters ),
				xrayOpacity: registrationSolution.undergroundDisplay?.xrayOpacity ?? undefined
			} );
		}

		if ( registrationSolution !== null && arFromEnuSolution !== null ) {
			const effectiveRegistrationSolution = modelTemplate === null
				? registrationSolution
				: deriveUndergroundRegistrationSolution( { registrationSolution, modelTemplate } ).registrationSolution;
			const currentEngineeringMatrix = this.fixedEngineeringMatrix ?? composeModelRawLocalToArMatrix( {
				arFromEnuSolution,
				registrationSolution: effectiveRegistrationSolution
			} );
			const baselineEngineeringMatrix = this.fixedEngineeringMatrix
				?? initialSnapshot?.engineeringMatrix
				?? currentEngineeringMatrix;
			const baselineArFromEnuMatrix = initialSnapshot?.arFromEnuMatrix ?? arFromEnuSolution.matrix;
			Object.assign( partial, computePlacementErrorDebug( {
				registrationSolution: effectiveRegistrationSolution,
				arFromEnuSolution,
				engineeringMatrix: baselineEngineeringMatrix
			} ), {
				engineeringMatrixChanged: matrixChanged( initialSnapshot?.engineeringMatrix ?? null, currentEngineeringMatrix ),
				arFromEnuMatrixChanged: matrixChanged( baselineArFromEnuMatrix, arFromEnuSolution.matrix ),
				engineeringMatrixTranslationDelta: matrixTranslationDistance( initialSnapshot?.engineeringMatrix, currentEngineeringMatrix ),
				engineeringMatrixElements: roundMatrixElements( currentEngineeringMatrix ),
				arFromEnuMatrixElements: roundMatrixElements( arFromEnuSolution.matrix )
			} );

			const footprintControlPoints = registrationSolution.controlPoints.slice( 0, 4 );
			if ( footprintControlPoints.length > 0 ) {
				const yellowSurfacePoints = footprintControlPoints
					.map( ( point ) => point.worldEnu.clone().applyMatrix4( arFromEnuSolution.matrix ) );
				const purpleEngineeringPoints = footprintControlPoints
					.map( ( point ) => point.modelLocal.clone().applyMatrix4( baselineEngineeringMatrix ) );
				const undergroundExpectedPoints = footprintControlPoints
					.map( ( _point, index ) => effectiveRegistrationSolution.controlPoints[ index ]?.worldEnu.clone().applyMatrix4( arFromEnuSolution.matrix ) )
					.filter( ( point ): point is THREE.Vector3 => point !== undefined );
				const yellowSurfaceCenter = averageVectors( yellowSurfacePoints );
				const purpleEngineeringCenter = averageVectors( purpleEngineeringPoints );
				const undergroundExpectedCenter = averageVectors( undergroundExpectedPoints );
				const currentModelActualCenter = placedModel === null
					? null
					: averageVectors( footprintControlPoints.map( ( point ) => point.modelLocal ) )
						.applyMatrix4( placedModel.matrixWorld );
				const currentModelActualInitialCenter = initialSnapshot === null
					? currentModelActualCenter
					: averageVectors( footprintControlPoints.map( ( point ) => point.modelLocal ) )
						.applyMatrix4( initialSnapshot.placedModelMatrixWorld );
				const yellowInitialCenter = this.yellowSurfaceInitialCenterWorld ?? yellowSurfaceCenter;
				const purpleEngineeringInitialCenter = this.purpleEngineeringInitialCenterWorld ?? purpleEngineeringCenter;
				const undergroundExpectedInitialCenter = this.undergroundExpectedInitialCenterWorld ?? undergroundExpectedCenter;
				const yellowScreenCurrent = projectWorldToScreen(
					yellowSurfaceCenter,
					activeCamera,
					this.sceneBundle.renderer.domElement
				);
				const purpleEngineeringScreenCurrent = projectWorldToScreen(
					purpleEngineeringCenter,
					activeCamera,
					this.sceneBundle.renderer.domElement
				);
				const undergroundExpectedScreenCurrent = projectWorldToScreen(
					undergroundExpectedCenter,
					activeCamera,
					this.sceneBundle.renderer.domElement
				);
				this.yellowScreenInitial ??= { ...yellowScreenCurrent };
				this.purpleEngineeringScreenInitial ??= { ...purpleEngineeringScreenCurrent };
				this.undergroundExpectedScreenInitial ??= { ...undergroundExpectedScreenCurrent };
				const yellowToUndergroundScreenDistanceCurrentPx = screenPointDistance(
					yellowScreenCurrent,
					undergroundExpectedScreenCurrent
				);
				this.yellowToUndergroundScreenDistanceInitialPx ??= screenPointDistance(
					this.yellowScreenInitial,
					this.undergroundExpectedScreenInitial
				);
				if ( currentModelActualCenter !== null && currentModelActualInitialCenter !== null ) {
					this.currentModelActualUpdateCount += 1;
					this.currentModelActualLastUpdateReason = 'world-lock-sample';
				}
				Object.assign( partial, {
					yellowCenterInitialWorld: vector3ToRoundedObject( yellowInitialCenter ),
					yellowCenterCurrentWorld: vector3ToRoundedObject( yellowSurfaceCenter ),
					yellowWorldDeltaXZ: roundMeters( horizontalDistanceXZ( yellowInitialCenter, yellowSurfaceCenter ) ),
					yellowWorldDeltaY: roundMeters( Math.abs( yellowSurfaceCenter.y - yellowInitialCenter.y ) ),
					yellowScreenInitial: this.yellowScreenInitial,
					yellowScreenCurrent: yellowScreenCurrent,
					yellowScreenDeltaPx: roundPixels( screenPointDistance( this.yellowScreenInitial, yellowScreenCurrent ) ),
					purpleEngineeringCenterInitialWorld: vector3ToRoundedObject( purpleEngineeringInitialCenter ),
					purpleEngineeringCenterCurrentWorld: vector3ToRoundedObject( purpleEngineeringCenter ),
					purpleEngineeringWorldDeltaXZ: roundMeters( horizontalDistanceXZ( purpleEngineeringInitialCenter, purpleEngineeringCenter ) ),
					purpleEngineeringWorldDeltaY: roundMeters( Math.abs( purpleEngineeringCenter.y - purpleEngineeringInitialCenter.y ) ),
					purpleEngineeringScreenDeltaPx: roundPixels( screenPointDistance( this.purpleEngineeringScreenInitial, purpleEngineeringScreenCurrent ) ),
					undergroundExpectedCenterInitialWorld: vector3ToRoundedObject( undergroundExpectedInitialCenter ),
					undergroundExpectedCenterCurrentWorld: vector3ToRoundedObject( undergroundExpectedCenter ),
					undergroundExpectedWorldDeltaXZ: roundMeters( horizontalDistanceXZ( undergroundExpectedInitialCenter, undergroundExpectedCenter ) ),
					undergroundExpectedWorldDeltaY: roundMeters( Math.abs( undergroundExpectedCenter.y - undergroundExpectedInitialCenter.y ) ),
					undergroundExpectedScreenDeltaPx: roundPixels( screenPointDistance( this.undergroundExpectedScreenInitial, undergroundExpectedScreenCurrent ) ),
					currentModelActualCenterWorld: currentModelActualCenter === null ? undefined : vector3ToRoundedObject( currentModelActualCenter ),
					currentModelActualWorldDeltaXZ: currentModelActualCenter === null || currentModelActualInitialCenter === null
						? undefined
						: roundMeters( horizontalDistanceXZ( currentModelActualInitialCenter, currentModelActualCenter ) ),
					currentModelActualWorldDeltaY: currentModelActualCenter === null || currentModelActualInitialCenter === null
						? undefined
						: roundMeters( Math.abs( currentModelActualCenter.y - currentModelActualInitialCenter.y ) ),
					yellowSurfaceCenterWorld: vector3ToRoundedObject( yellowSurfaceCenter ),
					purpleEngineeringCenterWorld: vector3ToRoundedObject( purpleEngineeringCenter ),
					undergroundExpectedCenterWorld: vector3ToRoundedObject( undergroundExpectedCenter ),
					yellowSurfaceDeltaXZ: roundMeters( horizontalDistanceXZ( yellowInitialCenter, yellowSurfaceCenter ) ),
					yellowSurfaceDeltaY: roundMeters( Math.abs( yellowSurfaceCenter.y - yellowInitialCenter.y ) ),
					purpleEngineeringDeltaXZ: roundMeters( horizontalDistanceXZ( purpleEngineeringInitialCenter, purpleEngineeringCenter ) ),
					purpleEngineeringDeltaY: roundMeters( Math.abs( purpleEngineeringCenter.y - purpleEngineeringInitialCenter.y ) ),
					undergroundExpectedDeltaXZ: roundMeters( horizontalDistanceXZ( undergroundExpectedInitialCenter, undergroundExpectedCenter ) ),
					undergroundExpectedDeltaY: roundMeters( Math.abs( undergroundExpectedCenter.y - undergroundExpectedInitialCenter.y ) ),
					yellowUpdateCount: this.yellowUpdateCount,
					purpleEngineeringUpdateCount: this.purpleEngineeringUpdateCount,
					undergroundExpectedUpdateCount: this.undergroundExpectedUpdateCount,
					currentModelActualUpdateCount: this.currentModelActualUpdateCount,
					yellowLastUpdateReason: this.yellowLastUpdateReason,
					purpleEngineeringLastUpdateReason: this.purpleEngineeringLastUpdateReason,
					undergroundExpectedLastUpdateReason: this.undergroundExpectedLastUpdateReason,
					currentModelActualLastUpdateReason: this.currentModelActualLastUpdateReason,
					purpleDiagnosticsUpdatedInFrameLoop: this.purpleDiagnosticsUpdatedInFrameLoop,
					engineeringMinusYellowXZ: roundMeters( horizontalDistanceXZ( purpleEngineeringCenter, yellowSurfaceCenter ) ),
					engineeringMinusYellowY: roundMeters( Math.abs( purpleEngineeringCenter.y - yellowSurfaceCenter.y ) ),
					undergroundMinusYellowXZ: roundMeters( horizontalDistanceXZ( undergroundExpectedCenter, yellowSurfaceCenter ) ),
					undergroundMinusYellowY: roundMeters( Math.abs( undergroundExpectedCenter.y - yellowSurfaceCenter.y ) ),
					undergroundMinusEngineeringXZ: roundMeters( horizontalDistanceXZ( undergroundExpectedCenter, purpleEngineeringCenter ) ),
					undergroundMinusEngineeringY: roundMeters( Math.abs( undergroundExpectedCenter.y - purpleEngineeringCenter.y ) ),
					yellowToUndergroundScreenDistanceInitialPx: roundPixels( this.yellowToUndergroundScreenDistanceInitialPx ),
					yellowToUndergroundScreenDistanceCurrentPx: roundPixels( yellowToUndergroundScreenDistanceCurrentPx ),
					yellowToUndergroundScreenDistanceDeltaPx: roundPixels(
						Math.abs( yellowToUndergroundScreenDistanceCurrentPx - this.yellowToUndergroundScreenDistanceInitialPx )
					)
				} );
			}
		}

		partial.parallaxStatus = resolveParallaxStatus( partial );
		partial.conclusion = createModelPlacementDebugConclusion( partial );
		this.store.patchModelPlacementDebug( partial );

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
			arInfo( 'LocalizationPriorityResolved', {
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
			arInfo( 'LocalizationPriorityResolved', {
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
		this.arCoordinateService.clear( 'marker-localization-reset' );
		this.annotationLayer.clear();
		this.annotationLayer.setSelected( null );
		this.clearAnnotationDetail();
		this.clearEngineeringCornerDebug();
		this.store.clearModelPlacementDebug();

	}

	private logRegistrationFinal(): void {

		const arFromEnuSolution = this.getActiveArFromEnuSolution();
		const placedModel = this.placementSession.getArPlacedModel();
		placedModel?.updateMatrixWorld( true );
		arInfo( 'RegistrationFinal', {
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


	private updateRealDepth(frame: XRFrame): void {
		const referenceSpace = this.sceneBundle.renderer.xr.getReferenceSpace();
		const view = referenceSpace === null ? null : frame.getViewerPose( referenceSpace )?.views[ 0 ] ?? null;
		if ( this.realDepthProvider.isSessionEnabled() && view !== null ) {
			this.realDepthProvider.update( frame, view, performance.now() );
		}

	}

	private updateUndergroundPortal(): void {
		const depthFrame = this.realDepthProvider.getCurrentFrame();
		const args = this.portalUpdateArgs!;
		args.mainCamera = this.sceneBundle.renderer.xr.getCamera();
		args.model = this.placementSession.getArPlacedModel();
		args.footprintCorners = this.getCurrentFootprintCornersAr();
		args.depthFrame = depthFrame;
		args.enabled = this.store.getState().displayMode === 'underground-portal';
		this.undergroundPortal.update( args );
		this.logPortalDiagnostics( depthFrame );

	}

	private getCurrentFootprintCornersAr(): THREE.Vector3[] {

		const arFromEnuSolution = this.getActiveArFromEnuSolution();
		if ( this.registrationSolution === null || arFromEnuSolution === null || this.registrationSolution.controlPoints.length < 4 ) return this.emptyFootprintCorners;
		for ( let index = 0; index < 4; index += 1 ) {
			this.footprintCornersAr[ index ].copy( this.registrationSolution.controlPoints[ index ].worldEnu ).applyMatrix4( arFromEnuSolution.matrix );
		}
		return this.footprintCornersAr;

	}

	private logPortalDiagnostics(depthFrame: ReturnType<RealDepthProvider['getCurrentFrame']>): void {

		if ( import.meta.env.DEV === false || new URLSearchParams( window.location.search ).get( 'arDebug' ) !== 'portal' ) return;
		const now = performance.now();
		if ( now - this.lastPortalDebugAt < 500 ) return;
		this.lastPortalDebugAt = now;
		console.info( '[PortalDiagnostics]', {
			...this.undergroundPortal.getDiagnostics(),
			cpuDepthValid: depthFrame.available && depthFrame.stale === false,
			depthSize: `${depthFrame.width}x${depthFrame.height}`,
			rawValueToMeters: depthFrame.rawValueToMeters,
			depthAgeMs: Math.round( depthFrame.ageMs )
		} );

	}

	private handleXRSessionStart(result: ArSessionStartResult): void {

		this.store.clearModelPlacementDebug();
		if ( result.depthGranted ) this.realDepthProvider.initialize( result.session );
		else this.realDepthProvider.dispose();
		this.sessionLifecycleRuntime.handleXRSessionStart();

	}

	private handleXRSessionEnd(): void {

		this.arSessionEndPending = false;
		this.undergroundPortal.reset();
		this.realDepthProvider.dispose();
		this.arCoordinateService.clear( 'xr-session-end' );
		this.annotationLayer.clear();
		this.annotationLayer.setSelected( null );
		this.clearAnnotationDetail();
		this.store.clearModelPlacementDebug();
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
			arInfo( 'ArAnnotationLabels', {
				labelCount: 0,
				source: 'terrain-layer',
				modelPlaced: false,
				visible: false
			} );
			return;
		}

		const items = this.buildAnnotationItemsForPlacedModel( placedModel );
		this.annotationLabelsController.setItems( items );
		arInfo( 'ArAnnotationLabels', {
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
		arInfo( 'ArAnnotationSelected', {
			id: item.id,
			title: item.title,
			objectName: item.objectName ?? item.targetObject.name,
			layerName: item.layerName ?? ''
		} );
		this.setStatus( `已选择 ${item.title}。` );
		this.emit();

	}

	private showCanvasModelPropertyPanel(
		businessObject: THREE.Object3D,
		properties: PipeRecord | null,
		preferredLayerName?: string
	): void {

		this.logCanvasPropertyPanelAuditOnce();
		const bounds = new THREE.Box3().setFromObject( businessObject );
		const selection = resolveModelObjectSelection( {
			object: businessObject,
			properties
		} );
		const panelData = resolveModelObjectProperties( {
			selection,
			properties,
			layerName: preferredLayerName
				?? getLayerLabelForObject( businessObject, this.store.getState().modelLayers )
				?? undefined,
			materialName: getObjectMaterialName( businessObject ),
			bounds
		} );

		this.store.patch( {
			selectedAnnotationId: null,
			annotationDetail: createDefaultAnnotationDetailState()
		} );
		this.annotationLayer.setSelected( null );
		this.annotationLabelsController.setDetail(
			this.createCanvasModelPropertyOverlay( businessObject, panelData )
		);

		arInfo( 'CanvasModelPropertyPanelShown', {
			modelInstanceId: panelData.modelInstanceId,
			modelInstanceName: panelData.modelInstanceName,
			modelRole: panelData.modelRole,
			objectId: panelData.objectId,
			objectName: panelData.objectName,
			rowCount: panelData.sections.reduce( ( total, section ) => total + section.rows.length, 0 )
		} );

	}

	private createCanvasModelPropertyOverlay(
		targetObject: THREE.Object3D,
		panelData: CanvasModelPropertyPanelData
	): ArAnnotationDetailOverlay | null {

		const fields = panelData.sections.flatMap( ( section ) => section.rows.map( ( row ) => ( {
			label: row.label,
			value: row.unit === undefined ? row.value : `${row.value}${row.unit}`
		} ) ) );
		if ( fields.length === 0 ) {
			return null;
		}

		return {
			targetObject,
			title: panelData.title,
			subtitle: `${panelData.modelInstanceName} / ${panelData.modelRole}`,
			fields
		};

	}

	private logCanvasPropertyPanelAuditOnce(): void {

		if ( this.canvasPropertyPanelAuditLogged ) {
			return;
		}
		this.canvasPropertyPanelAuditLogged = true;
		arInfo( 'CanvasPropertyPanelAudit', {
			canvasEntry: 'src/engine/annotation/ar-annotation-labels.ts:createDetailTexture',
			rendererEntry: 'createArAnnotationLabelController.setDetail -> THREE.CanvasTexture -> THREE.Sprite',
			selectionEntry: 'src/engine/interaction/pointer-selection.ts:onSelectionApplied',
			propertyDataType: 'CanvasModelPropertyPanelData',
			renderMode: 'CanvasTexture Sprite in AR scene',
			closeInteraction: 'clearSelection / blank tap / replacement selection calls setDetail(null)',
			refreshStrategy: 'redraw only when selected object changes',
			currentLimitations: [
				'screen-boundary clamping is not implemented for world-space sprite panels',
				'full multi-model loading manager is not introduced in this minimal pass'
			]
		} );

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

		this.store.patch( {
			selectedAnnotationId: null,
			annotationDetail: createDefaultAnnotationDetailState()
		} );
		this.annotationLabelsController.setDetail( null );
		this.annotationLayer.setSelected( null );

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
		this.undergroundPortal.markDirty();

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

	private handleBusinessAnnotationPick(raycaster: THREE.Raycaster): boolean {

		const hit = raycaster.intersectObjects( this.annotationLayer.getPickableObjects(), true )[ 0 ];
		if ( hit === undefined ) {
			return false;
		}

		if (
			hit.object.userData.entityType !== 'annotation'
			|| hit.object.userData.clickable !== true
			|| typeof hit.object.userData.annotationId !== 'string'
		) {
			return false;
		}

		const annotation = this.annotationLayer.getAnnotationByObject( hit.object );
		if ( annotation === null ) {
			return false;
		}

		this.handleEngineeringAnnotationSelection( annotation, hit.object );
		return true;

	}

	private handleUndergroundPortalPick(raycaster: THREE.Raycaster): boolean {

		const result = this.undergroundPortal.pick( raycaster );
		if ( result.hitPortal === false ) return false;
		if ( result.sourceObject === null ) return true;
		const placedModel = this.placementSession.getArPlacedModel();
		if ( placedModel === null ) return true;
		const businessObject = this.propertySelection.resolveBusinessObject(
			result.sourceObject,
			placedModel,
			this.pipesByName
		);
		const businessName = typeof businessObject.userData.__businessName === 'string'
			? businessObject.userData.__businessName
			: businessObject.name;
		const properties = this.pipesByName.get( businessName ) ?? null;
		this.propertySelection.selectBusinessObject( businessObject, properties, result.sourceObject );
		this.showCanvasModelPropertyPanel( businessObject, properties );
		this.undergroundPortal.markDirty();
		this.setStatus( `已选择 ${businessName || '模型构件'}。` );
		return true;

	}

	private logGroundAwareArAudit(config: DemoModelConfig): void {

		if ( this.groundAwareArAuditLogged ) {
			return;
		}
		this.groundAwareArAuditLogged = true;

		arInfo( 'GroundAwareArAudit', {
			currentModelInstanceConfigEntry: config.modelInstances.map( ( instance ) => ( {
				id: instance.id,
				groundRelation: instance.verticalPlacement.groundRelation,
				referencePlane: instance.verticalPlacement.referencePlane,
				belowGroundMode: instance.display.belowGroundMode
			} ) ),
			currentSingleModelCompatibilityEntry: config.undergroundPlacement?.enabled === true ? 'legacy undergroundPlacement mapped to modelInstances[0].verticalPlacement' : 'single model maps to above-ground default',
			currentModelToEnuResolver: 'solveEngineeringRegistration -> solveGroundPlaneRigidTransform',
			currentEngineeringMatrixFormula: 'engineeringMatrix = arFromEnu * modelToEnu',
			currentUndergroundTargetDerivation: 'underground uses RTK surface control point up - coverDepthMeters - normalized model height; above-ground and absolute-engineering do not subtract height',
			currentNormalizedBoundsResolver: 'readPlaceableTemplateReport(finalSize); bbox-y uses normalized finalSize.y',
			currentModelInstanceManager: 'single runtime instance with normalized modelInstances config; multi-loader not yet split',
			currentSceneModelRoots: {
				modelRoot: '__ar-model-anchor',
				placementAnchor: '__ar-placement-anchor'
			},
			currentCanvasPropertyPanelEntry: 'annotationLabelsController.setDetail(CanvasTexture Sprite)',
			currentAnnotationLayerEntry: 'AnnotationLayer.setAnnotations',
			currentDepthProvider: 'RealDepthProvider',
			currentPortalImplementation: 'UndergroundTopPortal with footprint corners, orthographic render target, and CPU depth foreground occlusion',
			currentLegacyVisualOffsetReferences: 'visualMatrix remains snapshot/debug name only; no visualOffsetY/buriedDepthMeters positioning path',
			migrationRisks: [ 'Current runtime still places one model template' ]
		} );

	}

	private handleEngineeringAnnotationSelection(
		annotation: EngineeringAnnotation,
		object: THREE.Object3D
	): void {

		this.propertySelection.clearSelection();
		this.undergroundPortal.markDirty();
		this.annotationLayer.setSelected( annotation.id );
		this.store.patch( {
			selectedAnnotationId: annotation.id,
			annotationDetail: this.createEngineeringAnnotationDetailState( annotation )
		} );
		this.annotationLabelsController.setDetail( null );
		arInfo( 'AnnotationPicked', {
			annotationId: annotation.id,
			title: annotation.title,
			severity: annotation.severity,
			objectKind: object.userData.kind ?? object.type
		} );
		this.setStatus( `已选择业务标识：${annotation.title}` );
		this.emit();

	}

	private createEngineeringAnnotationDetailState(annotation: EngineeringAnnotation): AnnotationDetailState {

		return {
			visible: true,
			title: annotation.title,
			subtitle: `${annotation.type} / ${annotation.severity}`,
			fields: [
				{ label: '类型', value: annotation.type },
				{ label: '等级', value: annotation.severity },
				{ label: '状态', value: annotation.status ?? '-' },
				{ label: '来源', value: annotation.source },
				{ label: '说明', value: annotation.description ?? '-' },
				...Object.entries( annotation.properties ).map( ( [ label, value ] ) => ( {
					label,
					value: value === null ? '-' : String( value )
				} ) )
			]
		};

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

function roundMeters(value: number): number {

	return Number( value.toFixed( 3 ) );

}

function horizontalDistanceXZ(a: THREE.Vector3, b: THREE.Vector3): number {

	return Math.hypot( a.x - b.x, a.z - b.z );

}

function isDescendantOf(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {

	let current: THREE.Object3D | null = object;
	while ( current !== null ) {
		if ( current === ancestor ) {
			return true;
		}
		current = current.parent;
	}
	return false;

}

function formatParentChain(object: THREE.Object3D): string[] {

	const names: string[] = [];
	let current: THREE.Object3D | null = object;
	while ( current !== null ) {
		names.push( current.name || current.type );
		current = current.parent;
	}
	return names;

}

function matrixChanged(initial: THREE.Matrix4 | null, current: THREE.Matrix4): boolean {

	if ( initial === null ) {
		return false;
	}
	const a = initial.elements;
	const b = current.elements;
	for ( let index = 0; index < 16; index += 1 ) {
		if ( Math.abs( a[ index ] - b[ index ] ) > 0.0001 ) {
			return true;
		}
	}
	return false;

}

function matrixTranslationDistance(
	initial: THREE.Matrix4 | null | undefined,
	current: THREE.Matrix4
): number {

	if ( initial === null || initial === undefined ) {
		return 0;
	}
	return roundMeters(
		new THREE.Vector3().setFromMatrixPosition( initial )
			.distanceTo( new THREE.Vector3().setFromMatrixPosition( current ) )
	);

}

function projectWorldToScreen(
	world: THREE.Vector3,
	camera: THREE.Camera,
	canvas: HTMLCanvasElement
): DebugScreenPoint {

	const projectionCamera = camera instanceof THREE.ArrayCamera && camera.cameras.length > 0
		? camera.cameras[ 0 ]
		: camera;
	const ndc = world.clone().project( projectionCamera );
	const rect = canvas.getBoundingClientRect();
	return {
		x: ( ndc.x + 1 ) * rect.width / 2,
		y: ( 1 - ndc.y ) * rect.height / 2,
		visible: ndc.z >= -1 && ndc.z <= 1 && Math.abs( ndc.x ) <= 1 && Math.abs( ndc.y ) <= 1
	};

}

function screenPointDistance(a: DebugScreenPoint, b: DebugScreenPoint): number {

	return Math.hypot( a.x - b.x, a.y - b.y );

}

function roundPixels(value: number): number {

	return Number( value.toFixed( 1 ) );

}

function roundMatrixElements(matrix: THREE.Matrix4): number[] {

	return matrix.toArray().map( ( value ) => Number( value.toFixed( 6 ) ) );

}

function resolveParallaxStatus(
	state: ModelPlacementDebugState
): NonNullable<ModelPlacementDebugState['parallaxStatus']> {

	if ( state.arFromEnuMatrixChanged === true || ( state.undergroundMinusEngineeringXZ ?? 0 ) > 0.1 ) {
		return 'matrix-space-error';
	}
	if (
		( state.placedModelDeltaXZ ?? state.modelWorldDeltaXZ ?? 0 ) > 0.1
		|| ( state.undergroundExpectedWorldDeltaXZ ?? 0 ) > 0.1
	) {
		return 'real-world-movement';
	}
	if (
		( state.placedModelDeltaXZ ?? state.modelWorldDeltaXZ ?? 0 ) < 0.05
		&& ( state.undergroundExpectedWorldDeltaXZ ?? 0 ) < 0.05
		&& ( state.undergroundMinusEngineeringXZ ?? 0 ) < 0.05
		&& ( state.yellowToUndergroundScreenDistanceDeltaPx ?? 0 ) > 5
	) {
		return 'likely-parallax';
	}
	return 'unknown';

}

function resolveWorldLockStatus(
	cameraMovedDistance: number,
	modelWorldDeltaXZ: number
): {
	isWorldLocked: boolean | null;
	status: NonNullable<ModelPlacementDebugState['worldLockStatus']>;
} {

	if ( cameraMovedDistance < 0.3 ) {
		return { isWorldLocked: null, status: 'unknown' };
	}
	if ( modelWorldDeltaXZ < 0.05 ) {
		return { isWorldLocked: true, status: 'normal' };
	}
	if ( modelWorldDeltaXZ > 0.1 ) {
		return { isWorldLocked: false, status: 'error' };
	}
	return { isWorldLocked: false, status: 'warning' };

}

function computePlacementErrorDebug(args: {
	registrationSolution: EngineeringRegistrationSolution;
	arFromEnuSolution: ArFromEnuSolution;
	engineeringMatrix: THREE.Matrix4;
}): Pick<
	ModelPlacementDebugState,
	| 'engineeringHorizontalRms'
	| 'engineeringVerticalMax'
	| 'surfaceProjectionHorizontalRms'
	| 'bottomDepthErrorMax'
> {

	const engineeringHorizontalErrors: number[] = [];
	const engineeringVerticalErrors: number[] = [];
	const surfaceProjectionErrors: number[] = [];
	const bottomDepthErrors: number[] = [];
	for ( const point of args.registrationSolution.controlPoints.slice( 0, 4 ) ) {
		const expectedAr = point.worldEnu.clone().applyMatrix4( args.arFromEnuSolution.matrix );
		const engineeringActualAr = point.modelLocal.clone().applyMatrix4( args.engineeringMatrix );
		engineeringHorizontalErrors.push( horizontalDistanceXZ( expectedAr, engineeringActualAr ) );
		engineeringVerticalErrors.push( Math.abs( expectedAr.y - engineeringActualAr.y ) );
		surfaceProjectionErrors.push( horizontalDistanceXZ( expectedAr, engineeringActualAr ) );
		bottomDepthErrors.push( Math.abs( expectedAr.y - engineeringActualAr.y ) );
	}
	return {
		engineeringHorizontalRms: roundMeters( computeRms( engineeringHorizontalErrors ) ),
		engineeringVerticalMax: roundMeters( Math.max( ...engineeringVerticalErrors, 0 ) ),
		surfaceProjectionHorizontalRms: roundMeters( computeRms( surfaceProjectionErrors ) ),
		bottomDepthErrorMax: roundMeters( Math.max( ...bottomDepthErrors, 0 ) )
	};

}

function formatControlPointElevations(points: EngineeringControlPoint[]): string {

	return points
		.slice( 0, 4 )
		.map( ( point ) => `${point.id}:${point.worldEnu.z.toFixed( 3 )}m` )
		.join( ' / ' );

}

function createModelPlacementDebugConclusion(state: ModelPlacementDebugState): string {

	if ( state.unexpectedArModelAnchorParent === true || state.isArModelAnchorChildOfPlacementAnchor === true ) {
		return '运行时 anchor parent chain 与 scene.ts 不一致，请先确认没有旧部署或运行时 reparent。';
	}
	if ( state.isArModelAnchorChildOfCamera === true || state.isArModelAnchorChildOfReticle === true ) {
		return '模型锚点挂载错误，疑似跟随相机或 reticle。';
	}
	if ( state.arFromEnuMatrixChanged === true ) {
		return 'arFromEnu 在放置后发生变化，可能导致模型重定位。';
	}
	if (
		state.isPlacedModelChildOfPlacementAnchor === true
		&& ( state.placementAnchorDeltaXZ ?? state.arPlacementAnchorWorldDeltaXZ ?? 0 ) > 0.1
	) {
		return '模型受到移动 placementAnchor 影响。';
	}
	if ( ( state.engineeringPlacementCallCount ?? 0 ) > 1 || ( state.replacedModelCount ?? 0 ) > 0 ) {
		return '模型被重复放置，请检查工程放置入口。';
	}
	if (
		( state.cameraMovedDistance ?? 0 ) > 0.5
		&& ( state.cameraToModelDistanceDelta ?? 0 ) < 0.05
		&& ( state.modelWorldDeltaXZ ?? 0 ) > 0.05
	) {
		return '模型与相机距离几乎不变，但模型世界坐标在变化，疑似存在跟随相机的挂载或重算。';
	}
	if (
		( state.placedModelDeltaXZ ?? state.modelWorldDeltaXZ ?? 0 ) > 0.1
		|| ( state.undergroundExpectedWorldDeltaXZ ?? 0 ) > 0.1
	) {
		return '模型或地下工程点在 AR 世界中发生真实移动。';
	}
	if ( state.parallaxStatus === 'likely-parallax' ) {
		return '模型和地下工程点的世界坐标固定；当前屏幕相对位移来自不同深度平面的视差。';
	}
	if ( state.worldLockStatus === 'error' ) {
		return '模型疑似跟随相机移动，请检查 anchor parent。';
	}
	if ( typeof state.engineeringHorizontalRms === 'number' && state.engineeringHorizontalRms > 0.3 ) {
		return '工程水平误差较大，请检查 modelLocal / placement 矩阵。';
	}
	if ( state.worldLockStatus === 'unknown' ) {
		return '请移动手机超过 0.3m 后再判断 world-lock。';
	}
	if (
		( state.modelWorldDeltaXZ ?? 0 ) < 0.05
		&& ( state.arModelAnchorWorldDeltaXZ ?? 0 ) < 0.05
		&& state.isPlacedModelChildOfPlacementAnchor !== true
	) {
		return '模型没有跟随手机；当前更像地下模型下沉后的视觉投影效果。';
	}
	if ( state.modelHeightSource === 'bbox-y' || state.modelHeightSource === 'y' || state.modelHeightSource === 'shortest-edge' ) {
		return '模型已固定，当前使用模型高度作为下沉深度。';
	}
	if ( state.modelHeightSource === 'override' ) {
		return '模型已固定，当前使用配置模型高度作为下沉深度。';
	}
	return '模型已固定，当前使用地下工程矩阵。';

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

function resolveXrayOpacityPercent(value: number | undefined): number {

	if ( typeof value !== 'number' || Number.isFinite( value ) === false ) {
		return 50;
	}
	const percent = value <= 1 ? value * 100 : value;
	return Math.round( THREE.MathUtils.clamp( percent, 0, 100 ) );

}

function formatUndergroundDisplayText(config: DemoModelConfig, modelTemplate: THREE.Group): string {

	if ( config.undergroundPlacement?.enabled !== true ) {
		return '-';
	}

	const modeText = config.undergroundDisplay?.defaultMode === 'x-ray'
		? 'X-Ray'
		: config.undergroundDisplay?.defaultMode ?? 'underground';
	const axis = config.undergroundPlacement.modelHeightAxis ?? 'bbox-y';
	const height = typeof config.undergroundPlacement.modelHeightMetersOverride === 'number'
		? config.undergroundPlacement.modelHeightMetersOverride
		: resolveDisplayModelHeightMeters( modelTemplate, axis );
	const coverDepth = config.undergroundPlacement.coverDepthMeters ?? 0;
	return `地下显示：${modeText}；定位方式：RTK 地表高程；工程下沉：${( height + coverDepth ).toFixed( 2 )} m。`;

}

function resolveDisplayModelHeightMeters(
	modelTemplate: THREE.Group,
	axis: 'bbox-y' | 'y' | 'shortest-edge'
): number {

	const report = readPlaceableTemplateReport( modelTemplate );
	if ( report !== null && axis !== 'bbox-y' ) {
		const size = report.finalSize;
		return axis === 'shortest-edge' ? Math.min( size.x, size.y, size.z ) : size.y;
	}
	const size = new THREE.Box3().setFromObject( modelTemplate ).getSize( new THREE.Vector3() );
	return axis === 'shortest-edge' ? Math.min( size.x, size.y, size.z ) : size.y;

}

function computeRms(errors: number[]): number {

	if ( errors.length === 0 ) {
		return 0;
	}
	return Math.sqrt( errors.reduce( ( total, error ) => total + error * error, 0 ) / errors.length );

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

function findBestControlPointLengthMatch(controlPoints: EngineeringControlPoint[]): {
	currentMaxEdgeDelta: number;
	bestMaxEdgeDelta: number;
	bestRmsEdgeDelta: number;
	suggestedWorldPointIds: string[];
	suggestedWorldEdgeLengths: number[];
	correspondenceLikelyWrong: boolean;
	geometryLikelyWrong: boolean;
} {

	const modelLocalEdgeLengths = computeSideLengths( controlPoints.map( ( point ) => point.modelLocal ) );
	const currentWorldEdgeLengths = computeSideLengths( controlPoints.map( ( point ) => point.worldEnu ) );
	let bestMaxEdgeDelta = maxPairDelta( modelLocalEdgeLengths, currentWorldEdgeLengths );
	let bestRmsEdgeDelta = rmsPairDelta( modelLocalEdgeLengths, currentWorldEdgeLengths );
	let suggestedWorldPointIds = controlPoints.map( ( point ) => point.id );
	let suggestedWorldEdgeLengths = currentWorldEdgeLengths;

	for ( const order of permutations( [ 0, 1, 2, 3 ] ) ) {
		const orderedWorldPoints = order.map( ( index ) => controlPoints[ index ].worldEnu );
		const edgeLengths = computeSideLengths( orderedWorldPoints );
		const maxDelta = maxPairDelta( modelLocalEdgeLengths, edgeLengths );
		if ( maxDelta < bestMaxEdgeDelta ) {
			bestMaxEdgeDelta = maxDelta;
			bestRmsEdgeDelta = rmsPairDelta( modelLocalEdgeLengths, edgeLengths );
			suggestedWorldPointIds = order.map( ( index ) => controlPoints[ index ].id );
			suggestedWorldEdgeLengths = edgeLengths;
		}
	}

	return {
		currentMaxEdgeDelta: Number( maxPairDelta( modelLocalEdgeLengths, currentWorldEdgeLengths ).toFixed( 6 ) ),
		bestMaxEdgeDelta: Number( bestMaxEdgeDelta.toFixed( 6 ) ),
		bestRmsEdgeDelta: Number( bestRmsEdgeDelta.toFixed( 6 ) ),
		suggestedWorldPointIds,
		suggestedWorldEdgeLengths: suggestedWorldEdgeLengths.map( ( value ) => Number( value.toFixed( 4 ) ) ),
		correspondenceLikelyWrong: bestMaxEdgeDelta <= 0.2,
		geometryLikelyWrong: bestMaxEdgeDelta > 0.5
	};

}

function permutations(values: number[]): number[][] {

	if ( values.length <= 1 ) {
		return [ values ];
	}
	return values.flatMap( ( value, index ) => permutations( [
		...values.slice( 0, index ),
		...values.slice( index + 1 )
	] ).map( ( tail ) => [ value, ...tail ] ) );

}

function rmsPairDelta(left: number[], right: number[]): number {

	if ( left.length === 0 ) {
		return 0;
	}
	const total = left.reduce(
		(sum, value, index) => sum + Math.pow( value - ( right[ index ] ?? value ), 2 ),
		0
	);
	return Math.sqrt( total / left.length );

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

function createGroundPlaneYawConventionPayload(arFromEnuSolution: ArFromEnuSolution): Record<string, unknown> {

	const mappedOrigin = new THREE.Vector3( 0, 0, 0 ).applyMatrix4( arFromEnuSolution.matrix );
	const mappedEast = new THREE.Vector3( 1, 0, 0 ).applyMatrix4( arFromEnuSolution.matrix ).sub( mappedOrigin );
	const mappedNorth = new THREE.Vector3( 0, 1, 0 ).applyMatrix4( arFromEnuSolution.matrix ).sub( mappedOrigin );
	return {
		yawDeg: Number( arFromEnuSolution.headingDeg.toFixed( 6 ) ),
		rotationMatrix2D: {
			eastToArX: Number( mappedEast.x.toFixed( 6 ) ),
			eastToArMinusZ: Number( ( - mappedEast.z ).toFixed( 6 ) ),
			northToArX: Number( mappedNorth.x.toFixed( 6 ) ),
			northToArMinusZ: Number( ( - mappedNorth.z ).toFixed( 6 ) )
		},
		sourceBasisEastMappedToAr: vector3ToRoundedObject( mappedEast ),
		sourceBasisNorthMappedToAr: vector3ToRoundedObject( mappedNorth ),
		headingOfMappedEastInAr: Number( headingFromArDelta( mappedEast ).toFixed( 3 ) ),
		headingOfMappedNorthInAr: Number( headingFromArDelta( mappedNorth ).toFixed( 3 ) ),
		note: 'With ar-x-minus-z convention, mapped heading = ENU heading - yawDeg.'
	};

}

function headingFromArDelta(delta: THREE.Vector3): number {

	return normalizeSignedDegrees( radToDeg( Math.atan2( delta.x, - delta.z ) ) );

}

function headingFromModelLocalPoints(points: THREE.Vector3[]): number {

	if ( points.length < 2 ) {
		return 0;
	}
	const edge = points[ 1 ].clone().sub( points[ 0 ] );
	return normalizeSignedDegrees( radToDeg( Math.atan2( edge.x, - edge.z ) ) );

}

function signedArea2D(points: THREE.Vector3[], plane: 'xy' | 'xz'): number {

	if ( points.length < 3 ) {
		return 0;
	}
	let area = 0;
	for ( let index = 0; index < points.length; index += 1 ) {
		const current = points[ index ];
		const next = points[ ( index + 1 ) % points.length ];
		const cx = current.x;
		const cy = plane === 'xy' ? current.y : current.z;
		const nx = next.x;
		const ny = plane === 'xy' ? next.y : next.z;
		area += cx * ny - nx * cy;
	}
	return area / 2;

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

function createCanvasPanelSprite(args: {
	title: string;
	subtitle: string;
	body?: string;
	width: number;
	color: string;
}): THREE.Sprite {

	const canvas = document.createElement( 'canvas' );
	canvas.width = 768;
	canvas.height = args.body === undefined ? 256 : 448;
	const context = canvas.getContext( '2d' );
	if ( context !== null ) {
		context.clearRect( 0, 0, canvas.width, canvas.height );
		context.fillStyle = 'rgba(12, 18, 32, 0.88)';
		context.fillRect( 0, 0, canvas.width, canvas.height );
		context.strokeStyle = args.color;
		context.lineWidth = 8;
		context.strokeRect( 12, 12, canvas.width - 24, canvas.height - 24 );
		context.fillStyle = '#ffffff';
		context.font = 'bold 72px "Microsoft YaHei", sans-serif';
		context.fillText( args.title, 44, 104 );
		context.fillStyle = 'rgba(226, 232, 240, 0.96)';
		context.font = '42px "Microsoft YaHei", sans-serif';
		context.fillText( args.subtitle, 44, 170 );
		if ( args.body !== undefined ) {
			context.fillStyle = 'rgba(250, 204, 21, 0.96)';
			context.font = '38px "Microsoft YaHei", sans-serif';
			wrapCanvasText( context, args.body, 44, 250, canvas.width - 88, 52, 3 );
		}
	}
	const texture = new THREE.CanvasTexture( canvas );
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.minFilter = THREE.LinearFilter;
	texture.magFilter = THREE.LinearFilter;
	const sprite = new THREE.Sprite( new THREE.SpriteMaterial( {
		map: texture,
		depthTest: false,
		transparent: true,
		toneMapped: false
	} ) );
	sprite.renderOrder = 260;
	sprite.raycast = THREE.Sprite.prototype.raycast;
	sprite.scale.set( args.width, args.width / ( canvas.width / canvas.height ), 1 );
	return sprite;

}

function wrapCanvasText(
	context: CanvasRenderingContext2D,
	text: string,
	x: number,
	y: number,
	maxWidth: number,
	lineHeight: number,
	maxLines: number
): void {

	let line = '';
	let lineCount = 0;
	for ( const char of text ) {
		const nextLine = line + char;
		if ( context.measureText( nextLine ).width > maxWidth && line.length > 0 ) {
			context.fillText( line, x, y + lineCount * lineHeight );
			line = char;
			lineCount += 1;
			if ( lineCount >= maxLines ) {
				return;
			}
			continue;
		}
		line = nextLine;
	}
	if ( line.length > 0 && lineCount < maxLines ) {
		context.fillText( line, x, y + lineCount * lineHeight );
	}

}

function markSiteOriginReferenceObject(object: THREE.Object3D): void {

	object.userData.__siteOriginReference = true;
	object.userData.__excludeFromLayerIndex = true;
	object.userData.__displayModeHelper = true;

}

function hasSiteOriginReferenceObject(object: THREE.Object3D): boolean {

	let current: THREE.Object3D | null = object;
	while ( current !== null ) {
		if ( current.userData.__siteOriginReference === true ) {
			return true;
		}
		current = current.parent;
	}
	return false;

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












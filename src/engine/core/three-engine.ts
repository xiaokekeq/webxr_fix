import { arWarn, arError } from '@/engine/debug/ar-logger.js';
import * as THREE from 'three';
import type { PipeRecord } from '@/models/types/pipe-record.js';
import { createPointerSelectionSession } from '@/engine/interaction/pointer-selection.js';
import { createPropertySelectionController } from '@/engine/interaction/property-selection.js';
import { createModelSession } from '@/engine/model/session.js';
import type { LoadedModelRuntimeBundle } from '@/engine/model/runtime.js';
import {
	createPlacementSession
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
	createDefaultMarkerCalibrationState,
	createDefaultRegistrationMetricsState,
	createDefaultRegistrationChainDebugState,
	createDefaultModelScaleSummaryState,
	createDefaultSiteCalibrationBaselineState,
	createDefaultEngineeringConfigStatusState,
	createDefaultModelRuntimeLoadStatus,
	createDefaultTargetGuidanceState,
	createRegistrationStore,
	type AnnotationDetailState,
	type InspectionPlacementSource,
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
	type MarkerLocalizationResult,
	type MarkerLocalizationSolution,
	type MarkerPoseInEnu
} from '@/localization/marker/marker-localization.js';
import { createLayerVisibilityController } from '@/engine/visualization/layer-visibility.js';
import { MaterialStateRuntime } from '@/engine/visualization/material-state-runtime.js';
import { createArSectionCutController } from '@/engine/visualization/ar-section-cut.js';
import { DEFAULT_UNDERGROUND_DISPLAY_STATE, type UndergroundInspectionTool, type UndergroundMaterialMode } from '@/engine/visualization/underground-display-state.js';
import { VisualizationStateRuntime } from '@/engine/visualization/visualization-state-runtime.js';
import { TexturedEnclosureShell } from '@/engine/visualization/textured-enclosure-shell.js';
import { mapHiddenLayerCountToValue, mapLayerPeelingValue } from '@/engine/visualization/adjustment-value-mappers.js';
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
import { getSectionCutPlaneModeLabel } from '@/features/ar/types/display-modes.js';
import { InspectionMarkerWorkflow } from '@/engine/inspection/inspection-marker-workflow.js';
import { MarkerCalibrationRuntime } from '@/engine/inspection/marker-calibration-runtime.js';
import type { MarkerSolutionApplyDiagnostics, MarkerSolutionApplyResult, MarkerSolutionApplyStage } from '@/engine/inspection/marker-solution-apply-result.js';
import { PlacementWorkflow } from '@/engine/placement/placement-workflow.js';
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
import { LocalizationDebugLayer } from '@/engine/debug/localization-debug-layer.js';

const MODEL_CONTROL_POINT_PLACEMENT_RMS_LIMIT_METERS = 0.2;
const tempViewerArPosition = new THREE.Vector3();
const tempMatrix = new THREE.Matrix4();
const tempQuaternion = new THREE.Quaternion();

type EngineeringPlacementBlockReason =
	| 'model-config-missing'
	| 'model-template-missing'
	| 'model-runtime-loading'
	| 'model-runtime-load-failed'
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

interface MarkerSolutionApplyMetadata {
	markerId: string;
	markerConfigId: string;
	calibrationModelId: string | null;
	calibrationSiteId: string | null;
	calibrationMarkerId: string;
	source?: 'marker-calibration';
	placeModel?: boolean;
	capturedCornersAr?: THREE.Vector3[];
}

export interface ThreeEngineHosts extends SceneHostRuntimeHosts {}

export interface ThreeEngineSnapshot extends RegistrationStoreState {
	hasSelection: boolean;
	currentStatus: string;
}

export type ModelPlacementResult =
	| { ok: true; placedModelUuid: string }
	| { ok: false; stage: 'runtime' | 'registration' | 'marker' | 'placement'; reason: string; message: string };

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
		...DEFAULT_UNDERGROUND_DISPLAY_STATE,
		transparentXrayValue: 0,
		layerPeelingValue: 100,
		sectionCutValue: 100,
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
		siteCalibrationBaseline: createDefaultSiteCalibrationBaselineState(),
		engineeringConfigStatus: createDefaultEngineeringConfigStatusState(),
		modelRuntimeLoad: createDefaultModelRuntimeLoadStatus(),
		markerCalibration: createDefaultMarkerCalibrationState(),
		placementSummary: {
			positionText: '-',
			quaternionText: '-',
			scaleText: '-'
		},
		targetGuidance: createDefaultTargetGuidanceState(),
	annotationDetail: createDefaultAnnotationDetailState(),
	registrationStatusDetail: '状态：等待识别平面',
	runtimeStatus: '正在准备 AR 运行环境'
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
	private readonly localizationDebugLayer = new LocalizationDebugLayer();
	private readonly materialStateRuntime = new MaterialStateRuntime();
	private readonly enclosureShell = new TexturedEnclosureShell();
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
	private markerCalibrationCapturedCornersAr: THREE.Vector3[] = [];
	private activeSiteCalibrationBaseline: SiteCalibrationBaseline | null = null;
	private activeMarkerLocalizationResult: MarkerLocalizationResult | null = null;
	private markerCorrectionFallbackArFromEnuSolution: ArFromEnuSolution | null = null;
	private currentArSessionContext: ArSessionContext | null = null;
	private currentArSessionId: string | null = null;
	private arSessionGeneration = 0;
	private modelRuntimeGeneration = 0;
	private lastMarkerSolutionApplyResult: MarkerSolutionApplyResult | null = null;
	private readonly realDepthProvider = new RealDepthProvider();
	private readonly frameTaskErrorCounts = new Map<string, number>();
	private readonly frameTaskLastErrorLogAt = new Map<string, number>();
	private workflowMode: ArWorkflowMode = 'ar-inspection';
	private arSessionEndPending = false;
	private lastAnnotationLabelsSignature = '';
	private siteBaselineLoadRequestId = 0;
	private pipesByName = new Map<string, PipeRecord>();
	private lastAppliedMarkerSolutionId: string | null = null;
	private autoPlacementInFlightSolutionId: string | null = null;
	private readonly handleWebglContextLost = ( event: Event ) => {
		( event as WebGLContextEvent ).preventDefault();
		arError( '[WebGLContextLost]', { xrPresenting: this.sceneBundle.renderer.xr.isPresenting } );
	};
	constructor() {

		this.store = createRegistrationStore( createInitialState() );
		this.xrButtonWrap = document.createElement( 'div' );
		this.xrButtonWrap.className = 'xr-button-wrap';
		this.sceneBundle = createARScene( document.createElement( 'div' ) );
		this.sceneBundle.scene.add( this.localizationDebugLayer.root );
		this.sceneBundle.scene.add( this.annotationLayer.group );

		const statusRuntime = createStatusRuntime( {
			store: this.store,
			updateStatusText: ( message ) => {
				this.currentStatus = message;
			}
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

		this.sectionCutController = createArSectionCutController( this.sceneBundle.renderer );
		this.annotationLabelsController = createArAnnotationLabelController( {
			canvas: this.sceneBundle.renderer.domElement
		} );
		this.visualizationStateRuntime = new VisualizationStateRuntime( {
			store: this.store,
			placementSession: this.placementSession,
			layerVisibility: this.layerVisibility,
			materialStateRuntime: this.materialStateRuntime,
			sectionCutController: this.sectionCutController,
			enclosureShell: this.enclosureShell,
			getUndergroundModelRoot: () => this.placementSession.getArPlacedModel(),
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
			getSiteId: () => this.demoModelConfig?.siteId ?? this.currentArSessionContext?.siteId ?? null,
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
			getCurrentSessionId: () => this.currentArSessionId,
			isPresenting: () => this.sceneBundle.renderer.xr.isPresenting,
			hasGroundHit: () => this.xrRuntime.getHitTestController().hasGroundHit(),
			getHitPosition: ( target ) => this.xrRuntime.getHitTestController().getHitPosition( target ),
			getDemoModelConfig: () => this.getSessionSiteConfig(),
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
			getLastMarkerSolutionApplyResult: () => this.lastMarkerSolutionApplyResult,
			clearLastMarkerSolutionApplyResult: () => { this.lastMarkerSolutionApplyResult = null; },
			getLifecycleGenerations: () => ( { arSessionGeneration: this.arSessionGeneration, modelRuntimeGeneration: this.modelRuntimeGeneration } ),
			setStatus: ( message ) => {
				this.setStatus( message );
			}
		} );

		this.registrationStateRuntime = new RegistrationStateRuntime( {
			store: this.store,
			getWorkflowMode: () => this.workflowMode,
			getCurrentSessionId: () => this.currentArSessionId,
			getRepositoryDataSource: () => repositories.dataSource,
			getSessionSiteConfig: () => this.getSessionSiteConfig(),
			getActiveRuntimeConfig: () => this.getActiveRuntimeConfig(),
			getActiveModelTemplate: () => this.getActiveModelTemplate(),
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
			getSiteId: () => this.demoModelConfig?.siteId ?? this.currentArSessionContext?.siteId ?? null,
			getCurrentSessionId: () => this.currentArSessionId,
			getInspectionTargetId: () => this.activeMarkerLocalizationResult?.markerId ?? this.inspectionMarkerWorkflow.getStableTargetId(),
			getInspectionStableFrameCount: () => this.inspectionMarkerWorkflow.getStableFrameCount(),
			getPreferredLocalizationOverride: () => this.getPreferredFormalLocalizationOverride(),
			getModelTemplate: () => this.modelTemplate,
			getRegistrationSolution: () => this.registrationSolution,
			getRuntimeLoadStatus: () => this.store.getState().modelRuntimeLoad,
			getHitTestController: () => this.xrRuntime.getHitTestController(),
			getModelOrientationTarget: () => this.modelOrientation,
				onBeforePlacementRequest: () => {
					this.propertySelection.clearSelection();
					this.pointerSelection.suppressSelectionFor( 1200 );
			},
			onPlacementBaseResolved: () => {},
			applyModelLayerVisibility: () => {
				this.applyModelLayerVisibility( 'auto-placement' );
			},
			syncRegistrationChainDebug: () => {
				this.syncRegistrationChainDebug();
			},
			syncLocalizationDebug: () => {
				this.syncLocalizationDebug();
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
				this.visualizationStateRuntime.syncVisualizationState();
				this.applyModelLayerVisibility( 'selection-cleared' );
			},
			handlePreSelectionRaycast: ( selection ) => {
				if ( this.annotationLabelsController.hitDetailPanel( selection.raycaster ) ) {
					return true;
				}

				if ( this.handleBusinessAnnotationPick( selection.raycaster ) ) {
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
			resetPlacement: () => {
				this.placementSession.resetPlacement();
				this.syncArSessionPhase();
				this.emit();
			},
			onRuntimeReset: ( nextModelId ) => {
				const preserveCurrentArLocalization = this.canPreserveMarkerLocalizationForRuntimeRefresh( nextModelId );
				this.modelRuntimeGeneration += 1;
				const calibrationCancelled = this.markerCalibrationRuntime.cancelForModelRuntimeChange();
				this.enclosureShell.dispose();
				this.modelTemplate = null;
				this.demoModelConfig = null;
				this.registrationSolution = null;
						this.resolvedMarkerPosesInEnu = [];
				if ( preserveCurrentArLocalization === false ) {
					this.activeSiteCalibrationBaseline = null;
					this.currentArSessionContext = null;
					this.siteBaselineLoadRequestId += 1;
					this.resetMarkerLocalizationCorrection();
					this.markerCalibrationRuntime.resetRuntimeState();
				}
				this.pipesByName = new Map<string, PipeRecord>();
				this.layerVisibility.reset();
				this.visualizationStateRuntime.reset();
				this.lastAnnotationLabelsSignature = '';
				this.annotationLabelsController.clear();
				this.annotationLayer.setAnnotations( [] );
				this.store.patch( {
					layerNames: STATIC_LAYER_NAMES,
					modelLayers: [],
					selectedAnnotationId: null,
					annotationDetail: createDefaultAnnotationDetailState(),
					siteCalibrationBaseline: createDefaultSiteCalibrationBaselineState(),
					engineeringConfigStatus: createDefaultEngineeringConfigStatusState()
				} );
				this.markerCalibrationRuntime.syncState();
				this.syncRegistrationChainDebug();
			},
			onRuntimeBundleLoaded: ( bundle ) => {
				this.activateCoreModelRuntime( bundle );
			},
			onRuntimeBundleReady: ( bundle, modelLoadRequestId ) => {
				this.initializeOptionalModelVisuals( bundle, modelLoadRequestId );
				this.tryAutoPlaceAppliedMarkerSolution();
			},
			onRuntimeLoadFailed: ( error ) => {
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
				this.safeFrameTask( 'marker-hints', () => {
					this.inspectionMarkerWorkflow.syncHints();
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
			}
		} );

		this.sceneBundle.renderer.setAnimationLoop( this.xrRuntime.renderFrame );
		this.sceneBundle.renderer.domElement.addEventListener( 'pointerdown', this.pointerSelection.handlePointerDown );
		this.sceneBundle.renderer.domElement.addEventListener( 'pointerup', this.pointerSelection.handlePointerUp );
		this.sceneBundle.renderer.domElement.addEventListener( 'webglcontextlost', this.handleWebglContextLost );
		window.addEventListener( 'pointerdown', this.handleGlobalArPointerDown, true );
		window.addEventListener( 'pointerup', this.handleGlobalArPointerUp, true );
		window.addEventListener( 'resize', this.handleWindowResize );
		this.sceneBundle.renderer.xr.addEventListener( 'sessionstart', this.bindArSelectionSession );
		this.sceneBundle.renderer.xr.addEventListener( 'sessionend', this.unbindArSelectionSession );

		this.store.subscribe( () => {
			this.syncVisualizationState();
			this.syncAnnotationLabels();
			this.emit();
		} );

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

	private activateCoreModelRuntime(bundle: LoadedModelRuntimeBundle): void {

		this.pipesByName = bundle.pipesByName;
		this.demoModelConfig = bundle.demoModelConfig;
		this.modelTemplate = bundle.modelTemplate;
		this.registrationSolution = bundle.registrationSolution;
		this.enclosureShell.prepareModel( bundle.modelTemplate, bundle.demoModelConfig.enclosureShell );
		this.resolvedMarkerPosesInEnu = this.resolveConfiguredMarkerPoses( bundle.demoModelConfig );
		this.annotationLayer.setAnnotations(
			bundle.demoModelConfig.annotations,
			bundle.demoModelConfig.annotationStyleRules
		);
		this.rebuildModelLayers();
		this.syncArSessionContext();
		this.refreshSiteCalibrationBaselineState( { silentStatus: true } );
		this.markerCalibrationRuntime.syncState();
		this.syncRegistrationChainDebug();
		this.syncLocalizationDebug();

	}

	private initializeOptionalModelVisuals(bundle: LoadedModelRuntimeBundle, modelLoadRequestId: number): void {

		try {
			this.enclosureShell.rebuildForModel( {
				model: bundle.modelTemplate,
				modelRevision: modelLoadRequestId,
				enclosureShell: bundle.demoModelConfig.enclosureShell
			} );
		} catch {
			this.enclosureShell.dispose();
		}

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
			this.applyModelLayerVisibility( 'initialization' );
			this.syncSceneHost();
		} catch ( error ) {
			arError( 'AR engine initialization failed:', error );
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
		window.removeEventListener( 'pointerdown', this.handleGlobalArPointerDown, true );
		window.removeEventListener( 'pointerup', this.handleGlobalArPointerUp, true );
		window.removeEventListener( 'resize', this.handleWindowResize );
		this.sceneBundle.renderer.xr.removeEventListener( 'sessionstart', this.bindArSelectionSession );
		this.sceneBundle.renderer.xr.removeEventListener( 'sessionend', this.unbindArSelectionSession );
		this.visualizationStateRuntime.restoreVisualizationControllers();
		this.materialStateRuntime.dispose();
		this.sectionCutController.dispose();
		this.enclosureShell.dispose();
		this.annotationLabelsController.dispose();
		this.annotationLayer.dispose();
		this.localizationDebugLayer.dispose();
		this.sceneBundle.renderer.dispose();

	}

	handleArUiInteraction(): void {

		this.pointerSelection.cancelPendingSelection( 1400 );

	}

	closePropertyPanel(): void {

		this.pointerSelection.suppressSelectionFor( 1000 );
		this.propertySelection.clearSelection();
		this.clearAnnotationDetail();
		this.annotationLayer.setSelected( null );
		this.setStatus( '已关闭构件信息面板。' );

	}

	selectModel(modelId: string): void {

		this.modelSession.handleModelSelection( modelId );

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

	setTransparentXrayValue(value: number): void {

		const clampedValue = THREE.MathUtils.clamp( Math.round( value ), 0, 100 );
		if ( this.store.getState().transparentXrayValue === clampedValue ) return;
		this.store.patch( { transparentXrayValue: clampedValue } );

	}

	setLayerPeelingValue(value: number): void {

		const clampedValue = THREE.MathUtils.clamp( Math.round( value ), 0, 100 );
		if ( this.store.getState().layerPeelingValue === clampedValue ) return;
		this.store.patch( { layerPeelingValue: clampedValue } );
		if ( this.store.getState().undergroundInspectionTool === 'layer-peeling' ) {
			this.layerVisibility.setHiddenLayerCount(
				mapLayerPeelingValue( clampedValue, this.layerVisibility.getState().length )
			);
			this.applyModelLayerVisibility( 'layer-peeling-value-changed' );
		}

	}

	setSectionCutValue(value: number): void {

		const clampedValue = THREE.MathUtils.clamp( Math.round( value ), 0, 100 );
		if ( this.store.getState().sectionCutValue === clampedValue ) return;
		this.store.patch( { sectionCutValue: clampedValue } );

	}

	setUndergroundMaterialMode(mode: UndergroundMaterialMode): void {

		if ( this.store.getState().undergroundMaterialMode === mode ) return;
		this.store.patch( { undergroundMaterialMode: mode } );

	}

	setUndergroundInspectionTool(tool: UndergroundInspectionTool): void {

		const state = this.store.getState();
		if ( state.undergroundInspectionTool === tool ) return;
		this.store.patch( { undergroundInspectionTool: tool } );
		this.layerVisibility.setHiddenLayerCount( tool === 'layer-peeling' ? mapLayerPeelingValue( state.layerPeelingValue, this.layerVisibility.getState().length ) : 0 );
		this.applyModelLayerVisibility( 'inspection-tool-changed' );

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
		const validation = validateSiteCalibrationBaselineForStorage( baseline );
		if ( validation.ok === false ) {
			if ( validation.reason === 'forbidden-keys' ) {
				this.setStatus( '现场基准配置包含会话矩阵字段，已拒绝保存。' );
				return;
			}

			arError( '[SiteBaselineSaveFailed]', {
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
			this.activeSiteCalibrationBaseline = baseline;
			this.syncArSessionContext();
			this.refreshSiteCalibrationBaselineState( { silentStatus: true } );
			this.setStatus( '现场基准配置已保存。AR 巡查将读取该配置，并在每次进入 AR 时重新完成空间校正。' );
			this.emit();
		} ).catch( ( error ) => {
			arError( 'Site baseline save failed:', error );
			arError( '[SiteBaselineSaveFailed]', {
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

	startCurrentSessionMarkerCalibration(): void {

		this.markerCalibrationRuntime.startCurrentSessionCalibration();

	}

	captureCurrentSessionMarkerCorner(): void {

		this.markerCalibrationRuntime.captureCurrentSessionMarkerCorner();

	}

	resetCurrentSessionMarkerCalibration(): void {

		this.markerCalibrationRuntime.resetCurrentSessionCalibration();

	}

	solveAndApplyCurrentSessionMarkerCalibration(): MarkerSolutionApplyResult {

		return this.markerCalibrationRuntime.solveAndApplyCurrentSessionCalibration();

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
		this.markerCalibrationCapturedCornersAr = [];
		this.activeMarkerLocalizationResult = null;
		this.markerCorrectionFallbackArFromEnuSolution = null;

		this.syncRegistrationChainDebug();
		this.syncLocalizationDebug();
		this.markerCalibrationRuntime.syncState( {
			applied: false,
			lastUpdatedAt: Date.now()
		} );
		this.setStatus( `Marker 校正已清除，当前回退到 ${fallbackSource}。` );
		this.emit();

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

	async placeModel(): Promise<ModelPlacementResult> {

		if ( this.sceneBundle.renderer.xr.isPresenting === false ) {
			this.setStatus( 'AR 会话尚未开启。' );
			return { ok: false, stage: 'marker', reason: 'ar-session-not-presenting', message: 'AR 会话尚未开启。' };
		}

		const guard = this.validateEngineeringPlacementPreconditions();
		if ( guard.ok === false ) {
			const message = guard.message ?? '请先完成 Marker 四角点校正后再进行工程放置。';
			this.setStatus( message );
			return { ok: false, stage: placementStageForBlockReason( guard.reason ), reason: guard.reason ?? 'transform-missing', message };
		}

		return this.placeModelFromCurrentMarkerSolution( guard );

	}

	private tryAutoPlaceAppliedMarkerSolution(): void {

		const arFromEnuSolution = this.getActiveMarkerArFromEnuSolutionForCurrentSession();
		if (
			arFromEnuSolution === null
			|| this.modelTemplate === null
			|| this.registrationSolution === null
			|| this.placementSession.getArPlacedModel() !== null
		) {
			return;
		}

		const solutionId = `${arFromEnuSolution.sessionId ?? 'none'}:${arFromEnuSolution.timestamp}`;
		if ( this.lastAppliedMarkerSolutionId === solutionId || this.autoPlacementInFlightSolutionId === solutionId ) {
			return;
		}

		const guard = this.validateEngineeringPlacementPreconditions();
		if ( guard.ok === false ) {
			return;
		}

		this.autoPlacementInFlightSolutionId = solutionId;
		this.placeModelFromCurrentMarkerSolution( guard, 'marker-applied-model-runtime-ready' )
			.then( () => {
				if ( this.placementSession.getArPlacedModel() !== null ) {
					this.lastAppliedMarkerSolutionId = solutionId;
				}
			} )
			.catch( ( error ) => {
				this.setStatus( error instanceof Error ? `Marker 校正后的模型放置失败：${error.message}` : 'Marker 校正后的模型放置失败。' );
				arError( '[MarkerModelAutoPlacementFailed]', { solutionId, error } );
			} )
			.finally( () => {
				this.autoPlacementInFlightSolutionId = null;
			} );

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
			arWarn( '[ArSessionEndFailed]', error );
			this.arSessionEndPending = false;
			this.setStatus(
				error instanceof Error
					? `AR 会话退出失败：${error.message}`
					: 'AR 会话退出失败，请稍后重试。'
			);
		} );

	}

	saveInspectionRecord(input: Omit<CreateInspectionRecordInput, 'siteId'>): void {

		const siteId = this.demoModelConfig?.siteId ?? null;
		if ( siteId === null ) {
			this.setStatus( '当前站点尚未准备完成，无法保存巡查记录。' );
			return;
		}

		const nextRecord: CreateInspectionRecordInput = {
			siteId,
			createdAt: Date.now(),
			...input
		};
		void repositories.inspection.create( nextRecord ).then( ( record ) => {
			this.setStatus( `已保存巡查记录：${record.result}` );
			this.emit();
		} ).catch( ( error ) => {
			arError( '[InspectionRecordSaveFailed]', {
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

		try {
			task();
		} catch ( error ) {
			this.reportFrameTaskError( stage, error );
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
		arError( '[ThreeEngineFrameTaskError]', {
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

	private syncLocalizationDebug(): void {

		const solution = this.getActiveMarkerArFromEnuSolutionForCurrentSession();
		const target = this.getActiveEngineeringControlTarget();
		const rtk = solution === null || this.registrationSolution === null
			? []
			: this.registrationSolution.controlPoints.slice( 0, 4 ).map( ( point ) => ( { position: point.worldEnu.clone().applyMatrix4( solution.matrix ), label: `RTK-${point.id}` } ) );
		const placedModel = this.placementSession.getArPlacedModel();
		placedModel?.updateMatrixWorld( true );
		const model = placedModel === null || this.registrationSolution === null
			? []
			: [
				...this.registrationSolution.controlPoints.slice( 0, 4 ).map( ( point ) => ( { position: placedModel.localToWorld( point.modelLocal.clone() ), label: `模型-${point.id}` } ) ),
				{ position: placedModel.localToWorld( new THREE.Vector3() ), label: '模型原点' }
			];
		this.localizationDebugLayer.sync( {
			siteOrigin: solution === null ? [] : [ { position: solution.siteOriginArPosition.clone(), label: 'RTK工程原点' } ],
			marker: solution === null || target === null ? [] : [ { position: new THREE.Vector3( ...target.centerEnu ).applyMatrix4( solution.matrix ), label: 'Marker' } ],
			rtk,
			model
		} );

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

	private getSessionSiteConfig(): DemoModelConfig | null {

		return this.demoModelConfig ?? this.currentArSessionContext?.siteConfig ?? null;

	}

	private getActiveRuntimeConfig(): DemoModelConfig | null {

		return this.demoModelConfig;

	}

	private getActiveModelTemplate(): THREE.Group | null {

		return this.modelTemplate;

	}

	private canPreserveMarkerLocalizationForRuntimeRefresh(nextModelId: string): boolean {

		const context = this.currentArSessionContext;
		const activeTargetId = context?.controlTargets?.[ 0 ]?.id
			?? this.store.getState().markerCalibration.markerId
			?? null;
		return this.currentArSessionId !== null
			&& context !== null
			&& context.siteConfig.modelId === nextModelId
			&& context.siteId.length > 0
			&& activeTargetId !== null;

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

		const siteId = this.demoModelConfig?.siteId ?? null;
		if ( siteId === null ) {
			this.activeSiteCalibrationBaseline = null;
			this.syncArSessionContext();
			this.registrationStateRuntime.applySiteCalibrationBaselineState( null, options );
			return null;
		}

		const requestId = ++this.siteBaselineLoadRequestId;

		try {
			const baseline = await repositories.siteBaseline.load( siteId );
			if ( requestId !== this.siteBaselineLoadRequestId || this.demoModelConfig?.siteId !== siteId ) {
				return this.activeSiteCalibrationBaseline;
			}

			if ( baseline === null ) {
			} else {
			}

			this.activeSiteCalibrationBaseline = baseline;
			this.syncArSessionContext();
			this.registrationStateRuntime.applySiteCalibrationBaselineState( baseline, options );
			this.syncRegistrationChainDebug();
			this.markerCalibrationRuntime.syncState();
			this.emit();
			return baseline;
		} catch ( error ) {
			if ( requestId !== this.siteBaselineLoadRequestId || this.demoModelConfig?.siteId !== siteId ) {
				return this.activeSiteCalibrationBaseline;
			}

			arError( '[SiteBaselineLoadFailed]', {
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
			return;
		}

		const resolved = this.resolveSessionContextControlTargets();
		const nextContext: ArSessionContext = {
			sessionId: this.currentArSessionId,
			mode: this.workflowMode,
			siteId: this.demoModelConfig.siteId,
			siteConfig: this.demoModelConfig,
			baseline: this.activeSiteCalibrationBaseline,
			controlTargets: resolved.controlTargets
		};
		this.currentArSessionContext = nextContext;

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

		if ( this.store.getState().modelRuntimeLoad.modelRuntimeLoadState !== 'ready' ) {
			return {
				ok: false,
				reason: this.getRuntimePlacementBlockReason(),
				message: this.getRuntimePlacementBlockedMessage()
			};
		}

		if ( this.demoModelConfig === null ) {
			return {
				ok: false,
				reason: this.getRuntimePlacementBlockReason(),
				message: this.getRuntimePlacementBlockedMessage()
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

		if ( this.modelTemplate === null ) {
			return {
				ok: false,
				reason: this.getRuntimePlacementBlockReason(),
				message: this.getRuntimePlacementBlockedMessage( '模型模板尚未加载完成，无法正式放置模型。' )
			};
		}

		if ( this.registrationSolution === null ) {
			return {
				ok: false,
				reason: this.getRuntimePlacementBlockReason(),
				message: this.getRuntimePlacementBlockedMessage( '模型控制点配准尚未准备完成，无法正式放置模型。' )
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

	private updateModelControlPointPlacementStatus(arFromEnuSolution: ArFromEnuSolution): void {

		const placedModel = this.placementSession.getArPlacedModel();
		if ( placedModel === null || this.registrationSolution === null ) {
			return;
		}

		placedModel.updateMatrixWorld( true );
		const errors = this.registrationSolution.controlPoints.slice( 0, 4 ).map( ( point ) => {
			const expectedAr = point.worldEnu.clone().applyMatrix4( arFromEnuSolution.matrix );
			return expectedAr.distanceTo( placedModel.localToWorld( point.modelLocal.clone() ) );
		} );
		const rmsError = computeRms( errors );
		const maxError = Math.max( ...errors, 0 );
		const severity = maxError > 0.5
			? '模型控制点严重不对齐，请检查 modelLocal 坐标空间 / upAxis / 放置矩阵。'
			: rmsError > MODEL_CONTROL_POINT_PLACEMENT_RMS_LIMIT_METERS
				? '模型控制点偏差较大'
				: '控制点基本对齐';
		const message = `模型控制点误差：RMS ${rmsError.toFixed( 3 )}m / Max ${maxError.toFixed( 3 )}m，状态：${severity}`;
		this.store.patch( { registrationStatusDetail: message } );
		if ( rmsError > MODEL_CONTROL_POINT_PLACEMENT_RMS_LIMIT_METERS ) {
			this.setStatus( message );
		}

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

	private correctPlacedModelUpAxis(): void {

		const placedModel = this.placementSession.getArPlacedModel();
		if ( placedModel === null ) {
			return;
		}

		placedModel.updateMatrixWorld( true );
		const wrapperWorldUp = new THREE.Vector3( 0, 1, 0 ).transformDirection( placedModel.matrixWorld ).normalize();
		if ( wrapperWorldUp.dot( new THREE.Vector3( 0, 1, 0 ) ) >= 0 ) {
			return;
		}

		const rootPosition = placedModel.getWorldPosition( new THREE.Vector3() );
		const rootQuaternion = placedModel.getWorldQuaternion( new THREE.Quaternion() );
		const rootScale = placedModel.getWorldScale( new THREE.Vector3() );
		const correction = new THREE.Quaternion().setFromUnitVectors( wrapperWorldUp, new THREE.Vector3( 0, 1, 0 ) );
		this.applyPlacedRootWorldMatrix( placedModel, new THREE.Matrix4().compose( rootPosition, correction.multiply( rootQuaternion ), rootScale ) );

	}
	private applyCurrentSessionMarkerSolution(
		solution: MarkerLocalizationSolution,
		metadata: MarkerSolutionApplyMetadata
	): boolean {

		const diagnostics = this.createMarkerSolutionApplyDiagnostics( solution, metadata );
		const reject = ( stage: MarkerSolutionApplyStage, reason: string ): boolean => {
			this.lastMarkerSolutionApplyResult = { ok: false, stage, reason, diagnostics };
			this.setStatus( `Marker 校正未应用：${reason}` );
			return false;
		};
		if ( diagnostics.isPresenting === false || diagnostics.currentSessionId === null ) return reject( 'session-validation', diagnostics.isPresenting ? 'current-session-missing' : 'ar-session-not-presenting' );
		if ( diagnostics.solutionSessionId !== diagnostics.currentSessionId ) return reject( 'session-validation', 'solution-session-mismatch' );
		if ( diagnostics.markerStateSessionId !== diagnostics.currentSessionId ) return reject( 'session-validation', 'marker-state-session-mismatch' );
		if ( diagnostics.hasCurrentArSessionContext === false ) return reject( 'context-validation', 'session-context-missing' );
		if ( diagnostics.contextSessionId !== diagnostics.currentSessionId ) return reject( 'context-validation', 'context-session-mismatch' );
		if ( diagnostics.activeSiteId !== diagnostics.solutionSiteId ) return reject( 'context-validation', 'active-site-changed' );
		if ( diagnostics.activeModelId !== diagnostics.solutionModelId ) return reject( 'context-validation', 'active-model-changed' );
		if ( diagnostics.activeMarkerId !== diagnostics.solutionMarkerId ) return reject( 'context-validation', 'marker-target-changed' );
		if ( diagnostics.hasDemoModelConfig === false ) return reject( 'context-validation', 'session-context-missing' );
		if ( diagnostics.solutionMatrixFinite === false || diagnostics.solutionMatrixInvertible === false ) return reject( 'solution-validation', diagnostics.solutionMatrixFinite ? 'solution-matrix-not-invertible' : 'solution-matrix-not-finite' );
		if ( this.currentArSessionContext?.controlTargets?.some( ( target ) => target.id === metadata.markerId || target.markerId === metadata.markerId ) === false ) return reject( 'context-validation', 'marker-target-changed' );
		const controlTargets = this.getCurrentControlTargets();
		if ( this.demoModelConfig !== null && hasMockEngineeringDataInConfig( this.demoModelConfig, controlTargets ) && canApplyMockEngineeringCalibration() === false ) return reject( 'solution-validation', 'mock-engineering-data-rejected' );
		const previousMarkerSolution = this.activeMarkerArFromEnuSolution;
		const previousMarkerResult = this.activeMarkerLocalizationResult;
		const previousFallback = this.markerCorrectionFallbackArFromEnuSolution;
		const previousCoordinateSolution = this.arCoordinateService.getCurrentSolution();
		try {
			const applied = this.applyCurrentSessionMarkerSolutionBoolean( solution, metadata );
			const placementState = this.modelTemplate !== null && this.registrationSolution !== null
				? 'ready'
				: 'marker-applied-model-runtime-pending';
			this.lastMarkerSolutionApplyResult = applied
				? { ok: true, sessionId: diagnostics.currentSessionId, markerId: metadata.markerId, appliedSource: 'marker', placementState, diagnostics: this.createMarkerSolutionApplyDiagnostics( solution, metadata ) }
				: { ok: false, stage: 'state-commit', reason: 'state-commit-failed', diagnostics: this.createMarkerSolutionApplyDiagnostics( solution, metadata ) };
			return applied;
		} catch ( error ) {
			this.activeMarkerArFromEnuSolution = previousMarkerSolution;
			this.activeMarkerLocalizationResult = previousMarkerResult;
			this.markerCorrectionFallbackArFromEnuSolution = previousFallback;
			this.arCoordinateService.setArFromEnuSolution( previousCoordinateSolution, this.currentArSessionId );
			return reject( 'state-commit', error instanceof Error ? error.message : 'state-commit-failed' );
		}

	}

	private getRuntimePlacementBlockReason(): EngineeringPlacementBlockReason {

		return this.store.getState().modelRuntimeLoad.modelRuntimeLoadState === 'failed'
			? 'model-runtime-load-failed'
			: 'model-runtime-loading';

	}

	private getRuntimePlacementBlockedMessage(fallback = '模型运行时尚未准备完成。'): string {

		const runtime = this.store.getState().modelRuntimeLoad;
		if ( runtime.modelRuntimeLoadState === 'failed' ) {
			return runtime.modelRuntimeLoadErrorMessage ?? `模型运行时加载失败：${runtime.modelRuntimeLoadFailureReason ?? 'unknown'}。`;
		}
		return runtime.modelRuntimeLoadState === 'loading'
			? '模型资源仍在加载，请稍候。'
			: fallback;

	}

	private describeRuntimeLoadBlock(stage: string): string {

		return `model-runtime-load-failed:${stage}`;

	}

	private createMarkerSolutionApplyDiagnostics(solution: MarkerLocalizationSolution, metadata: MarkerSolutionApplyMetadata): MarkerSolutionApplyDiagnostics {

		const state = this.store.getState().markerCalibration;
		const matrix = solution.matrix;
		const determinant = matrix.determinant();
		const context = this.currentArSessionContext;
		const activeConfig = this.demoModelConfig ?? context?.siteConfig ?? null;
		const activeModelId = activeConfig?.modelId ?? null;
		return {
			currentSessionId: this.currentArSessionId,
			solutionSessionId: solution.arFromEnuSolution.sessionId ?? null,
			markerStateSessionId: state.currentSessionId,
			contextSessionId: context?.sessionId ?? null,
			isPresenting: this.sceneBundle.renderer.xr.isPresenting,
			hasCurrentArSessionContext: context !== null,
			hasDemoModelConfig: activeConfig !== null,
			hasModelTemplate: this.modelTemplate !== null,
			hasRegistrationSolution: this.registrationSolution !== null,
			hasArCoordinateServiceSolution: this.arCoordinateService.hasCalibration(),
			arCoordinateServiceReady: true,
			activeMarkerSolutionSessionId: this.activeMarkerArFromEnuSolution?.sessionId ?? null,
			activeMarkerSolutionSource: this.activeMarkerArFromEnuSolution?.source ?? null,
			solutionSource: solution.arFromEnuSolution.source,
			solutionMatrixFinite: matrix.elements.every( Number.isFinite ),
			solutionMatrixInvertible: Number.isFinite( determinant ) && Math.abs( determinant ) > 1e-10,
			activeModelId,
			solutionModelId: metadata.calibrationModelId,
			activeSiteId: context?.siteId ?? activeModelId,
			solutionSiteId: metadata.calibrationSiteId,
			activeMarkerId: state.markerId,
			solutionMarkerId: metadata.calibrationMarkerId,
			calibrationModelId: metadata.calibrationModelId,
			calibrationSiteId: metadata.calibrationSiteId,
			calibrationMarkerId: metadata.calibrationMarkerId,
			capturedCornerCount: state.capturedCornerCount,
			expectedCornerCount: state.expectedCornerCount,
			arSessionGeneration: this.arSessionGeneration,
			modelRuntimeGeneration: this.modelRuntimeGeneration,
			markerCalibrationGeneration: 0
		};

	}

	private applyCurrentSessionMarkerSolutionBoolean(
		solution: MarkerLocalizationSolution,
		metadata: MarkerSolutionApplyMetadata
	): boolean {

		return this.applyCurrentSessionMarkerSolutionOnly( solution, metadata );

	}

	private applyCurrentSessionMarkerSolutionOnly(
		solution: MarkerLocalizationSolution,
		metadata: MarkerSolutionApplyMetadata
	): boolean {

		if ( this.currentArSessionId === null ) {
			this.setStatus( '当前 AR Session 已失效，请重新开始 Marker 校正。' );
			return false;
		}

		if ( solution.arFromEnuSolution.sessionId !== this.currentArSessionId ) {
			this.setStatus( 'Marker 校正结果属于旧会话，不能应用到当前 AR Session。' );
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
			this.setStatus( '当前为示例工程坐标，请替换为 RTK 实测数据后再完成正式空间校正。' );
			return false;
		}
		const fallbackSolution = this.activeMarkerArFromEnuSolution === null
			? this.getCurrentNonMarkerArFromEnuSolution()
			: this.markerCorrectionFallbackArFromEnuSolution;
		this.markerCorrectionFallbackArFromEnuSolution = fallbackSolution === null
			? null
			: cloneArFromEnuSolution( fallbackSolution );
		this.activeMarkerArFromEnuSolution = cloneArFromEnuSolution( solution.arFromEnuSolution );
		this.markerCalibrationCapturedCornersAr = ( metadata.capturedCornersAr ?? [] ).map( ( point ) => point.clone() );
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
		this.placementSession.cancelAutoPlacement();
		this.syncRegistrationChainDebug();
		this.syncLocalizationDebug();
		queueMicrotask( () => this.tryAutoPlaceAppliedMarkerSolution() );
		this.setStatus(
			this.modelTemplate === null || this.registrationSolution === null
				? 'Marker 校正成功，正在等待模型资源。'
				: 'Marker 校正已完成，工程坐标已对齐，请点击工程放置模型。'
		);
		this.emit();
		return true;

	}

	private async placeModelFromCurrentMarkerSolution(
		guard: EngineeringPlacementGuardResult,
		reason = 'engineering-place-button'
	): Promise<ModelPlacementResult> {

		const arFromEnuSolution = guard.arFromEnuSolution ?? this.getActiveMarkerArFromEnuSolutionForCurrentSession();
		if ( arFromEnuSolution === null ) {
			const message = '请先完成 Marker 四角点校正后再进行工程放置。';
			this.setStatus( message );
			return { ok: false, stage: 'marker', reason: 'marker-solution-missing', message };
		}

		await this.placementWorkflow.placeLocalizedModel();
		if ( this.placementSession.getArPlacedModel() === null ) {
			return { ok: false, stage: 'placement', reason: 'placed-model-missing', message: '模型放置未生成可显示对象。' };
		}

		this.correctPlacedModelUpAxis();
		this.updateModelControlPointPlacementStatus( arFromEnuSolution );
		return { ok: true, placedModelUuid: this.placementSession.getArPlacedModel()?.uuid ?? '' };

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
			return markerSolution;
		}

		const nonMarkerSolution = this.getCurrentNonMarkerArFromEnuSolution();
		if ( nonMarkerSolution !== null && nonMarkerSolution.source === 'rtk' ) {
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
		this.markerCalibrationCapturedCornersAr = [];
		this.activeMarkerLocalizationResult = null;
		this.markerCorrectionFallbackArFromEnuSolution = null;
		this.arCoordinateService.clear();
		this.annotationLayer.clear();
		this.annotationLayer.setSelected( null );
		this.clearAnnotationDetail();
		this.syncLocalizationDebug();

	}

	private resolveConfiguredMarkerPoses(config: DemoModelConfig): MarkerPoseInEnu[] {

		return config.markers.flatMap( ( marker ) => {
			try {
				return [ resolveMarkerPoseInEnu( config, marker.id ) ];
			} catch ( error ) {
				arWarn(
					`Failed to resolve marker engineering pose for ${marker.id}:`,
					error
				);
				return [];
			}
		} );

	}

	private updateRealDepth(frame: XRFrame): void {
		const referenceSpace = this.sceneBundle.renderer.xr.getReferenceSpace();
		const view = referenceSpace === null ? null : frame.getViewerPose( referenceSpace )?.views[ 0 ] ?? null;
		if ( this.realDepthProvider.isSessionEnabled() && view !== null ) {
			this.realDepthProvider.update( frame, view, performance.now() );
		}

	}

	private handleXRSessionStart(result: ArSessionStartResult): void {

		if ( result.depthGranted ) this.realDepthProvider.initialize( result.session );
		else this.realDepthProvider.dispose();
		this.sessionLifecycleRuntime.handleXRSessionStart();
		this.arSessionGeneration += 1;
		this.syncArSessionContext();

	}

	private handleXRSessionEnd(): void {

		this.arSessionEndPending = false;
		this.realDepthProvider.dispose();
		this.arCoordinateService.clear();
		this.annotationLayer.clear();
		this.annotationLayer.setSelected( null );
		this.clearAnnotationDetail();
		this.sessionLifecycleRuntime.handleXRSessionEnd();
		this.currentArSessionContext = null;

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
			return;
		}

		const items = this.buildAnnotationItemsForPlacedModel( placedModel );
		this.annotationLabelsController.setItems( items );

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
		this.setStatus( `已选择 ${item.title}。` );
		this.emit();

	}

	private showCanvasModelPropertyPanel(
		businessObject: THREE.Object3D,
		properties: PipeRecord | null,
		preferredLayerName?: string
	): void {

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

		this.sectionCutController.markBoundsDirty();
		this.layerVisibility.rebuild( {
			modelRoot: this.modelTemplate,
			pipesByName: this.pipesByName
		} );
		if ( this.store.getState().undergroundInspectionTool === 'layer-peeling' ) {
			this.layerVisibility.setHiddenLayerCount(
				mapLayerPeelingValue(
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

	private applyModelLayerVisibility(caller: 'auto-placement' | 'selection-cleared' | 'inspection-tool-changed' | 'layer-peeling-value-changed' | 'initialization' = 'initialization'): void {

		this.visualizationStateRuntime.applyModelLayerVisibility();

	}

	private syncLayerPeelingValueFromLayers(): void {

		const layers = this.layerVisibility.getState();
		const nextValue = hiddenLayerCountToPercent( countHiddenLayers( layers ), layers.length );
		const patch: Partial<RegistrationStoreState> = {
			layerPeelingValue: nextValue
		};
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

	private handleEngineeringAnnotationSelection(
		annotation: EngineeringAnnotation,
		object: THREE.Object3D
	): void {

		this.propertySelection.clearSelection();
		this.annotationLayer.setSelected( annotation.id );
		this.store.patch( {
			selectedAnnotationId: annotation.id,
			annotationDetail: this.createEngineeringAnnotationDetailState( annotation )
		} );
		this.annotationLabelsController.setDetail( null );
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

function placementStageForBlockReason(reason: EngineeringPlacementBlockReason | undefined): 'runtime' | 'registration' | 'marker' {

	if ( reason === 'model-runtime-loading' || reason === 'model-runtime-load-failed' || reason === 'model-template-missing' || reason === 'model-config-missing' ) return 'runtime';
	if ( reason === 'model-registration-missing' ) return 'registration';
	return 'marker';

}

function computeRms(errors: number[]): number {

	if ( errors.length === 0 ) {
		return 0;
	}
	return Math.sqrt( errors.reduce( ( total, error ) => total + error * error, 0 ) / errors.length );

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

function hiddenLayerCountToPercent(hiddenLayerCount: number, totalLayerCount: number): number {
	return mapHiddenLayerCountToValue( hiddenLayerCount, totalLayerCount );

}

function isEffectivelyVisible(object: THREE.Object3D | null): boolean {
	for ( let current = object; current !== null; current = current.parent ) if ( current.visible === false ) return false;
	return object !== null;
}













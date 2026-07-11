import { computed, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import {
	createLoadModelArController,
	type InspectionDraft,
	type LoadModelArController,
	type RegistrationView
} from '@/features/ar/controller/ar-controller.js';
import type { ArWorkflowMode } from '@/features/ar/types/workflow.js';
import type {
	InspectionPlacementSource,
	SectionCutPlaneMode,
	WorkspaceMode
} from '@/localization/core/registration-store.js';
import type { ThreeEngineHosts, ThreeEngineSnapshot, UndergroundViewChangeResult } from '@/engine/core/three-engine.js';
import type { CreateInspectionRecordInput } from '@/services/repositories/inspection-repository.js';
import type { UndergroundMaterialMode, UndergroundViewMode } from '@/engine/visualization/underground-display-state.js';
import type { LegacyArDisplayMode } from '@/engine/visualization/underground-display-state.js';

interface ControllerUiState {
	drawerOpen: boolean;
	registrationView: RegistrationView;
	inspectionFormExpanded: boolean;
	inspectionDraft: InspectionDraft;
}

export interface LoadModelArControllerState {
	engine: ThreeEngineSnapshot;
	ui: ControllerUiState;
}

const DEFAULT_INSPECTION_DRAFT: InspectionDraft = {
	result: '\u6b63\u5e38',
	type: '\u4f4d\u7f6e\u504f\u5dee',
	severity: '\u4e00\u822c',
	note: ''
};

function createInitialUiState(): ControllerUiState {

	return {
		drawerOpen: false,
		registrationView: 'overview',
		inspectionFormExpanded: false,
		inspectionDraft: { ...DEFAULT_INSPECTION_DRAFT }
	};

}

function createSnapshotFallback(): LoadModelArControllerState {

	const controller = createLoadModelArController();
	const state = {
		engine: controller.getEngineState(),
		ui: createInitialUiState()
	};
	controller.dispose();
	return state;

}

export const useArShellStore = defineStore( 'ar-shell', () => {

	const controllerRef = shallowRef<LoadModelArController | null>( null );
	const engineSnapshotRef = shallowRef<ThreeEngineSnapshot>( createSnapshotFallback().engine );
	const uiStateRef = shallowRef<ControllerUiState>( createInitialUiState() );
	const initializedRef = shallowRef( false );
	let unsubscribe: (() => void) | null = null;
	let initializePromise: Promise<void> | null = null;
	let previousEngineState = engineSnapshotRef.value;

	function ensureController(): LoadModelArController {

		if ( controllerRef.value !== null ) {
			return controllerRef.value;
		}

		const controller = createLoadModelArController();
		controllerRef.value = controller;
		engineSnapshotRef.value = controller.getEngineState();
		previousEngineState = engineSnapshotRef.value;
		unsubscribe = controller.subscribe( () => {
			const nextState = controller.getEngineState();
			const enteredArSession = previousEngineState.appMode !== 'ar-session' && nextState.appMode === 'ar-session';
			const completedPlacement = previousEngineState.arSessionPhase !== 'placed' && nextState.arSessionPhase === 'placed';

			if ( enteredArSession || completedPlacement ) {
				patchUiState( {
					drawerOpen: false,
					registrationView: 'overview'
				} );
			}

			previousEngineState = nextState;
			engineSnapshotRef.value = nextState;
		} );
		return controller;

	}

	function patchUiState(patch: Partial<ControllerUiState>): void {

		uiStateRef.value = {
			...uiStateRef.value,
			...patch
		};

	}

	function buildInspectionRecordInput(): Omit<CreateInspectionRecordInput, 'siteId'> {

		const draft = uiStateRef.value.inspectionDraft;
		return {
			result: draft.result,
			riskLevel: draft.severity,
			note: [ draft.type, draft.note ].filter( Boolean ).join( ' / ' ),
			createdBy: 'local-user'
		};

	}

	async function initialize(): Promise<void> {

		if ( initializePromise !== null ) {
			return initializePromise;
		}

		const controller = ensureController();
		initializePromise = controller.initialize().then( () => {
			engineSnapshotRef.value = controller.getEngineState();
			previousEngineState = engineSnapshotRef.value;
			initializedRef.value = true;
		} );
		return initializePromise;

	}

	function mountHosts(hosts: ThreeEngineHosts): void {

		const controller = ensureController();
		controller.mountHosts( hosts );

	}

	function dispose(): void {

		initializePromise = null;
		initializedRef.value = false;
		uiStateRef.value = createInitialUiState();
		if ( unsubscribe !== null ) {
			unsubscribe();
			unsubscribe = null;
		}

		if ( controllerRef.value !== null ) {
			controllerRef.value.dispose();
			controllerRef.value = null;
		}

	}

	function handleActivatePanel(mode: WorkspaceMode): void {

		const controller = ensureController();
		const currentEngineState = engineSnapshotRef.value;
		const currentUiState = uiStateRef.value;
		if ( currentEngineState.workspaceMode === mode && currentUiState.drawerOpen ) {
			patchUiState( { drawerOpen: false } );
			return;
		}

		controller.actions.activatePanel( mode );
		const nextRegistrationView =
			mode === 'registration'
					? currentUiState.registrationView
					: 'overview';

		patchUiState( {
			drawerOpen: true,
			registrationView: nextRegistrationView
		} );

	}

	function handleStartCurrentSessionMarkerCalibration(): void {

		const controller = ensureController();
		controller.actions.startCurrentSessionMarkerCalibration();
		if ( controller.getEngineState().markerCalibration.active ) {
			patchUiState( {
				drawerOpen: false,
				registrationView: 'overview'
			} );
		}

	}

	function handleResetCurrentSessionMarkerCalibration(): void {

		ensureController().actions.resetCurrentSessionMarkerCalibration();
		patchUiState( {
			drawerOpen: true,
			registrationView: 'overview'
		} );

	}

	function handleCancelCurrentSessionMarkerCalibration(): void {

		ensureController().actions.resetCurrentSessionMarkerCalibration();
		patchUiState( {
			drawerOpen: false,
			registrationView: 'overview'
		} );

	}

	function handleSolveAndApplyCurrentSessionMarkerCalibration(): boolean {

		const applied = ensureController().actions.solveAndApplyCurrentSessionMarkerCalibration();
		if ( applied ) {
			patchUiState( {
				drawerOpen: true,
				registrationView: 'overview'
			} );
		}
		return applied;

	}

	const actions = {
		handleArUiInteraction(): void {

			ensureController().actions.handleArUiInteraction();

		},

		closePropertyPanel(): void {

			ensureController().actions.closePropertyPanel();
			patchUiState( { drawerOpen: false } );

		},

		selectModel(modelId: string): void {

			ensureController().actions.selectModel( modelId );

		},

		setDisplayMode(mode: LegacyArDisplayMode): void {

			ensureController().actions.setDisplayMode( mode );

		},

		setSectionCutPlaneMode(mode: SectionCutPlaneMode): void {

			ensureController().actions.setSectionCutPlaneMode( mode );

		},

		setUndergroundViewMode(mode: UndergroundViewMode): Promise<UndergroundViewChangeResult> { return ensureController().actions.setUndergroundViewMode( mode ); },
		setUndergroundMaterialMode(mode: UndergroundMaterialMode): void { ensureController().actions.setUndergroundMaterialMode( mode ); },
		setLayerPeelingEnabled(enabled: boolean): void { ensureController().actions.setLayerPeelingEnabled( enabled ); },
		setSectionCutEnabled(enabled: boolean): void { ensureController().actions.setSectionCutEnabled( enabled ); },
		setTransparentXrayValue(value: number): void { ensureController().actions.setTransparentXrayValue( value ); },
		setLayerPeelingValue(value: number): void { ensureController().actions.setLayerPeelingValue( value ); },
		setSectionCutValue(value: number): void { ensureController().actions.setSectionCutValue( value ); },

		activatePanel(mode: WorkspaceMode): void {

			handleActivatePanel( mode );

		},

		toggleDrawer(): void {

			patchUiState( { drawerOpen: !uiStateRef.value.drawerOpen } );

		},

		closeDrawer(): void {

			if ( uiStateRef.value.drawerOpen ) patchUiState( { drawerOpen: false } );

		},

		setTimelineStage(index: number): void {

			ensureController().actions.setTimelineStage( index );

		},

		timelinePrev(): void {

			ensureController().actions.timelinePrev();

		},

		timelineNext(): void {

			ensureController().actions.timelineNext();

		},

		timelinePlay(): void {

			ensureController().actions.timelinePlay();

		},

		setWorkflowMode(mode: ArWorkflowMode): void {

			ensureController().actions.setWorkflowMode( mode );

		},

		refreshGeoLocation(): Promise<void> {

			return ensureController().actions.refreshGeoLocation();

		},

		saveSiteCalibrationBaseline(): void {

			ensureController().actions.saveSiteCalibrationBaseline();

		},

		refreshSavedMarkerLocalization(): void {

			ensureController().actions.refreshSavedMarkerLocalization();

		},

		startCurrentSessionMarkerCalibration(): void {

			handleStartCurrentSessionMarkerCalibration();

		},

		captureCurrentSessionMarkerCorner(): void {

			ensureController().actions.captureCurrentSessionMarkerCorner();

		},

		resetCurrentSessionMarkerCalibration(): void {

			handleResetCurrentSessionMarkerCalibration();

		},

		cancelCurrentSessionMarkerCalibration(): void {

			handleCancelCurrentSessionMarkerCalibration();

		},

		solveAndApplyCurrentSessionMarkerCalibration(): boolean {

			return handleSolveAndApplyCurrentSessionMarkerCalibration();

		},

		clearMarkerLocalizationCorrection(): void {

			ensureController().actions.clearMarkerLocalizationCorrection();

		},

		clearSavedMarkerLocalization(): void {

			ensureController().actions.clearSavedMarkerLocalization();

		},

		resetPlacement(): void {

			ensureController().actions.resetPlacement();
			patchUiState( {
				drawerOpen: false,
				registrationView: 'overview'
			} );

		},

		setInspectionPlacementSource(source: InspectionPlacementSource): void {

			ensureController().actions.setInspectionPlacementSource( source );

		},

		enterAr(): void {

			ensureController().actions.enterAr();

		},

		placeModel(): Promise<void> {

			return ensureController().actions.placeModel();

		},

		exitAr(): void {

			ensureController().actions.exitAr();
			patchUiState( {
				drawerOpen: false,
				registrationView: 'overview'
			} );

		},

		setRegistrationView(view: RegistrationView): void {

			patchUiState( {
				drawerOpen: true,
				registrationView: view
			} );

		},

		setInspectionFormExpanded(expanded: boolean): void {

			patchUiState( {
				drawerOpen: true,
				inspectionFormExpanded: expanded
			} );

		},

		updateInspectionDraft(patch: Partial<InspectionDraft>): void {

			patchUiState( {
				inspectionDraft: {
					...uiStateRef.value.inspectionDraft,
					...patch
				}
			} );

		},

		saveInspectionRecord(): void {

			ensureController().actions.saveInspectionRecord( buildInspectionRecordInput() );

		},

		exportInspectionRecords(): void {

			ensureController().actions.exportInspectionRecords();

		},

		takeSnapshot(): void {

			ensureController().actions.takeSnapshot();

		},

		toggleAnnotationHelper(label: string): void {

			ensureController().actions.toggleAnnotationHelper( label );

		},

		exportRegistrationSnapshot(): void {

			ensureController().actions.exportRegistrationSnapshot();

		},

	};

	const controllerState = computed<LoadModelArControllerState>( () => ( {
		engine: engineSnapshotRef.value,
		ui: uiStateRef.value
	} ) );
	const engine = computed( () => controllerState.value.engine );
	const ui = computed( () => controllerState.value.ui );

	return {
		initialized: initializedRef,
		controllerState,
		engine,
		ui,
		actions,
		initialize,
		mountHosts,
		dispose
	};

} );



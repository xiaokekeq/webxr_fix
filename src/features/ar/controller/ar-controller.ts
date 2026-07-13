import type {
	InspectionPlacementSource,
	SectionCutPlaneMode,
	WorkspaceMode
} from '@/localization/core/registration-store.js';
import type { ModelPlacementResult, ThreeEngineHosts, ThreeEngineSnapshot } from '@/engine/core/three-engine.js';
import { ThreeEngine } from '@/engine/core/three-engine.js';
import type { ArWorkflowMode } from '@/features/ar/types/workflow.js';
import type { CreateInspectionRecordInput } from '@/services/repositories/inspection-repository.js';
import { mapLegacyDisplayMode, type LegacyArDisplayMode, type UndergroundInspectionTool, type UndergroundMaterialMode } from '@/engine/visualization/underground-display-state.js';
import type { MarkerSolutionApplyResult } from '@/engine/inspection/marker-solution-apply-result.js';

export interface InspectionDraft {
	result: string;
	type: string;
	severity: string;
	note: string;
}

export type RegistrationView = 'overview' | 'manual';

export interface LoadModelArController {
	initialize(): Promise<void>;
	dispose(): void;
	mountHosts(hosts: ThreeEngineHosts): void;
	getEngineState(): ThreeEngineSnapshot;
	subscribe(listener: () => void): () => void;
	actions: {
		handleArUiInteraction(): void;
		closePropertyPanel(): void;
		selectModel(modelId: string): void;
		setDisplayMode(mode: LegacyArDisplayMode): void;
		setUndergroundMaterialMode(mode: UndergroundMaterialMode): void;
		setUndergroundInspectionTool(tool: UndergroundInspectionTool): void;
		setConformingShellRightForceDebug(active: boolean): void;
		setTransparentXrayValue(value: number): void;
		setLayerPeelingValue(value: number): void;
		setSectionCutValue(value: number): void;
		setSectionCutPlaneMode(mode: SectionCutPlaneMode): void;
		activatePanel(mode: WorkspaceMode): void;
		toggleDrawer(): void;
		setTimelineStage(index: number): void;
		timelinePrev(): void;
		timelineNext(): void;
		timelinePlay(): void;
		setWorkflowMode(mode: ArWorkflowMode): void;
		refreshGeoLocation(): Promise<void>;
		saveSiteCalibrationBaseline(): void;
		refreshSavedMarkerLocalization(): void;
		startCurrentSessionMarkerCalibration(): void;
		captureCurrentSessionMarkerCorner(): void;
		resetCurrentSessionMarkerCalibration(): void;
		solveAndApplyCurrentSessionMarkerCalibration(): MarkerSolutionApplyResult;
		clearMarkerLocalizationCorrection(): void;
		clearSavedMarkerLocalization(): void;
		resetPlacement(): void;
		setInspectionPlacementSource(source: InspectionPlacementSource): void;
	enterAr(): void;
		placeModel(): Promise<ModelPlacementResult>;
		exitAr(): void;
		setRegistrationView(_view: RegistrationView): void;
		setInspectionFormExpanded(_expanded: boolean): void;
		updateInspectionDraft(_patch: Partial<InspectionDraft>): void;
		saveInspectionRecord(input: Omit<CreateInspectionRecordInput, 'siteId'>): void;
		exportInspectionRecords(): void;
		takeSnapshot(): void;
		toggleAnnotationHelper(label: string): void;
		exportRegistrationSnapshot(): void;
	};
}

export function createLoadModelArController(): LoadModelArController {

	const engine = new ThreeEngine();
	const listeners = new Set<() => void>();

	const unsubscribeEngine = engine.subscribe( () => {
		listeners.forEach( ( listener ) => {
			listener();
		} );
	} );

	return {
		initialize() {

			return engine.initialize();

		},

		dispose() {

			unsubscribeEngine();
			listeners.clear();
			engine.dispose();

		},

		mountHosts(hosts) {

			engine.mount( hosts );

		},

		getEngineState() {

			return engine.getState();

		},

		subscribe(listener) {

			listeners.add( listener );
			return () => {
				listeners.delete( listener );
			};

		},

		actions: {
			handleArUiInteraction() {

				engine.handleArUiInteraction();

			},

			closePropertyPanel() {

				engine.closePropertyPanel();

			},

			selectModel(modelId) {

				engine.selectModel( modelId );

			},

			setDisplayMode(mode) {

				const state = mapLegacyDisplayMode( mode );
				if ( state.undergroundMaterialMode !== undefined ) engine.setUndergroundMaterialMode( state.undergroundMaterialMode );
				if ( state.undergroundInspectionTool !== undefined ) engine.setUndergroundInspectionTool( state.undergroundInspectionTool );

			},

			setConformingShellRightForceDebug(active) {

				engine.setConformingShellRightForceDebug( active );

			},

			setSectionCutPlaneMode(mode) {

				engine.setSectionCutPlaneMode( mode );

			},

			setUndergroundMaterialMode(mode) { engine.setUndergroundMaterialMode( mode ); },
			setUndergroundInspectionTool(tool) { engine.setUndergroundInspectionTool( tool ); },
			setTransparentXrayValue(value) { engine.setTransparentXrayValue( value ); },
			setLayerPeelingValue(value) { engine.setLayerPeelingValue( value ); },
			setSectionCutValue(value) { engine.setSectionCutValue( value ); },

			activatePanel(mode) {

				engine.setWorkspaceMode( mode );

			},

			toggleDrawer() {

				// UI state now lives in Pinia. Keep this method as a compatibility no-op bridge.

			},

			setTimelineStage(index) {

				engine.setTimelineStage( index );

			},

			timelinePrev() {

				engine.timelinePrev();

			},

			timelineNext() {

				engine.timelineNext();

			},

			timelinePlay() {

				engine.timelinePlay();

			},

			setWorkflowMode(mode) {

				engine.setWorkflowMode( mode );

			},

			refreshGeoLocation() {

				return engine.refreshGeoLocation();

			},

			saveSiteCalibrationBaseline() {

				engine.saveSiteCalibrationBaseline();

			},

			refreshSavedMarkerLocalization() {

				engine.refreshSavedMarkerLocalization();

			},

			startCurrentSessionMarkerCalibration() {

				engine.startCurrentSessionMarkerCalibration();

			},

			captureCurrentSessionMarkerCorner() {

				engine.captureCurrentSessionMarkerCorner();

			},

			resetCurrentSessionMarkerCalibration() {

				engine.resetCurrentSessionMarkerCalibration();

			},

			solveAndApplyCurrentSessionMarkerCalibration() {

				return engine.solveAndApplyCurrentSessionMarkerCalibration();

			},

			clearMarkerLocalizationCorrection() {

				engine.clearMarkerLocalizationCorrection();

			},

			clearSavedMarkerLocalization() {

				engine.clearSavedMarkerLocalization();

			},

			resetPlacement() {

				engine.resetPlacement();

			},

			setInspectionPlacementSource(source) {

				engine.setInspectionPlacementSource( source );

			},

			enterAr() {

				engine.enterAr();

			},

			placeModel() {

				return engine.placeModel();

			},

			exitAr() {

				engine.exitAr();

			},

			setRegistrationView(_view) {

				// UI state now lives in Pinia. Keep this method as a compatibility no-op bridge.

			},

			setInspectionFormExpanded(_expanded) {

				// UI state now lives in Pinia. Keep this method as a compatibility no-op bridge.

			},

			updateInspectionDraft(_patch) {

				// UI state now lives in Pinia. Keep this method as a compatibility no-op bridge.

			},

			saveInspectionRecord(input) {

				engine.saveInspectionRecord( input );

			},

			exportInspectionRecords() {

				engine.exportInspectionRecords();

			},

			takeSnapshot() {

				engine.takeSnapshot();

			},

			toggleAnnotationHelper(label) {

				engine.toggleAnnotationHelper( label );

			},

			exportRegistrationSnapshot() {
			
				engine.exportRegistrationSnapshot();
			
			},
			
		}
	};

}



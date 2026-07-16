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
import type { ArProjectCapabilities, ArProjectConfig } from '@/shared/config/project-config.js';
import type { ProjectRepositories } from '@/services/repository-factory.js';

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
		setTransparentXrayValue(value: number): void;
		setLayerPeelingValue(value: number): void;
		setSectionCutValue(value: number): void;
		setSectionCutPlaneMode(mode: SectionCutPlaneMode): void;
		activatePanel(mode: WorkspaceMode): void;
		setTimelineStage(index: number): void;
		timelinePrev(): void;
		timelineNext(): void;
		timelinePlay(): void;
		setWorkflowMode(mode: ArWorkflowMode): void;
		refreshGeoLocation(): Promise<void>;
		saveSiteCalibrationBaseline(): void;
		startCurrentSessionMarkerCalibration(): void;
		captureCurrentSessionMarkerCorner(): void;
		resetCurrentSessionMarkerCalibration(): void;
		solveAndApplyCurrentSessionMarkerCalibration(): MarkerSolutionApplyResult;
		clearMarkerLocalizationCorrection(): void;
		resetPlacement(): void;
		setInspectionPlacementSource(source: InspectionPlacementSource): void;
		enterAr(): Promise<void>;
		placeModel(): Promise<ModelPlacementResult>;
		exitAr(): void;
		saveInspectionRecord(input: Omit<CreateInspectionRecordInput, 'siteId'>): void;
		exportInspectionRecords(): void;
		takeSnapshot(): void;
		toggleAnnotationHelper(label: string): void;
		exportRegistrationSnapshot(): void;
	};
}

export function assertArCapability(capabilities: ArProjectCapabilities, capability: keyof ArProjectCapabilities): void {
	if ( capabilities[ capability ] === false ) throw new Error( `AR capability disabled: ${capability}` );
}

export function createLoadModelArController(
	config: ArProjectConfig,
	repositories: ProjectRepositories
): LoadModelArController {

	const capabilities = config.capabilities;
	const engine = new ThreeEngine( config, repositories );
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
				if ( mode === 'transparent-xray' ) assertArCapability( capabilities, 'xray' );
				if ( mode === 'layer-peeling' ) assertArCapability( capabilities, 'layerControl' );
				if ( mode === 'section-cut' ) assertArCapability( capabilities, 'sectionCut' );

				const state = mapLegacyDisplayMode( mode );
				if ( state.undergroundMaterialMode !== undefined ) engine.setUndergroundMaterialMode( state.undergroundMaterialMode );
				if ( state.undergroundInspectionTool !== undefined ) engine.setUndergroundInspectionTool( state.undergroundInspectionTool );

			},

			setSectionCutPlaneMode(mode) {
				assertArCapability( capabilities, 'sectionCut' );

				engine.setSectionCutPlaneMode( mode );

			},

			setUndergroundMaterialMode(mode) {
				if ( mode === 'xray' ) assertArCapability( capabilities, 'xray' );
				engine.setUndergroundMaterialMode( mode );
			},
			setUndergroundInspectionTool(tool) {
				if ( tool === 'layer-peeling' ) assertArCapability( capabilities, 'layerControl' );
				if ( tool === 'section-cut' ) assertArCapability( capabilities, 'sectionCut' );
				engine.setUndergroundInspectionTool( tool );
			},
			setTransparentXrayValue(value) { assertArCapability( capabilities, 'xray' ); engine.setTransparentXrayValue( value ); },
			setLayerPeelingValue(value) { assertArCapability( capabilities, 'layerControl' ); engine.setLayerPeelingValue( value ); },
			setSectionCutValue(value) { assertArCapability( capabilities, 'sectionCut' ); engine.setSectionCutValue( value ); },

			activatePanel(mode) {

				engine.setWorkspaceMode( mode );

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

			startCurrentSessionMarkerCalibration() {
				assertArCapability( capabilities, 'markerRegistration' );

				engine.startCurrentSessionMarkerCalibration();

			},

			captureCurrentSessionMarkerCorner() {
				assertArCapability( capabilities, 'markerRegistration' );

				engine.captureCurrentSessionMarkerCorner();

			},

			resetCurrentSessionMarkerCalibration() {
				assertArCapability( capabilities, 'markerRegistration' );

				engine.resetCurrentSessionMarkerCalibration();

			},

			solveAndApplyCurrentSessionMarkerCalibration() {
				assertArCapability( capabilities, 'markerRegistration' );

				return engine.solveAndApplyCurrentSessionMarkerCalibration();

			},

			clearMarkerLocalizationCorrection() {
				assertArCapability( capabilities, 'markerRegistration' );

				engine.clearMarkerLocalizationCorrection();

			},

			resetPlacement() {

				engine.resetPlacement();

			},

			setInspectionPlacementSource(source) {

				engine.setInspectionPlacementSource( source );

			},

			enterAr() {

				return engine.enterAr();

			},

			placeModel() {
				assertArCapability( capabilities, 'modelPlacement' );

				return engine.placeModel();

			},

			exitAr() {

				engine.exitAr();

			},

			saveInspectionRecord(input) {
				assertArCapability( capabilities, 'inspectionRecord' );

				engine.saveInspectionRecord( input );

			},

			exportInspectionRecords() {
				assertArCapability( capabilities, 'inspectionRecord' );

				engine.exportInspectionRecords();

			},

			takeSnapshot() {
				assertArCapability( capabilities, 'screenshot' );

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



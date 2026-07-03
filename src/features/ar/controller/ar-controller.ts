import type {
	ArDisplayMode,
	ArPlacementMode,
	SectionCutPlaneMode,
	WorkspaceMode
} from '@/localization/core/registration-store.js';
import type { ManualAdjustmentPreset } from '@/localization/manual/manual-registration.js';
import type { ThreeEngineHosts, ThreeEngineSnapshot } from '@/engine/core/three-engine.js';
import { ThreeEngine } from '@/engine/core/three-engine.js';
import type { ArWorkflowMode } from '@/features/ar/types/workflow.js';
import type { CreateInspectionRecordInput } from '@/services/repositories/inspection-repository.js';

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
		setDisplayMode(mode: ArDisplayMode): void;
		setStructureRevealValue(value: number): void;
		setSectionCutPlaneMode(mode: SectionCutPlaneMode): void;
		activatePanel(mode: WorkspaceMode): void;
		toggleDrawer(): void;
		setTimelineStage(index: number): void;
		timelinePrev(): void;
		timelineNext(): void;
		timelinePlay(): void;
		setWorkflowMode(mode: ArWorkflowMode): void;
		enableCoarseRegistration(): Promise<void>;
		refreshGeoLocation(): Promise<void>;
		saveSiteCalibrationBaseline(): void;
		saveGpsBiasCorrectionFromCurrentPose(): Promise<void>;
		clearGpsBiasCorrection(): void;
		refreshSavedMarkerLocalization(): void;
		startCurrentSessionMarkerCalibration(): void;
		captureCurrentSessionMarkerCorner(): void;
		resetCurrentSessionMarkerCalibration(): void;
		solveAndApplyCurrentSessionMarkerCalibration(): boolean;
		clearMarkerLocalizationCorrection(): void;
		clearSavedMarkerLocalization(): void;
		resetPlacement(): void;
		setManualAdjustmentPreset(preset: ManualAdjustmentPreset): void;
		setPlacementMode(mode: ArPlacementMode): void;
		adjustTranslation(axis: 'x' | 'y' | 'z', direction: 1 | -1): void;
		adjustYaw(direction: 1 | -1): void;
		adjustScale(direction: 1 | -1): void;
		saveManualRegistration(): void;
		resetManualRegistration(): void;
		clearSavedRegistration(): void;
		enterAr(): void;
		placeModelAtHitTest(): void;
		placeModel(): Promise<void>;
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

				engine.setDisplayMode( mode );

			},

			setStructureRevealValue(value) {

				engine.setStructureRevealValue( value );

			},

			setSectionCutPlaneMode(mode) {

				engine.setSectionCutPlaneMode( mode );

			},

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

			enableCoarseRegistration() {

				return engine.enableCoarseRegistration();

			},

			refreshGeoLocation() {

				return engine.refreshGeoLocation();

			},

			saveSiteCalibrationBaseline() {

				engine.saveSiteCalibrationBaseline();

			},

			saveGpsBiasCorrectionFromCurrentPose() {

				return engine.saveGpsBiasCorrectionFromCurrentPose();

			},

			clearGpsBiasCorrection() {

				engine.clearGpsBiasCorrection();

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

			setManualAdjustmentPreset(preset) {

				engine.setManualAdjustmentPreset( preset );

			},

			setPlacementMode(mode) {

				engine.setPlacementMode( mode );

			},

			adjustTranslation(axis, direction) {

				engine.adjustTranslation( axis, direction );

			},

			adjustYaw(direction) {

				engine.adjustYaw( direction );

			},

			adjustScale(direction) {

				engine.adjustScale( direction );

			},

			saveManualRegistration() {

				engine.saveManualRegistration();

			},

			resetManualRegistration() {

				engine.resetManualRegistration();

			},

			clearSavedRegistration() {

				engine.clearSavedRegistration();

			},

			enterAr() {

				engine.enterAr();

			},

			placeModelAtHitTest() {

				engine.placeModelAtHitTest();

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

			}
		}
	};

}



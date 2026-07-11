import * as THREE from 'three';
import {
	STATIC_LAYER_NAMES
} from '@/models/catalog/model-api.js';
import type { RegistrationStore } from '@/localization/core/registration-store.js';
import type { SectionCutPlaneMode } from '@/localization/core/registration-store.js';
import type { UndergroundMaterialMode } from '@/engine/visualization/underground-display-state.js';
import type { PlacementSession } from '@/engine/placement/session.js';
import type { LayerVisibilityController } from '@/engine/visualization/layer-visibility.js';
import type { MaterialStateRuntime } from '@/engine/visualization/material-state-runtime.js';
import type { ArSectionCutController } from '@/engine/visualization/ar-section-cut.js';

interface VisualizationStateRuntimeOptions {
	store: RegistrationStore;
	placementSession: PlacementSession;
	layerVisibility: LayerVisibilityController;
	materialStateRuntime: MaterialStateRuntime;
	sectionCutController: ArSectionCutController;
	getUndergroundModelRoot(): THREE.Object3D | null;
	syncAttachmentInfoBoardVisibility(): void;
}

export class VisualizationStateRuntime {

	private lastRoot: THREE.Object3D | null | undefined;
	private lastMaterialMode: UndergroundMaterialMode | undefined;
	private lastOpacity: number | undefined;
	private lastSectionEnabled: boolean | undefined;
	private lastSectionValue: number | undefined;
	private lastSectionMode: SectionCutPlaneMode | undefined;

	constructor(private readonly options: VisualizationStateRuntimeOptions) {}

	reset(): void {

		this.restoreVisualizationControllers();
		this.lastRoot = undefined;
		this.lastMaterialMode = undefined;
		this.lastOpacity = undefined;
		this.lastSectionEnabled = undefined;
		this.lastSectionValue = undefined;
		this.lastSectionMode = undefined;

	}

	syncVisualizationState(): void {

		const state = this.options.store.getState();
		const undergroundRoot = state.appMode === 'ar-session'
			? this.options.getUndergroundModelRoot()
			: null;
		const rootDirty = this.lastRoot !== undergroundRoot;
		const materialDirty = rootDirty || this.lastMaterialMode !== state.undergroundMaterialMode || this.lastOpacity !== state.transparentXrayValue;
		const sectionEnabled = state.undergroundInspectionTool === 'section-cut';
		const sectionDirty = rootDirty || this.lastSectionEnabled !== sectionEnabled || this.lastSectionValue !== state.sectionCutValue || this.lastSectionMode !== state.sectionCutPlaneMode;

		if ( rootDirty ) this.options.materialStateRuntime.setRoot( undergroundRoot );
		if ( sectionDirty ) {
			this.options.sectionCutController.restore();
			this.options.sectionCutController.setPlaneMode( state.sectionCutPlaneMode );
			const plane = sectionEnabled ? this.options.sectionCutController.apply( undergroundRoot, state.sectionCutValue ) : null;
			this.options.materialStateRuntime.applySection( plane );
		}
		if ( materialDirty ) this.options.materialStateRuntime.applyMaterial( state.undergroundMaterialMode, state.transparentXrayValue );

		this.lastRoot = undergroundRoot;
		this.lastMaterialMode = state.undergroundMaterialMode;
		this.lastOpacity = state.transparentXrayValue;
		this.lastSectionEnabled = sectionEnabled;
		this.lastSectionValue = state.sectionCutValue;
		this.lastSectionMode = state.sectionCutPlaneMode;

	}

	applyModelLayerVisibility(): void {

		this.options.layerVisibility.applyToRoot( this.options.placementSession.getArPlacedModel() );
		this.options.syncAttachmentInfoBoardVisibility();
		const modelLayers = this.options.layerVisibility.getState();
		this.options.store.patch( {
			layerNames: modelLayers.length > 0
				? modelLayers.map( ( layer ) => layer.label )
				: STATIC_LAYER_NAMES,
			modelLayers
		} );
		this.syncVisualizationState();

	}

	restoreVisualizationControllers(): void {

		this.options.materialStateRuntime.restore();
		this.options.sectionCutController.restore();

	}

}

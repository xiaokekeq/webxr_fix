import * as THREE from 'three';
import {
	STATIC_LAYER_NAMES
} from '@/models/catalog/model-api.js';
import type { RegistrationStore } from '@/localization/core/registration-store.js';
import type { SectionCutPlaneMode } from '@/localization/core/registration-store.js';
import type { UndergroundMaterialMode } from '@/engine/visualization/underground-display-state.js';
import type { PlacementSession } from '@/engine/placement/session.js';
import type { LayerVisibilityController } from '@/engine/visualization/layer-visibility.js';
import { isArDebugEnabled } from '@/engine/debug/ar-logger.js';
import type { MaterialStateRuntime } from '@/engine/visualization/material-state-runtime.js';
import type { ArLayerPeelingController } from '@/engine/visualization/ar-layer-peeling.js';
import type { ArSectionCutController } from '@/engine/visualization/ar-section-cut.js';

interface VisualizationStateRuntimeOptions {
	store: RegistrationStore;
	placementSession: PlacementSession;
	layerVisibility: LayerVisibilityController;
	materialStateRuntime: MaterialStateRuntime;
	layerPeelingController: ArLayerPeelingController;
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
	private lastLayerEnabled: boolean | undefined;
	private lastLayerValue: number | undefined;
	private lastLayers: unknown;

	constructor(private readonly options: VisualizationStateRuntimeOptions) {}

	reset(): void {

		this.restoreVisualizationControllers();
		this.lastRoot = undefined;
		this.lastMaterialMode = undefined;
		this.lastOpacity = undefined;
		this.lastSectionEnabled = undefined;
		this.lastSectionValue = undefined;
		this.lastSectionMode = undefined;
		this.lastLayerEnabled = undefined;
		this.lastLayerValue = undefined;
		this.lastLayers = undefined;

	}

	syncVisualizationState(): void {

		const state = this.options.store.getState();
		const undergroundRoot = state.appMode === 'ar-session'
			? this.options.getUndergroundModelRoot()
			: null;
		const rootDirty = this.lastRoot !== undergroundRoot;
		const materialDirty = rootDirty || this.lastMaterialMode !== state.undergroundMaterialMode || this.lastOpacity !== state.transparentXrayValue;
		const sectionDirty = rootDirty || this.lastSectionEnabled !== state.sectionCutEnabled || this.lastSectionValue !== state.sectionCutValue || this.lastSectionMode !== state.sectionCutPlaneMode;
		const layerDirty = rootDirty || this.lastLayerEnabled !== state.layerPeelingEnabled || this.lastLayerValue !== state.layerPeelingValue || this.lastLayers !== state.modelLayers;

		if ( rootDirty ) this.options.materialStateRuntime.setRoot( undergroundRoot );
		if ( sectionDirty ) {
			this.options.sectionCutController.restore();
			this.options.sectionCutController.setPlaneMode( state.sectionCutPlaneMode );
			const plane = state.sectionCutEnabled ? this.options.sectionCutController.apply( undergroundRoot, state.sectionCutValue ) : null;
			this.options.materialStateRuntime.applySection( plane );
		}
		if ( materialDirty ) this.options.materialStateRuntime.applyMaterial( state.undergroundMaterialMode, state.transparentXrayValue );
		if ( layerDirty && state.layerPeelingEnabled ) {
				const report = this.options.layerPeelingController.apply( state.layerPeelingValue, state.modelLayers );
				if ( isArDebugEnabled() ) console.info( '[LayerPeeling]', {
					value: report.value,
					totalLayerCount: report.totalLayerCount,
					hiddenLayerCount: report.hiddenLayerCount,
					visibleLayerCount: report.visibleLayerCount,
					hiddenLayerIds: report.hiddenLayerIds,
					visibleLayerIds: report.visibleLayerIds
				} );
		}

		this.lastRoot = undergroundRoot;
		this.lastMaterialMode = state.undergroundMaterialMode;
		this.lastOpacity = state.transparentXrayValue;
		this.lastSectionEnabled = state.sectionCutEnabled;
		this.lastSectionValue = state.sectionCutValue;
		this.lastSectionMode = state.sectionCutPlaneMode;
		this.lastLayerEnabled = state.layerPeelingEnabled;
		this.lastLayerValue = state.layerPeelingValue;
		this.lastLayers = state.modelLayers;

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
		this.options.layerPeelingController.restore();
		this.options.sectionCutController.restore();

	}

}

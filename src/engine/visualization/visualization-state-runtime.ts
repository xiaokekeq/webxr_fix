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
import type { TexturedEnclosureShell } from '@/engine/visualization/textured-enclosure-shell.js';
import type { SectionCapRuntime } from '@/engine/visualization/section-cap-runtime.js';

interface VisualizationStateRuntimeOptions {
	store: RegistrationStore;
	placementSession: PlacementSession;
	layerVisibility: LayerVisibilityController;
	materialStateRuntime: MaterialStateRuntime;
	sectionCutController: ArSectionCutController;
	enclosureShell: TexturedEnclosureShell;
	sectionCapRuntime: SectionCapRuntime;
	getActiveModelSourceUuid(): string | null;
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
	private previousLayerVisibilitySignature = '';
	private sectionPlane: THREE.Plane | null = null;
	private lastSectionPlaneSignature = '';

	constructor(private readonly options: VisualizationStateRuntimeOptions) {}

	reset(): void {

		this.restoreVisualizationControllers();
		this.lastRoot = undefined;
		this.lastMaterialMode = undefined;
		this.lastOpacity = undefined;
		this.lastSectionEnabled = undefined;
		this.lastSectionValue = undefined;
		this.lastSectionMode = undefined;
		this.previousLayerVisibilitySignature = '';
		this.sectionPlane = null;
		this.lastSectionPlaneSignature = '';

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
		}
		this.sectionPlane = sectionEnabled ? this.options.sectionCutController.apply( undergroundRoot, state.sectionCutValue ) : null;
		const sectionPlaneSignature = getSectionPlaneSignature( this.sectionPlane );
		const sectionPlaneDirty = sectionPlaneSignature !== this.lastSectionPlaneSignature;
		if ( sectionDirty || sectionPlaneDirty ) this.options.materialStateRuntime.applySection( this.sectionPlane );
		if ( materialDirty ) this.options.materialStateRuntime.applyMaterial( state.undergroundMaterialMode, state.transparentXrayValue );
		this.options.enclosureShell.sync( undergroundRoot, state.undergroundInspectionTool );
		this.options.sectionCapRuntime.sync( undergroundRoot, this.sectionPlane, {
			geometryDirty: sectionDirty || sectionPlaneDirty,
			materialDirty,
			sourceModelUuid: this.options.getActiveModelSourceUuid(),
			materialMode: state.undergroundMaterialMode,
			opacity: state.transparentXrayValue
		} );

		this.lastRoot = undergroundRoot;
		this.lastMaterialMode = state.undergroundMaterialMode;
		this.lastOpacity = state.transparentXrayValue;
		this.lastSectionEnabled = sectionEnabled;
		this.lastSectionValue = state.sectionCutValue;
		this.lastSectionMode = state.sectionCutPlaneMode;
		this.lastSectionPlaneSignature = sectionPlaneSignature;

	}

	applyModelLayerVisibility(): { changed: boolean; changedObjectCount: number; visibilitySignature: string } {

		const root = this.options.placementSession.getArPlacedModel();
		const before = new Map<string, boolean>();
		root?.traverse( ( object ) => before.set( object.uuid, object.visible ) );
		this.options.layerVisibility.applyToRoot( root );
		this.options.syncAttachmentInfoBoardVisibility();
		const modelLayers = this.options.layerVisibility.getState();
		let changedObjectCount = 0;
		root?.traverse( ( object ) => { if ( before.get( object.uuid ) !== object.visible ) changedObjectCount += 1; } );
		const state = this.options.store.getState();
		const visibilitySignature = JSON.stringify( {
			modelUuid: root?.uuid ?? 'none', undergroundInspectionTool: state.undergroundInspectionTool,
			hiddenLayerCount: modelLayers.filter( ( layer ) => layer.visible === false ).length,
			sectionCutMode: state.sectionCutPlaneMode, sectionCutValue: state.sectionCutValue,
			layers: modelLayers.map( ( layer ) => [ layer.id, layer.visible ] ),
			objects: root === null ? [] : [ ...before.keys() ].sort().map( ( uuid ) => [ uuid, root.getObjectByProperty( 'uuid', uuid )?.visible ] )
		} );
		const changed = changedObjectCount > 0 || visibilitySignature !== this.previousLayerVisibilitySignature;
		this.previousLayerVisibilitySignature = visibilitySignature;
		if ( changed ) this.options.sectionCapRuntime.sync( root, this.sectionPlane, {
			geometryDirty: true,
			sourceModelUuid: this.options.getActiveModelSourceUuid(),
			materialMode: state.undergroundMaterialMode,
			opacity: state.transparentXrayValue
		} );
		const nextPatch = {
			layerNames: modelLayers.length > 0
				? modelLayers.map( ( layer ) => layer.label )
				: STATIC_LAYER_NAMES,
			modelLayers
		};
		if ( JSON.stringify( { layerNames: state.layerNames, modelLayers: state.modelLayers } ) !== JSON.stringify( nextPatch ) ) this.options.store.patch( nextPatch );
		this.syncVisualizationState();
		return { changed, changedObjectCount, visibilitySignature };

	}

	restoreVisualizationControllers(): void {

		this.options.materialStateRuntime.restore();
		this.options.sectionCutController.restore();
		this.options.sectionCapRuntime.hide();

	}

}

function getSectionPlaneSignature(plane: THREE.Plane | null): string {

	if ( plane === null ) return 'none';
	return [ ...plane.normal.toArray().map( ( value ) => value.toFixed( 5 ) ), plane.constant.toFixed( 5 ) ].join( ':' );

}

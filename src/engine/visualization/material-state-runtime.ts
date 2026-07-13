import * as THREE from 'three';
import { forEachMaterial, rememberMaterialSnapshot, restoreMaterialSnapshot, type VisualizationMaterialSnapshot } from './material-visualization-state.js';
import { mapXrayOpacityValue } from './adjustment-value-mappers.js';

interface MaterialRuntimeRecord {
	original: VisualizationMaterialSnapshot;
	runtimeSectionPlane: THREE.Plane;
	combinedClippingPlanes: THREE.Plane[];
}

export class MaterialStateRuntime {

	private readonly snapshots = new WeakMap<THREE.Material, VisualizationMaterialSnapshot>();
	private readonly records = new WeakMap<THREE.Material, MaterialRuntimeRecord>();
	private readonly processedMaterials = new Set<THREE.Material>();
	private currentRoot: THREE.Object3D | null = null;
	private clippingPlane: THREE.Plane | null = null;

	setRoot(root: THREE.Object3D | null): boolean {

		if ( root === this.currentRoot ) return false;
		if ( this.currentRoot !== null ) this.restoreRoot( this.currentRoot );
		this.currentRoot = root;
		return true;

	}

	applyMaterial(mode: 'solid' | 'xray', opacity: number): void {

		this.forEachUniqueControlledMaterial( ( material, record ) => {
			const xrayActive = mode === 'xray' && opacity < 100;
			const transparent = xrayActive || record.original.transparent;
			const side = this.clippingPlane === null ? record.original.side : THREE.DoubleSide;
			const clippingCount = material.clippingPlanes?.length ?? 0;
			const nextClippingCount = this.clippingPlane === null ? record.original.clippingPlanes?.length ?? 0 : record.combinedClippingPlanes.length;
			const needsUpdate = material.transparent !== transparent || material.side !== side || clippingCount !== nextClippingCount;
			material.transparent = transparent;
			material.opacity = xrayActive ? mapXrayOpacityValue( opacity ) : record.original.opacity;
			material.depthWrite = xrayActive ? false : record.original.depthWrite;
			material.depthTest = xrayActive ? true : record.original.depthTest;
			material.side = side;
			if ( needsUpdate ) material.needsUpdate = true;
		} );

	}

	applySection(clippingPlane: THREE.Plane | null): void {

		this.clippingPlane = clippingPlane;
		this.forEachUniqueControlledMaterial( ( material, record ) => {
			const previousCount = material.clippingPlanes?.length ?? 0;
			const nextPlanes = clippingPlane === null ? record.original.clippingPlanes : record.combinedClippingPlanes;
			const side = clippingPlane === null ? record.original.side : THREE.DoubleSide;
			const needsUpdate = previousCount !== ( nextPlanes?.length ?? 0 ) || material.side !== side;
			material.side = side;
			if ( clippingPlane === null ) {
				material.clippingPlanes = record.original.clippingPlanes;
				material.clipIntersection = record.original.clipIntersection;
				material.clipShadows = record.original.clipShadows;
			} else {
				record.runtimeSectionPlane.copy( clippingPlane );
				material.clippingPlanes = record.combinedClippingPlanes;
				material.clipIntersection = false;
				material.clipShadows = false;
			}
			if ( needsUpdate ) material.needsUpdate = true;
		} );

	}

	restore(): void {

		if ( this.currentRoot !== null ) this.restoreRoot( this.currentRoot );
		this.currentRoot = null;
		this.clippingPlane = null;
		this.processedMaterials.clear();

	}

	dispose(): void { this.restore(); }

	private forEachUniqueControlledMaterial(callback: (material: THREE.Material, record: MaterialRuntimeRecord) => void): void {

		this.processedMaterials.clear();
		this.currentRoot?.traverse( ( object ) => {
			if ( object instanceof THREE.Mesh === false || shouldAffectMesh( object ) === false ) return;
			forEachMaterial( object.material, ( material ) => {
				if ( this.processedMaterials.has( material ) ) return;
				this.processedMaterials.add( material );
				callback( material, this.getRecord( material ) );
			} );
		} );

	}

	private getRecord(material: THREE.Material): MaterialRuntimeRecord {

		const existing = this.records.get( material );
		if ( existing !== undefined ) return existing;
		rememberMaterialSnapshot( this.snapshots, material );
		const original = this.snapshots.get( material )!;
		const runtimeSectionPlane = new THREE.Plane();
		const record = { original, runtimeSectionPlane, combinedClippingPlanes: [ ...( original.clippingPlanes ?? [] ), runtimeSectionPlane ] };
		this.records.set( material, record );
		return record;

	}

	private restoreRoot(root: THREE.Object3D): void {

		this.processedMaterials.clear();
		root.traverse( ( object ) => {
			if ( object instanceof THREE.Mesh === false ) return;
			forEachMaterial( object.material, ( material ) => {
				if ( this.processedMaterials.has( material ) ) return;
				this.processedMaterials.add( material );
				restoreMaterialSnapshot( this.snapshots, material );
			} );
		} );

	}

}

function shouldAffectMesh(mesh: THREE.Mesh): boolean {

	return mesh.userData.__enclosureShell !== true && mesh.userData.__nonSelectableHelper !== true && mesh.userData.__visualizationHelper !== true && mesh.userData.__excludeFromLayerIndex !== true;

}

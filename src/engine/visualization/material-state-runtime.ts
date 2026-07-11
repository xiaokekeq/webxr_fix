import * as THREE from 'three';
import { forEachMaterial, rememberMaterialSnapshot, restoreMaterialSnapshot, type VisualizationMaterialSnapshot } from './material-visualization-state.js';

export interface ComposedMaterialState {
	mode: 'solid' | 'xray';
	opacity: number;
	clippingPlane: THREE.Plane | null;
}

export class MaterialStateRuntime {

	private readonly snapshots = new WeakMap<THREE.Material, VisualizationMaterialSnapshot>();
	private currentRoot: THREE.Object3D | null = null;

	apply(root: THREE.Object3D | null, state: ComposedMaterialState): void {

		if ( this.currentRoot !== null && this.currentRoot !== root ) this.restoreRoot( this.currentRoot );
		this.currentRoot = root;
		if ( root === null ) return;
		root.traverse( ( object ) => {
			if ( object instanceof THREE.Mesh === false || shouldAffectMesh( object ) === false ) return;
			forEachMaterial( object.material, ( material ) => {
				rememberMaterialSnapshot( this.snapshots, material );
				restoreMaterialSnapshot( this.snapshots, material );
				if ( state.mode === 'xray' ) {
					material.transparent = true;
					material.opacity = THREE.MathUtils.clamp( state.opacity / 100, 0, 1 );
					material.depthWrite = false;
					material.depthTest = true;
				}
				if ( state.clippingPlane !== null ) {
					material.side = THREE.DoubleSide;
					material.clippingPlanes = [ state.clippingPlane.clone() ];
					material.clipIntersection = false;
					material.clipShadows = false;
				}
				material.needsUpdate = true;
			} );
		} );

	}

	restore(): void {

		if ( this.currentRoot !== null ) this.restoreRoot( this.currentRoot );
		this.currentRoot = null;

	}

	dispose(): void { this.restore(); }

	private restoreRoot(root: THREE.Object3D): void {

		root.traverse( ( object ) => {
			if ( object instanceof THREE.Mesh ) forEachMaterial( object.material, ( material ) => restoreMaterialSnapshot( this.snapshots, material ) );
		} );

	}

}

function shouldAffectMesh(mesh: THREE.Mesh): boolean {

	return mesh.userData.__nonSelectableHelper !== true
		&& mesh.userData.__excludeFromLayerIndex !== true
		&& mesh.userData.__visualizationHelper !== true;

}

import * as THREE from 'three';
import { forEachMaterial, rememberMaterialSnapshot, restoreMaterialSnapshot, type VisualizationMaterialSnapshot } from './material-visualization-state.js';

export interface ComposedMaterialState {
	mode: 'solid' | 'xray';
	opacity: number;
	clippingPlane: THREE.Plane | null;
}

export class MaterialStateRuntime {

	private readonly snapshots = new WeakMap<THREE.Material, VisualizationMaterialSnapshot>();
	private readonly clippingPlanes = new WeakMap<THREE.Material, [ THREE.Plane ]>();
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
					let planes = this.clippingPlanes.get( material );
					if ( planes === undefined ) {
						planes = [ new THREE.Plane() ];
						this.clippingPlanes.set( material, planes );
					}
					planes[ 0 ].copy( state.clippingPlane );
					material.clippingPlanes = planes;
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

if ( import.meta.env.DEV ) runMaterialStateSelfCheck();

function runMaterialStateSelfCheck(): void {

	const material = new THREE.MeshBasicMaterial( { transparent: false, opacity: 0.8, depthWrite: true } );
	const root = new THREE.Group();
	root.add( new THREE.Mesh( new THREE.BoxGeometry(), material ) );
	const runtime = new MaterialStateRuntime();
	const plane = new THREE.Plane( new THREE.Vector3( 0, 1, 0 ), -1 );
	runtime.apply( root, { mode: 'xray', opacity: 35, clippingPlane: plane } );
	const clippingArray = material.clippingPlanes;
	runtime.apply( root, { mode: 'solid', opacity: 35, clippingPlane: plane.set( new THREE.Vector3( 1, 0, 0 ), -2 ) } );
	console.assert( material.transparent === false && material.opacity === 0.8 && material.depthWrite === true, 'Solid + section must restore original opacity state.' );
	console.assert( material.clippingPlanes === clippingArray && material.clippingPlanes?.[ 0 ].normal.x === 1, 'Section updates must reuse the clipping plane array.' );
	runtime.apply( root, { mode: 'xray', opacity: 20, clippingPlane: null } );
	console.assert( material.transparent && material.opacity === 0.2 && material.clippingPlanes === null, 'X-ray without section must remove composed clipping.' );
	runtime.restore();
	console.assert( material.transparent === false && material.opacity === 0.8 && material.depthWrite === true && material.clippingPlanes === null, 'Material restore must return the original state.' );
	root.children[ 0 ].traverse( ( object ) => {
		if ( object instanceof THREE.Mesh ) object.geometry.dispose();
	} );
	material.dispose();

}

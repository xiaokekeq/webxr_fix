import * as THREE from 'three';
import { forEachMaterial, rememberMaterialSnapshot, restoreMaterialSnapshot, type VisualizationMaterialSnapshot } from './material-visualization-state.js';

export class MaterialStateRuntime {

	private readonly snapshots = new WeakMap<THREE.Material, VisualizationMaterialSnapshot>();
	private readonly clippingPlanes = new WeakMap<THREE.Material, [ THREE.Plane ]>();
	private currentRoot: THREE.Object3D | null = null;
	private clippingPlane: THREE.Plane | null = null;

	setRoot(root: THREE.Object3D | null): boolean {

		if ( root === this.currentRoot ) return false;
		if ( this.currentRoot !== null ) this.restoreRoot( this.currentRoot );
		this.currentRoot = root;
		return true;

	}

	applyMaterial(mode: 'solid' | 'xray', opacity: number): void {

		this.forEachControlledMaterial( ( material, snapshot ) => {
			const transparent = mode === 'xray' ? true : snapshot.transparent;
			const depthWrite = mode === 'xray' ? false : snapshot.depthWrite;
			const depthTest = mode === 'xray' ? true : snapshot.depthTest;
			const side = this.clippingPlane === null ? snapshot.side : THREE.DoubleSide;
			const needsUpdate = material.transparent !== transparent || material.depthWrite !== depthWrite || material.depthTest !== depthTest || material.side !== side;
			material.transparent = transparent;
			material.opacity = mode === 'xray' ? THREE.MathUtils.clamp( opacity / 100, 0, 1 ) : snapshot.opacity;
			material.depthWrite = depthWrite;
			material.depthTest = depthTest;
			material.side = side;
			if ( needsUpdate ) material.needsUpdate = true;
		} );

	}

	applySection(clippingPlane: THREE.Plane | null): void {

		this.clippingPlane = clippingPlane;
		this.forEachControlledMaterial( ( material, snapshot ) => {
			const wasComposed = material.clippingPlanes === this.clippingPlanes.get( material );
			const side = clippingPlane === null ? snapshot.side : THREE.DoubleSide;
			const needsUpdate = wasComposed !== ( clippingPlane !== null ) || material.side !== side;
			material.side = side;
			if ( clippingPlane === null ) {
				material.clippingPlanes = snapshot.clippingPlanes;
				material.clipIntersection = snapshot.clipIntersection;
				material.clipShadows = snapshot.clipShadows;
			} else {
				let planes = this.clippingPlanes.get( material );
				if ( planes === undefined ) {
					planes = [ new THREE.Plane() ];
					this.clippingPlanes.set( material, planes );
				}
				planes[ 0 ].copy( clippingPlane );
				material.clippingPlanes = planes;
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

	}

	dispose(): void { this.restore(); }

	private forEachControlledMaterial(callback: (material: THREE.Material, snapshot: VisualizationMaterialSnapshot) => void): void {

		this.currentRoot?.traverse( ( object ) => {
			if ( object instanceof THREE.Mesh === false || shouldAffectMesh( object ) === false ) return;
			forEachMaterial( object.material, ( material ) => {
				rememberMaterialSnapshot( this.snapshots, material );
				callback( material, this.snapshots.get( material )! );
			} );
		} );

	}

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

if ( import.meta.env.DEV ) {
	const material = new THREE.MeshBasicMaterial( { opacity: 0.8 } );
	const root = new THREE.Group().add( new THREE.Mesh( new THREE.BoxGeometry(), material ) );
	const runtime = new MaterialStateRuntime();
	const plane = new THREE.Plane( new THREE.Vector3( 0, 1, 0 ), -1 );
	runtime.setRoot( root );
	runtime.applySection( plane );
	runtime.applyMaterial( 'xray', 30 );
	const planes = material.clippingPlanes;
	runtime.applyMaterial( 'solid', 30 );
	runtime.applySection( plane.set( new THREE.Vector3( 1, 0, 0 ), -2 ) );
	console.assert( material.opacity === 0.8 && material.transparent === false, 'Solid + section must preserve the original material appearance.' );
	console.assert( material.clippingPlanes === planes && planes?.[ 0 ].normal.x === 1, 'Section slider updates must reuse clipping objects.' );
	runtime.applySection( null );
	runtime.restore();
	console.assert( material.clippingPlanes === null && material.opacity === 0.8, 'Disabling section must restore original clipping and opacity.' );
	( root.children[ 0 ] as THREE.Mesh ).geometry.dispose();
	material.dispose();
}

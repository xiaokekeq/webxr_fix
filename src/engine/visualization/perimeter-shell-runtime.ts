import * as THREE from 'three';

export class PerimeterShellRuntime {
	private buildCount = 0;
	private lastBuildReason = 'none';
	register(result: { root: THREE.Group; meshCount: number; triangleCount: number; materialCount: number }, reason: string): void { this.buildCount += 1; this.lastBuildReason = reason; result.root.visible = false; if ( import.meta.env.VITE_AR_DEBUG === 'true' ) console.info( '[PerimeterShell]', { ...this.getDebug( result.root, false ), layerMeshCount: 0, visibleLayerCount: 0, hiddenLayerCount: 0 } ); }
	sync(root: THREE.Object3D | null, visible: boolean): void { root?.traverse( ( object ) => { if ( object.userData.__perimeterShell === true ) object.visible = visible; } ); }
	getDebug(root: THREE.Object3D | null, visible: boolean) { let meshCount = 0; let triangles = 0; let materials = new Set<THREE.Material>(); root?.traverse( ( object ) => { if ( object instanceof THREE.Mesh && object.userData.__perimeterShell === true ) { meshCount += 1; triangles += object.geometry.getAttribute( 'position' ).count / 3; const material = Array.isArray( object.material ) ? object.material : [ object.material ]; material.forEach( ( item ) => materials.add( item ) ); } } ); return { perimeterShellExists: meshCount > 0, perimeterShellVisible: visible, perimeterShellMeshCount: meshCount, perimeterShellTriangleCount: triangles, perimeterShellMaterialCount: materials.size, perimeterShellBuildCount: this.buildCount, perimeterShellLastBuildReason: this.lastBuildReason, perimeterShellMode: visible ? 'layer-peeling' : 'complete', perimeterShellPolygonOffsetEnabled: meshCount > 0 }; }
}

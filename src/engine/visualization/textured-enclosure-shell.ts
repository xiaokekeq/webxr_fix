import * as THREE from 'three';
import type { EnclosureShellBuildResult } from './enclosure-shell-builder.js';

export class TexturedEnclosureShell {
	private buildCount = 0;
	private lastBuildReason = 'none';
	private root: THREE.Group | null = null;
	register(result: EnclosureShellBuildResult, reason: string): void { this.dispose(); this.root = result.root; this.buildCount += 1; this.lastBuildReason = reason; result.root.visible = false; result.root.userData.enclosureMaterialSources = result.materialSources; }
	sync(root: THREE.Object3D | null, mode: 'complete' | 'layer-peeling' | 'section-cut'): void { root?.traverse( ( object ) => { if ( object.userData.__enclosureShell === true ) object.visible = mode !== 'complete'; } ); }
	dispose(): void {
		if ( this.root === null ) return;
		this.root.removeFromParent();
		this.root.traverse( ( object ) => { if ( object instanceof THREE.Mesh ) { object.geometry.dispose(); const materials = Array.isArray( object.material ) ? object.material : [ object.material ]; materials.forEach( ( material ) => { const map = ( material as THREE.Material & { map?: THREE.Texture } ).map; if ( map?.userData.__enclosureOwnedTexture === true ) map.dispose(); material.dispose(); } ); } } );
		this.root = null;
	}
	getDebug(root: THREE.Object3D | null, mode: 'complete' | 'layer-peeling' | 'section-cut') {
		let meshCount = 0; let triangleCount = 0; const materials = new Set<THREE.Material>(); let sources: Record<string, string> = {};
		root?.traverse( ( object ) => { if ( object instanceof THREE.Mesh && object.userData.__enclosureShell === true ) { meshCount += 1; triangleCount += ( object.geometry.getIndex()?.count ?? object.geometry.getAttribute( 'position' ).count ) / 3; const material = Array.isArray( object.material ) ? object.material : [ object.material ]; material.forEach( ( item ) => materials.add( item ) ); sources[ String( object.userData.enclosureFace ) ] = String( object.userData.materialSource ); } } );
		return { enclosureShellExists: meshCount > 0, enclosureShellVisible: mode !== 'complete', enclosureShellMeshCount: meshCount, enclosureShellFaceCount: meshCount, enclosureShellTriangleCount: triangleCount, enclosureShellMaterialCount: materials.size, enclosureShellBuildCount: this.buildCount, enclosureShellLastBuildReason: this.lastBuildReason, enclosureShellTopOpen: true, enclosureShellBottomEnabled: meshCount > 0, enclosureShellClippingEnabled: mode === 'section-cut', enclosureShellMode: mode, frontMaterialSource: sources.front, backMaterialSource: sources.back, leftMaterialSource: sources.left, rightMaterialSource: sources.right, bottomMaterialSource: sources.bottom };
	}
}

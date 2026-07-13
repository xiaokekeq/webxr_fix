import * as THREE from 'three';
import {
	buildEnclosureShell,
	type EnclosureOffscreenRenderer,
	type EnclosureShellBuildResult
} from './enclosure-shell-builder.js';

export type EnclosureRebuildOutcome =
	| { ok: true; rebuilt: boolean }
	| Extract<EnclosureShellBuildResult, { ok: false }>;

interface EnclosureRebuildOptions {
	model: THREE.Object3D;
	modelRevision?: number;
	renderer: EnclosureOffscreenRenderer;
	lightingScene?: THREE.Scene;
}

export class TexturedEnclosureShell {

	private root: THREE.Group | null = null;
	private renderTargets: THREE.WebGLRenderTarget[] = [];
	private sourceModelUuid: string | null = null;
	private sourceRevision = - 1;

	rebuildForModel(options: EnclosureRebuildOptions): EnclosureRebuildOutcome {

		const sourceRevision = options.modelRevision ?? 0;
		if ( this.sourceModelUuid === options.model.uuid && this.sourceRevision === sourceRevision ) {
			return { ok: true, rebuilt: false };
		}

		options.model.updateWorldMatrix( true, true );
		this.dispose();
		const result = buildEnclosureShell( options.model, options );
		if ( result.ok === false ) return result;

		this.root = result.root;
		this.renderTargets = result.renderTargets;
		this.root.visible = false;
		this.sourceModelUuid = options.model.uuid;
		this.sourceRevision = sourceRevision;
		return { ok: true, rebuilt: true };

	}

	sync(root: THREE.Object3D | null, mode: 'complete' | 'layer-peeling' | 'section-cut'): void {

		root?.traverse( ( object ) => {
			if ( object instanceof THREE.Group && object.userData.__enclosureShell === true ) {
				object.visible = mode !== 'complete';
			}
		} );

	}

	dispose(): void {

		if ( this.root !== null ) {
			this.root.removeFromParent();
			this.root.traverse( ( object ) => {
				if ( object instanceof THREE.Mesh === false ) return;
				object.geometry.dispose();
				const materials = Array.isArray( object.material ) ? object.material : [ object.material ];
				materials.forEach( ( material ) => {
					const map = ( material as THREE.Material & { map?: THREE.Texture } ).map;
					if ( map?.userData.__enclosureOwnedTexture === true ) map.dispose();
					material.dispose();
				} );
			} );
		}
		this.renderTargets.forEach( ( target ) => target.dispose() );
		this.renderTargets = [];
		this.root = null;
		this.sourceModelUuid = null;
		this.sourceRevision = - 1;

	}

}

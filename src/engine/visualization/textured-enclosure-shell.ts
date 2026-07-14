import * as THREE from 'three';
import {
	DEFAULT_ENCLOSURE_SHELL_SOURCE,
	type EnclosureShellConfig,
	type EnclosureShellSource
} from '@/models/config/demo-model-config.js';
import {
	buildEnclosureShell,
	type EnclosureShellBuildResult
} from './enclosure-shell-builder.js';

export type ExplicitEnclosureShellFailureReason =
	| 'object-name-missing'
	| 'object-not-found'
	| 'object-has-no-mesh'
	| 'invalid-geometry';

export type ExplicitEnclosureShellResult =
	| { ok: true; object: THREE.Object3D }
	| { ok: false; reason: ExplicitEnclosureShellFailureReason; message: string };

export type EnclosureRebuildOutcome =
	| { ok: true; rebuilt: boolean; source: EnclosureShellSource }
	| Extract<EnclosureShellBuildResult, { ok: false }>
	| Extract<ExplicitEnclosureShellResult, { ok: false }>;

interface EnclosureRebuildOptions {
	model: THREE.Object3D;
	modelRevision?: number;
	enclosureShell?: EnclosureShellConfig;
}

export class TexturedEnclosureShell {

	private root: THREE.Group | null = null;
	private sourceModelUuid: string | null = null;
	private sourceRevision = - 1;
	private sourceSignature = '';

	prepareModel(model: THREE.Object3D, enclosureShell?: EnclosureShellConfig): void {

		const config = normalizeEnclosureShellConfig( enclosureShell );
		if ( config.source === 'auto' ) return;

		this.dispose();
		if ( config.source === 'disabled' ) return;

		const result = resolveExplicitEnclosureShell( model, config.objectName );
		if ( result.ok ) result.object.visible = false;

	}

	rebuildForModel(options: EnclosureRebuildOptions): EnclosureRebuildOutcome {

		const config = normalizeEnclosureShellConfig( options.enclosureShell );
		const sourceRevision = options.modelRevision ?? 0;
		const sourceSignature = `${config.source}:${config.objectName ?? ''}`;
		if (
			this.sourceModelUuid === options.model.uuid
			&& this.sourceRevision === sourceRevision
			&& this.sourceSignature === sourceSignature
		) {
			return { ok: true, rebuilt: false, source: config.source };
		}

		this.dispose();
		if ( config.source === 'disabled' ) {
			this.rememberSource( options.model, sourceRevision, sourceSignature );
			return { ok: true, rebuilt: false, source: config.source };
		}

		if ( config.source === 'model-object' ) {
			const result = resolveExplicitEnclosureShell( options.model, config.objectName );
			if ( result.ok === false ) return result;

			result.object.visible = false;
			this.rememberSource( options.model, sourceRevision, sourceSignature );
			return { ok: true, rebuilt: false, source: config.source };
		}

		options.model.updateWorldMatrix( true, true );
		const result = buildEnclosureShell( options.model );
		if ( result.ok === false ) return result;

		this.root = result.root;
		this.root.visible = false;
		this.root.userData.__enclosureShellShowInSectionCut = true;
		this.rememberSource( options.model, sourceRevision, sourceSignature );
		return { ok: true, rebuilt: true, source: config.source };

	}

	sync(root: THREE.Object3D | null, mode: 'complete' | 'layer-peeling' | 'section-cut'): void {

		root?.traverse( ( object ) => {
			if ( object.userData.__enclosureShell !== true || object.parent?.userData.__enclosureShell === true ) return;
			object.visible = mode === 'layer-peeling'
				|| mode === 'section-cut' && object.userData.__enclosureShellShowInSectionCut === true;
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
		this.root = null;
		this.sourceModelUuid = null;
		this.sourceRevision = - 1;
		this.sourceSignature = '';

	}

	private rememberSource(model: THREE.Object3D, revision: number, signature: string): void {

		this.sourceModelUuid = model.uuid;
		this.sourceRevision = revision;
		this.sourceSignature = signature;

	}

}

export function resolveExplicitEnclosureShell(
	modelRoot: THREE.Object3D,
	objectName: string | undefined
): ExplicitEnclosureShellResult {

	const name = objectName?.trim();
	if ( name === undefined || name.length === 0 ) {
		return { ok: false, reason: 'object-name-missing', message: 'An explicit enclosure shell requires objectName.' };
	}

	const object = modelRoot.getObjectByName( name );
	if ( object === undefined ) {
		return { ok: false, reason: 'object-not-found', message: `No model object is named "${name}".` };
	}

	const meshes: THREE.Mesh[] = [];
	object.traverse( ( child ) => {
		if ( child instanceof THREE.Mesh ) meshes.push( child );
	} );
	if ( meshes.length === 0 ) {
		return { ok: false, reason: 'object-has-no-mesh', message: `Model object "${name}" has no mesh.` };
	}

	modelRoot.updateWorldMatrix( true, true );
	const bounds = new THREE.Box3();
	for ( const mesh of meshes ) {
		if ( addMeshBounds( mesh, bounds ) === false ) {
			return { ok: false, reason: 'invalid-geometry', message: `Model object "${name}" has invalid mesh geometry.` };
		}
	}
	if ( bounds.isEmpty() ) {
		return { ok: false, reason: 'invalid-geometry', message: `Model object "${name}" has invalid bounds.` };
	}

	applyExplicitShellFlags( object );
	meshes.forEach( applyExplicitShellFlags );
	return { ok: true, object };

}

function normalizeEnclosureShellConfig(value: EnclosureShellConfig | undefined): EnclosureShellConfig {

	return value ?? { source: DEFAULT_ENCLOSURE_SHELL_SOURCE };

}

function addMeshBounds(mesh: THREE.Mesh, bounds: THREE.Box3): boolean {

	const position = mesh.geometry.getAttribute( 'position' );
	if (
		position === undefined
		|| position.itemSize < 3
		|| Number.isInteger( position.count ) === false
		|| position.count < 3
	) {
		return false;
	}

	const index = mesh.geometry.getIndex();
	const triangleCount = index === null ? Math.floor( position.count / 3 ) : Math.floor( index.count / 3 );
	if ( triangleCount === 0 ) return false;
	if ( index !== null ) {
		for ( let offset = 0; offset < triangleCount * 3; offset += 1 ) {
			const vertexIndex = index.getX( offset );
			if ( Number.isInteger( vertexIndex ) === false || vertexIndex < 0 || vertexIndex >= position.count ) return false;
		}
	}

	const vertex = new THREE.Vector3();
	for ( let index = 0; index < position.count; index += 1 ) {
		vertex.fromBufferAttribute( position, index ).applyMatrix4( mesh.matrixWorld );
		if ( Number.isFinite( vertex.x ) === false || Number.isFinite( vertex.y ) === false || Number.isFinite( vertex.z ) === false ) return false;
		bounds.expandByPoint( vertex );
	}

	return true;

}

function applyExplicitShellFlags(object: THREE.Object3D): void {

	object.userData.__modelConformingShell = true;
	object.userData.__enclosureShell = true;
	object.userData.__excludeFromLayerIndex = true;
	object.userData.__excludeFromPicking = true;
	object.userData.__excludeFromSectionCap = true;
	object.userData.__excludeFromBoundarySurface = true;

}

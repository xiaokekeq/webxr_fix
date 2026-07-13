import * as THREE from 'three';
import { buildEnclosureShell, type EnclosureShellBuildResult } from './enclosure-shell-builder.js';

export type EnclosureRebuildOutcome =
	| { ok: true; rebuilt: boolean }
	| Extract<EnclosureShellBuildResult, { ok: false }>;

interface EnclosureRebuildOptions {
	model: THREE.Object3D;
	modelName?: string;
	reason: string;
	modelRevision?: number;
	structureRevision?: number;
	transformRevision?: number;
}

export class TexturedEnclosureShell {
	private buildCount = 0;
	private buildSkipCount = 0;
	private lastBuildReason = 'none';
	private lastBuildSkipReason = 'none';
	private buildRequestId = 0;
	private buildCompletedRequestId = 0;
	private sourceModelUuid: string | null = null;
	private sourceModelName: string | null = null;
	private sourceRenderableCount = 0;
	private sourceRevision = 0;
	private structureRevision = 0;
	private transformRevision = 0;
	private scaleSignature = '';
	private bounds: THREE.Box3 | null = null;
	private geometryDisposedCount = 0;
	private materialDisposedCount = 0;
	private root: THREE.Group | null = null;

	rebuildForModel(options: EnclosureRebuildOptions): EnclosureRebuildOutcome {

		const sourceRevision = options.modelRevision ?? 0;
		const structureRevision = options.structureRevision ?? 0;
		const transformRevision = options.transformRevision ?? 0;
		const scaleSignature = options.model.scale.toArray()
			.map( ( value ) => value.toFixed( 6 ) )
			.join( ',' );
		const unchanged = this.sourceModelUuid === options.model.uuid
			&& this.sourceRevision === sourceRevision
			&& this.structureRevision === structureRevision
			&& this.transformRevision === transformRevision
			&& this.scaleSignature === scaleSignature;
		if ( unchanged ) {
			this.buildSkipCount += 1;
			this.lastBuildSkipReason = 'unchanged-model-revision';
			return { ok: true, rebuilt: false };
		}

		const requestId = ++this.buildRequestId;
		options.model.updateWorldMatrix( true, true );
		this.dispose();
		const result = buildEnclosureShell( options.model );
		if ( result.ok === false ) return result;
		this.register( result, options.reason );
		this.sourceModelUuid = options.model.uuid;
		this.sourceModelName = options.modelName ?? options.model.name ?? null;
		this.sourceRenderableCount = result.renderableCount;
		this.sourceRevision = sourceRevision;
		this.structureRevision = structureRevision;
		this.transformRevision = transformRevision;
		this.scaleSignature = scaleSignature;
		this.bounds = result.bounds.clone();
		this.buildCompletedRequestId = requestId;
		if ( import.meta.env.DEV ) {
			console.assert(
				result.root.parent === options.model
					&& this.sourceModelUuid === options.model.uuid
					&& result.meshCount === 5,
				'Enclosure shell must belong to its current five-face source model.'
			);
		}
		return { ok: true, rebuilt: true };

	}

	private register(result: Extract<EnclosureShellBuildResult, { ok: true }>, reason: string): void {

		this.root = result.root;
		this.buildCount += 1;
		this.lastBuildReason = reason;
		result.root.visible = false;
		result.root.userData.enclosureMaterialSources = result.materialSources;

	}

	sync(root: THREE.Object3D | null, mode: 'complete' | 'layer-peeling' | 'section-cut'): void {

		root?.traverse( ( object ) => {
			if ( object.userData.__enclosureShell === true ) {
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
				this.geometryDisposedCount += 1;
				const materials = Array.isArray( object.material ) ? object.material : [ object.material ];
				materials.forEach( ( material ) => {
					const map = ( material as THREE.Material & { map?: THREE.Texture } ).map;
					if ( map?.userData.__enclosureOwnedTexture === true ) map.dispose();
					material.dispose();
					this.materialDisposedCount += 1;
				} );
			} );
		}
		this.root = null;
		this.sourceModelUuid = null;
		this.sourceModelName = null;
		this.sourceRenderableCount = 0;
		this.sourceRevision = 0;
		this.structureRevision = 0;
		this.transformRevision = 0;
		this.scaleSignature = '';
		this.bounds = null;

	}

	getDebug(root: THREE.Object3D | null, mode: 'complete' | 'layer-peeling' | 'section-cut') {

		let meshCount = 0;
		let triangleCount = 0;
		const materials = new Set<THREE.Material>();
		const sources: Record<string, string> = {};
		root?.traverse( ( object ) => {
			if ( object instanceof THREE.Mesh === false || object.userData.__enclosureShell !== true ) return;
			meshCount += 1;
			triangleCount += ( object.geometry.getIndex()?.count ?? object.geometry.getAttribute( 'position' ).count ) / 3;
			const objectMaterials = Array.isArray( object.material ) ? object.material : [ object.material ];
			objectMaterials.forEach( ( material ) => materials.add( material ) );
			sources[ String( object.userData.enclosureFace ) ] = String( object.userData.materialSource );
		} );
		return {
			activeModelUuid: this.sourceModelUuid,
			activeModelName: this.sourceModelName,
			enclosureSourceModelUuid: this.sourceModelUuid,
			enclosureSourceModelName: this.sourceModelName,
			enclosureSourceRenderableCount: this.sourceRenderableCount,
			enclosureSourceRevision: this.sourceRevision,
			enclosureStructureRevision: this.structureRevision,
			enclosureTransformRevision: this.transformRevision,
			enclosureBoundsMin: this.bounds?.min.toArray() ?? null,
			enclosureBoundsMax: this.bounds?.max.toArray() ?? null,
			enclosureBoundsSize: this.bounds?.getSize( new THREE.Vector3() ).toArray() ?? null,
			enclosureAxisU: [ 1, 0, 0 ],
			enclosureAxisV: [ 0, 0, 1 ],
			enclosureAxisUp: [ 0, 1, 0 ],
			enclosureShellExists: meshCount > 0,
			enclosureShellVisible: mode !== 'complete',
			enclosureShellMeshCount: meshCount,
			enclosureShellFaceCount: meshCount,
			enclosureShellTriangleCount: triangleCount,
			enclosureShellMaterialCount: materials.size,
			enclosureBuildCount: this.buildCount,
			enclosureBuildSkipCount: this.buildSkipCount,
			enclosureLastBuildReason: this.lastBuildReason,
			enclosureLastBuildSkipReason: this.lastBuildSkipReason,
			enclosureBuildRequestId: this.buildRequestId,
			enclosureBuildCompletedRequestId: this.buildCompletedRequestId,
			enclosureGeometryDisposedCount: this.geometryDisposedCount,
			enclosureMaterialDisposedCount: this.materialDisposedCount,
			enclosureShellTopOpen: true,
			enclosureShellBottomEnabled: meshCount > 0,
			enclosureShellClippingEnabled: mode === 'section-cut',
			enclosureShellMode: mode,
			frontMaterialSource: sources.front,
			backMaterialSource: sources.back,
			leftMaterialSource: sources.left,
			rightMaterialSource: sources.right,
			bottomMaterialSource: sources.bottom
		};

	}
}

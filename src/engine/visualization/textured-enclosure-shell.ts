import * as THREE from 'three';
import {
	buildEnclosureShell,
	type EnclosureShellBuildResult
} from './enclosure-shell-builder.js';
import type { BoundarySurfaceDebugCounts, BoundarySurfaceName } from './model-boundary-surface-resolver.js';

export type EnclosureRebuildOutcome =
	| { ok: true; rebuilt: boolean }
	| Extract<EnclosureShellBuildResult, { ok: false }>;

interface EnclosureRebuildOptions {
	model: THREE.Object3D;
	modelRevision?: number;
}

export type ConformingShellFace = BoundarySurfaceName;

export interface ConformingShellFaceDebugInfo {
	face: ConformingShellFace;
	resolved: boolean;
	meshExists: boolean;
	attachedToRoot: boolean;
	visible: boolean;
	parentVisible: boolean;
	positionCount: number;
	indexCount: number;
	triangleCount: number;
	localBoundsMin: [ number, number, number ] | null;
	localBoundsMax: [ number, number, number ] | null;
	localBoundsSize: [ number, number, number ] | null;
	worldBoundsMin: [ number, number, number ] | null;
	worldBoundsMax: [ number, number, number ] | null;
	worldBoundsSize: [ number, number, number ] | null;
	materialSide: 'front' | 'back' | 'double' | 'unknown';
	depthTest: boolean | null;
	depthWrite: boolean | null;
	frustumCulled: boolean | null;
	averageNormal: [ number, number, number ] | null;
	averageOffsetDirection: [ number, number, number ] | null;
	matrixDeterminant: number | null;
	candidateTriangleCount: number;
	acceptedTriangleCount: number;
	rejectedByNormalCount: number;
	rejectedByPositionCount: number;
}

export interface ConformingShellDebugSnapshot {
	rootExists: boolean;
	rootVisible: boolean;
	mode: string;
	expectedFaceCount: number;
	actualFaceCount: number;
	faces: ConformingShellFaceDebugInfo[];
}

const faces: readonly ConformingShellFace[] = [ 'front', 'back', 'left', 'right', 'bottom' ];

export class TexturedEnclosureShell {

	private root: THREE.Group | null = null;
	private sourceModelUuid: string | null = null;
	private sourceRevision = - 1;
	private lastMode: 'complete' | 'layer-peeling' | 'section-cut' | null = null;
	private activeRoot: THREE.Object3D | null = null;
	private readonly forcedRightStates = new Map<THREE.Mesh, { material: THREE.Material | THREE.Material[]; visible: boolean; frustumCulled: boolean; renderOrder: number }>();

	rebuildForModel(options: EnclosureRebuildOptions): EnclosureRebuildOutcome {

		const sourceRevision = options.modelRevision ?? 0;
		if ( this.sourceModelUuid === options.model.uuid && this.sourceRevision === sourceRevision ) {
			return { ok: true, rebuilt: false };
		}

		options.model.updateWorldMatrix( true, true );
		this.dispose();
		const result = buildEnclosureShell( options.model );
		if ( result.ok === false ) return result;

		this.root = result.root;
		this.root.visible = false;
		this.sourceModelUuid = options.model.uuid;
		this.sourceRevision = sourceRevision;
		return { ok: true, rebuilt: true };

	}

	sync(root: THREE.Object3D | null, mode: 'complete' | 'layer-peeling' | 'section-cut'): void {

		this.activeRoot = root;
		let rootVisible = false;
		root?.traverse( ( object ) => {
			if ( object instanceof THREE.Group && object.userData.__enclosureShell === true ) {
				object.visible = mode === 'layer-peeling' || mode === 'section-cut';
				rootVisible = object.visible;
			}
		} );
		if ( import.meta.env.DEV && this.lastMode !== mode ) console.info( '[EnclosureShellMode]', { mode, rootVisible } );
		this.lastMode = mode;

	}

	getDebugSnapshot(): ConformingShellDebugSnapshot {

		const root = this.activeRoot?.getObjectByName( '__model-conforming-shell' ) as THREE.Group | undefined;
		return {
			rootExists: root !== undefined,
			rootVisible: root?.visible ?? false,
			mode: this.lastMode ?? 'unknown',
			expectedFaceCount: faces.length,
			actualFaceCount: root?.children.filter( ( child ) => child.name.startsWith( '__shell-' ) ).length ?? 0,
			faces: faces.map( ( face ) => this.describeFace( root, face ) )
		};

	}

	setRightForceDebug(active: boolean): void {

		const mesh = this.activeRoot?.getObjectByName( '__shell-right' );
		if ( mesh instanceof THREE.Mesh === false ) return;
		if ( active ) {
			if ( this.forcedRightStates.has( mesh ) ) return;
			this.forcedRightStates.set( mesh, { material: mesh.material, visible: mesh.visible, frustumCulled: mesh.frustumCulled, renderOrder: mesh.renderOrder } );
			mesh.visible = true;
			mesh.frustumCulled = false;
			mesh.renderOrder = 10000;
			mesh.material = new THREE.MeshBasicMaterial( { color: 0xff00ff, wireframe: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false, toneMapped: false } );
			return;
		}
		this.setRightForceDebugForMesh( mesh, false );

	}

	dispose(): void {

		for ( const mesh of [ ...this.forcedRightStates.keys() ] ) this.setRightForceDebugForMesh( mesh, false );
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
		this.activeRoot = null;
		this.sourceModelUuid = null;
		this.sourceRevision = - 1;
		this.lastMode = null;

	}

	private setRightForceDebugForMesh(mesh: THREE.Mesh, active: boolean): void {

		if ( active ) return;
		const state = this.forcedRightStates.get( mesh );
		if ( state === undefined ) return;
		( Array.isArray( mesh.material ) ? mesh.material : [ mesh.material ] ).forEach( ( item ) => item.dispose() );
		mesh.material = state.material;
		mesh.visible = state.visible;
		mesh.renderOrder = state.renderOrder;
		mesh.frustumCulled = state.frustumCulled;
		this.forcedRightStates.delete( mesh );

	}

	private describeFace(root: THREE.Group | undefined, face: ConformingShellFace): ConformingShellFaceDebugInfo {

		const mesh = root?.getObjectByName( `__shell-${face}` );
		const debug = mesh?.userData.__conformingShellDebug as BoundarySurfaceDebugCounts | undefined;
		if ( mesh instanceof THREE.Mesh === false ) return this.emptyFaceDebug( face, debug );
		mesh.updateWorldMatrix( true, false );
		mesh.geometry.computeBoundingBox();
		const localBox = mesh.geometry.boundingBox;
		const worldBox = localBox?.clone().applyMatrix4( mesh.matrixWorld ) ?? null;
		const position = mesh.geometry.getAttribute( 'position' );
		const normal = mesh.geometry.getAttribute( 'normal' );
		const averageNormal = normal === undefined ? null : new THREE.Vector3();
		if ( averageNormal !== null ) {
			for ( let index = 0; index < normal!.count; index += 1 ) averageNormal.add( new THREE.Vector3().fromBufferAttribute( normal!, index ) );
			if ( averageNormal.lengthSq() > 0 ) averageNormal.normalize();
		}
		const material = Array.isArray( mesh.material ) ? mesh.material[ 0 ] : mesh.material;
		return {
			face, resolved: debug !== undefined, meshExists: true, attachedToRoot: mesh.parent === root,
			visible: mesh.visible, parentVisible: root?.visible ?? false,
			positionCount: position?.count ?? 0, indexCount: mesh.geometry.getIndex()?.count ?? 0, triangleCount: ( mesh.geometry.getIndex()?.count ?? position?.count ?? 0 ) / 3,
			localBoundsMin: vectorTuple( localBox?.min ), localBoundsMax: vectorTuple( localBox?.max ), localBoundsSize: boxSizeTuple( localBox ),
			worldBoundsMin: vectorTuple( worldBox?.min ), worldBoundsMax: vectorTuple( worldBox?.max ), worldBoundsSize: boxSizeTuple( worldBox ),
			materialSide: material.side === THREE.DoubleSide ? 'double' : material.side === THREE.FrontSide ? 'front' : material.side === THREE.BackSide ? 'back' : 'unknown',
			depthTest: material.depthTest, depthWrite: material.depthWrite, frustumCulled: mesh.frustumCulled,
			averageNormal: vectorTuple( averageNormal ), averageOffsetDirection: vectorTuple( averageNormal ), matrixDeterminant: mesh.matrixWorld.determinant(),
			candidateTriangleCount: debug?.candidateTriangleCount ?? 0, acceptedTriangleCount: debug?.acceptedTriangleCount ?? 0, rejectedByNormalCount: debug?.rejectedByNormalCount ?? 0, rejectedByPositionCount: debug?.rejectedByPositionCount ?? 0
		};

	}

	private emptyFaceDebug(face: ConformingShellFace, debug?: BoundarySurfaceDebugCounts): ConformingShellFaceDebugInfo {

		return { face, resolved: debug !== undefined, meshExists: false, attachedToRoot: false, visible: false, parentVisible: false, positionCount: 0, indexCount: 0, triangleCount: 0, localBoundsMin: null, localBoundsMax: null, localBoundsSize: null, worldBoundsMin: null, worldBoundsMax: null, worldBoundsSize: null, materialSide: 'unknown', depthTest: null, depthWrite: null, frustumCulled: null, averageNormal: null, averageOffsetDirection: null, matrixDeterminant: null, candidateTriangleCount: debug?.candidateTriangleCount ?? 0, acceptedTriangleCount: debug?.acceptedTriangleCount ?? 0, rejectedByNormalCount: debug?.rejectedByNormalCount ?? 0, rejectedByPositionCount: debug?.rejectedByPositionCount ?? 0 };

	}

}

function vectorTuple(vector: THREE.Vector3 | undefined | null): [ number, number, number ] | null {

	return vector !== undefined && vector !== null && Number.isFinite( vector.x ) && Number.isFinite( vector.y ) && Number.isFinite( vector.z ) ? [ vector.x, vector.y, vector.z ] : null;

}

function boxSizeTuple(box: THREE.Box3 | undefined | null): [ number, number, number ] | null {

	return box === undefined || box === null || box.isEmpty() ? null : vectorTuple( box.getSize( new THREE.Vector3() ) );

}

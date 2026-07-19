import * as THREE from 'three';
import type { PipeRecord } from '@/models/types/pipe-record.js';
import type { ModelLayerState } from '@/localization/core/registration-store.js';

interface LayerDefinition {
	id: string;
	label: string;
	orderIndex: number;
}

interface RankedLayerDefinition {
	id: string;
	label: string;
	averageY: number;
}

type LayerObjectGroups = Map<string, THREE.Object3D[]>;

export interface LayerVisibilityController {
	rebuild(options: {
		modelRoot: THREE.Object3D | null;
		pipesByName: Map<string, PipeRecord>;
	}): ModelLayerState[];
	setHiddenLayerCount(count: number): ModelLayerState[];
	hideTopLayer(): ModelLayerState[];
	restoreLastHiddenLayer(): ModelLayerState[];
	reset(): ModelLayerState[];
	getState(): ModelLayerState[];
	applyToRoot(root: THREE.Group | null): void;
}

const tempLayerObjects = new Map<string, THREE.Object3D[]>();
const tempWorldVertex = new THREE.Vector3();

export function createLayerVisibilityController(): LayerVisibilityController {

	let layerDefinitions: LayerDefinition[] = [];
	let hiddenLayerIds: string[] = [];
	const visibilityRecords = new WeakMap<THREE.Object3D, { originalVisible: boolean; hiddenByLayerPeeling: boolean }>();

	return {
		rebuild(options) {

			layerDefinitions = buildLayerDefinitions( options.modelRoot, options.pipesByName );
			hiddenLayerIds = [];
			return getState();

		},

		setHiddenLayerCount(count) {

			const maxHideCount = Math.max( 0, layerDefinitions.length - 1 );
			const nextHiddenCount = THREE.MathUtils.clamp( Math.round( count ), 0, maxHideCount );
			hiddenLayerIds = layerDefinitions
				.slice( 0, nextHiddenCount )
				.map( ( layer ) => layer.id );
			return getState();

		},

		hideTopLayer() {

			const nextVisible = layerDefinitions.find( ( layer ) => hiddenLayerIds.includes( layer.id ) === false );
			if ( nextVisible !== undefined ) {
				hiddenLayerIds.push( nextVisible.id );
			}

			return getState();

		},

		restoreLastHiddenLayer() {

			hiddenLayerIds.pop();
			return getState();

		},

		reset() {

			hiddenLayerIds = [];
			return getState();

		},

		getState,

		applyToRoot(root) {

			if ( root === null ) {
				return;
			}

			const layerState = getState();
			const objectsByLayerId = indexObjectsByLayerId( root );

			for ( const layer of layerState ) {
				const objects = objectsByLayerId.get( layer.id );
				if ( objects === undefined ) {
					continue;
				}

				for ( const object of objects ) {
					let record = visibilityRecords.get( object );
					if ( record === undefined ) {
						record = { originalVisible: object.visible, hiddenByLayerPeeling: false };
						visibilityRecords.set( object, record );
					}
					if ( layer.visible === false ) {
						if ( record.hiddenByLayerPeeling === false ) record.originalVisible = object.visible;
						record.hiddenByLayerPeeling = true;
						object.visible = false;
					} else if ( record.hiddenByLayerPeeling ) {
						record.hiddenByLayerPeeling = false;
						object.visible = record.originalVisible;
					} else {
						record.originalVisible = object.visible;
					}
					object.userData.__layerHidden = record.hiddenByLayerPeeling;
				}
			}

		}
	};

	function getState(): ModelLayerState[] {

		return layerDefinitions.map( ( layer ) => {
			const visible = hiddenLayerIds.includes( layer.id ) === false;

			return {
				id: layer.id,
				label: layer.label,
				visible,
				opacity: visible ? 1 : 0,
				orderIndex: layer.orderIndex
			};
		} );

	}

}

function buildLayerDefinitions(
	modelRoot: THREE.Object3D | null,
	pipesByName: Map<string, PipeRecord>
): LayerDefinition[] {

	if ( modelRoot === null ) {
		return [];
	}

	const selectableObjects = listSelectableLayerObjects( modelRoot );
	const layerObjects = selectableObjects.length > 0
		? selectableObjects
		: listBusinessLayerObjects( modelRoot, pipesByName );
	const selectableLayers = layerObjects
		.map( ( object ) => {
			const businessName = getBusinessNameForObject( object );
			const layerId = getLayerIdForObject( object ) ?? businessName;
			if ( layerId === null ) {
				return null;
			}

			const averageY = computeObjectAverageY( object );
			if ( averageY === null ) {
				return null;
			}

			const resolvedBusinessName = businessName ?? layerId;
			const properties = pipesByName.get( resolvedBusinessName );

			return {
				id: layerId,
				label: createDisplayLayerLabel( layerId, resolvedBusinessName, properties ),
				averageY
			};
		} )
		.filter( ( item ): item is NonNullable<typeof item> => item !== null )
		.filter( ( item, index, items ) => items.findIndex( ( candidate ) => candidate.id === item.id ) === index );

	if ( selectableLayers.length > 0 ) {
		return selectableLayers
			.sort( compareLayerVerticalOrder )
			.map( ( layer, index ) => ( {
				id: layer.id,
				label: layer.label,
				orderIndex: index
			} ) );
	}

	return modelRoot.children
		.map( ( object ) => {
			if ( object.name.length === 0 ) {
				return null;
			}

			const averageY = computeObjectAverageY( object );
			if ( averageY === null ) {
				return null;
			}

			return {
				id: object.name,
				label: object.name,
				averageY
			};
		} )
		.filter( ( item ): item is NonNullable<typeof item> => item !== null )
		.filter( ( item ) => Number.isFinite( item.averageY ) )
		.sort( compareLayerVerticalOrder )
		.map( ( layer, index ) => ( {
			id: layer.id,
			label: layer.label,
			orderIndex: index
		} ) );

}

function createDisplayLayerLabel(
	objectName: string,
	businessName: string,
	properties: PipeRecord | undefined
): string {

	const baseLabel = properties === undefined
		? businessName
		: createLayerLabel( businessName, properties );

	if ( objectName === businessName ) {
		return baseLabel;
	}

	const partMatch = /__part_(\d+)$/i.exec( objectName );
	if ( partMatch !== null ) {
		return `${baseLabel} #${String( Number( partMatch[ 1 ] ) )}`;
	}

	return objectName;

}

function compareLayerVerticalOrder(a: RankedLayerDefinition, b: RankedLayerDefinition): number {

	return b.averageY - a.averageY;

}

function computeObjectAverageY(object: THREE.Object3D): number | null {

	let totalY = 0;
	let triangleCount = 0;

	object.updateWorldMatrix( true, true );
	object.traverse( ( child ) => {
		if ( isExcludedFromLayerIndex( child ) || ( child instanceof THREE.Mesh ) === false ) {
			return;
		}

		const position = child.geometry.getAttribute( 'position' );
		if ( position === undefined ) {
			return;
		}

		const index = child.geometry.getIndex();
		const currentTriangleCount = index === null
			? Math.floor( position.count / 3 )
			: Math.floor( index.count / 3 );

		for ( let triangleIndex = 0; triangleIndex < currentTriangleCount; triangleIndex ++ ) {
			const indexOffset = triangleIndex * 3;
			const a = index === null ? indexOffset : index.getX( indexOffset );
			const b = index === null ? indexOffset + 1 : index.getX( indexOffset + 1 );
			const c = index === null ? indexOffset + 2 : index.getX( indexOffset + 2 );

			totalY += (
				getWorldVertexY( position, a, child.matrixWorld )
				+ getWorldVertexY( position, b, child.matrixWorld )
				+ getWorldVertexY( position, c, child.matrixWorld )
			) / 3;
		}

		triangleCount += currentTriangleCount;
	} );

	if ( triangleCount === 0 ) {
		return null;
	}

	return totalY / triangleCount;

}

function getWorldVertexY(
	position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
	index: number,
	matrixWorld: THREE.Matrix4
): number {

	tempWorldVertex.fromBufferAttribute( position, index );
	tempWorldVertex.applyMatrix4( matrixWorld );
	return tempWorldVertex.y;

}

function getBusinessNameForObject(object: THREE.Object3D): string | null {

	const userDataBusinessName = object.userData.__businessName;
	if ( typeof userDataBusinessName === 'string' && userDataBusinessName.length > 0 ) {
		return userDataBusinessName;
	}

	if ( object.name.length > 0 ) {
		return object.name;
	}

	return null;

}

function createLayerLabel(name: string, properties: PipeRecord): string {

	const depthLabel = normalizeLayerLabel( properties.depth );
	if ( depthLabel !== null ) {
		return depthLabel;
	}

	const typeLabel = normalizeLayerLabel( properties.type );
	if ( typeLabel !== null && typeLabel !== name ) {
		return `${name} · ${typeLabel}`;
	}

	return name;

}

function normalizeLayerLabel(value: string | undefined): string | null {

	if ( value === undefined ) {
		return null;
	}

	const trimmed = value.trim();
	if ( trimmed.length === 0 || trimmed === '--' || trimmed === '-' ) {
		return null;
	}

	return trimmed;

}

function listSelectableLayerObjects(root: THREE.Object3D): THREE.Object3D[] {

	const selectableObjects: THREE.Object3D[] = [];
	root.traverse( ( child ) => {
		if ( isExcludedFromLayerIndex( child ) ) {
			return;
		}

		if ( child.userData.__layerSelectable === true ) {
			selectableObjects.push( child );
		}
	} );

	return selectableObjects;

}

function listBusinessLayerObjects(
	root: THREE.Object3D,
	pipesByName: Map<string, PipeRecord>
): THREE.Object3D[] {

	const objects: THREE.Object3D[] = [];
	root.traverse( ( child ) => {
		if ( isExcludedFromLayerIndex( child ) ) return;
		const businessName = getBusinessNameForObject( child );
		if ( businessName !== null && pipesByName.has( businessName ) ) objects.push( child );
	} );
	return objects;

}

function indexObjectsByLayerId(root: THREE.Object3D): LayerObjectGroups {

	tempLayerObjects.clear();
	root.traverse( ( child ) => {
		if ( isExcludedFromLayerIndex( child ) ) {
			return;
		}

		const layerId = getLayerIdForObject( child ) ?? ( child.name.length > 0 ? child.name : null );
		if ( layerId === null ) {
			return;
		}

		const group = tempLayerObjects.get( layerId );
		if ( group === undefined ) {
			tempLayerObjects.set( layerId, [ child ] );
			return;
		}

		group.push( child );
	} );

	return new Map( tempLayerObjects );

}

function getLayerIdForObject(object: THREE.Object3D): string | null {

	const layerId = object.userData.__layerId;
	if ( typeof layerId === 'string' && layerId.length > 0 ) {
		return layerId;
	}

	return null;

}

function isExcludedFromLayerIndex(object: THREE.Object3D): boolean {

	let current: THREE.Object3D | null = object;
	while ( current !== null ) {
		if ( current.userData.__excludeFromLayerIndex === true ) {
			return true;
		}

		current = current.parent;
	}

	return false;

}




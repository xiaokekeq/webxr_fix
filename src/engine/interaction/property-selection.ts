import * as THREE from 'three';
import { createHighlightedMaterial, disposeDynamicMaterials } from '@/engine/interaction/material-highlighting.js';
import type { PipeRecord } from '@/models/types/pipe-record.js';

interface CreatePropertySelectionControllerOptions {
	shouldRenderSelectionOutline?(): boolean;
}

export interface PropertySelectionResult {
	businessName: string;
	componentId: string;
	properties: PipeRecord | null;
}

export interface PropertySelectionController {
	clearSelection(): void;
	isSelectedBusinessObject(businessObject: THREE.Object3D): boolean;
	isSelectedComponent(componentId: string): boolean;
	resolveComponentId(businessObject: THREE.Object3D, properties: PipeRecord | null): string;
	resolveBusinessObject(
		mesh: THREE.Object3D,
		placedModel: THREE.Group | null,
		pipesByName: Map<string, PipeRecord>
	): THREE.Object3D;
	selectBusinessObject(
		businessObject: THREE.Object3D,
		properties: PipeRecord | null,
		highlightObject?: THREE.Object3D
	): PropertySelectionResult;
}

export function createPropertySelectionController(
	options: CreatePropertySelectionControllerOptions
): PropertySelectionController {

	let selectedMeshes: THREE.Mesh[] = [];
	let selectedOutlines: THREE.LineSegments[] = [];
	let selectedComponentId: string | null = null;
	const shouldRenderSelectionOutline = options.shouldRenderSelectionOutline ?? ( () => false );

	return {
		clearSelection,
		isSelectedBusinessObject(businessObject) {

			return selectedComponentId === resolveStableComponentId( businessObject, null );

		},

		isSelectedComponent(componentId) {

			return selectedComponentId === componentId;

		},

		resolveComponentId(businessObject, properties) {

			return resolveStableComponentId( businessObject, properties );

		},

		resolveBusinessObject(mesh, placedModel, pipesByName) {

			if ( placedModel === null ) {
				return mesh;
			}

			let current: THREE.Object3D | null = mesh;
			let fallback = mesh;

			while ( current && current !== placedModel ) {
				if ( current.name ) {
					fallback = current;
				}

				if ( current.userData.__layerSelectable === true ) {
					return current;
				}

				if ( current.name && pipesByName.has( current.name ) ) {
					return current;
				}

				current = current.parent;
			}

			return fallback;

		},

		selectBusinessObject(businessObject, properties, highlightObject) {

			clearSelection();
			const componentId = resolveStableComponentId( businessObject, properties );
			selectedComponentId = componentId;
			const highlightRoot = highlightObject ?? businessObject;
			highlightRoot.traverse( ( child ) => {
				if ( child instanceof THREE.Mesh && child.userData.__selectionProxy !== true ) {
					selectedMeshes.push( child );
					child.userData.__originalMaterial = child.material;

					const materials = Array.isArray( child.material ) ? child.material : [ child.material ];
					const highlightedMaterials = materials.map( createHighlightedMaterial );
					child.material = Array.isArray( child.material ) ? highlightedMaterials : highlightedMaterials[ 0 ];

					if ( shouldRenderSelectionOutline() ) {
						const outline = createSelectionOutline( child );
						if ( outline !== null ) {
							child.add( outline );
							selectedOutlines.push( outline );
						}
					}
				}
			} );

			return {
				businessName: getBusinessName( businessObject ),
				componentId,
				properties
			};

		}
	};

	function clearSelection(): void {

		for ( const outline of selectedOutlines ) {
			outline.removeFromParent();
			outline.geometry.dispose();

			if ( Array.isArray( outline.material ) ) {
				for ( const material of outline.material ) {
					material.dispose();
				}
			} else {
				outline.material.dispose();
			}
		}

		selectedOutlines = [];

		for ( const mesh of selectedMeshes ) {
			if ( mesh.userData.__originalMaterial ) {
				disposeDynamicMaterials( mesh.material, mesh.userData.__originalMaterial );
				mesh.material = mesh.userData.__originalMaterial;
				delete mesh.userData.__originalMaterial;
			}
		}

		selectedMeshes = [];
		selectedComponentId = null;

	}

	function createSelectionOutline(mesh: THREE.Mesh): THREE.LineSegments | null {

		if ( mesh.geometry === undefined ) {
			return null;
		}

		const outline = new THREE.LineSegments(
			new THREE.EdgesGeometry( mesh.geometry ),
			new THREE.LineBasicMaterial( {
				color: 0xffc107,
				depthTest: false,
				transparent: true,
				opacity: 0.98,
				toneMapped: false
			} )
		);

		outline.name = '__selection-outline';
		outline.renderOrder = 999;
		outline.frustumCulled = false;
		outline.raycast = () => {};

		return outline;

	}

	function getBusinessName(object: THREE.Object3D): string {

		const userDataBusinessName = object.userData.__businessName;
		if ( typeof userDataBusinessName === 'string' && userDataBusinessName.length > 0 ) {
			return userDataBusinessName;
		}

		return object.name || 'UnnamedObject';

	}

}

export function resolveStableComponentId(
	object: THREE.Object3D,
	properties: PipeRecord | null
): string {

	let current: THREE.Object3D | null = object;
	while ( current !== null ) {
		const explicitId = readComponentId( current.userData.componentId )
			?? readComponentId( current.userData.pipeId );
		if ( explicitId !== null ) return explicitId;
		current = current.parent;
	}

	const code = readComponentId( properties?.code );
	if ( code !== null ) return code;

	return `legacy:${normalizeBusinessName( getBusinessNameForComponent( object ) )}`;

}

function readComponentId(value: unknown): string | null {

	if ( typeof value !== 'string' ) return null;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;

}

function normalizeBusinessName(value: string): string {

	const normalized = value.trim().replace( /\s+/g, '-' ).toLowerCase();
	return normalized.length > 0 ? normalized : 'unnamed-pipe';

}

function getBusinessNameForComponent(object: THREE.Object3D): string {

	const userDataBusinessName = object.userData.__businessName;
	if ( typeof userDataBusinessName === 'string' && userDataBusinessName.length > 0 ) {
		return userDataBusinessName;
	}
	return object.name || 'UnnamedObject';

}

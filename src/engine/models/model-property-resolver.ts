import * as THREE from 'three';
import type { PipeRecord } from '@/models/types/pipe-record.js';

export type ModelRole = 'primary' | 'structure' | 'utility' | 'device' | 'surface' | 'context';

export interface CanvasModelPropertyPanelData {
	panelType: 'model-property';
	modelInstanceId: string;
	modelInstanceName: string;
	modelRole: ModelRole;
	objectId: string;
	objectName: string;
	title: string;
	sections: Array<{
		id: string;
		title?: string;
		rows: Array<{
			label: string;
			value: string;
			unit?: string;
			status?: 'normal' | 'warning' | 'danger' | 'offline';
		}>;
	}>;
	worldAnchor?: THREE.Vector3;
	closable: boolean;
}

export interface ModelObjectSelection {
	type: 'model-object';
	modelInstanceId: string;
	modelInstanceName: string;
	modelRole: ModelRole;
	objectId: string;
	objectName: string;
	object: THREE.Object3D;
	properties: Record<string, unknown>;
}

export function resolveModelObjectSelection(args: {
	object: THREE.Object3D;
	properties: PipeRecord | null;
}): ModelObjectSelection {

	const instanceRoot = findModelInstanceRoot( args.object );
	const modelInstanceId = readStringUserData( instanceRoot, 'modelInstanceId' )
		?? readStringUserData( args.object, 'modelInstanceId' )
		?? 'default-model';
	const modelInstanceName = readStringUserData( instanceRoot, 'modelInstanceName' )
		?? modelInstanceId;
	const modelRole = normalizeModelRole(
		readStringUserData( instanceRoot, 'modelRole' )
			?? readStringUserData( args.object, 'modelRole' )
	);
	const objectName = readBusinessName( args.object );

	return {
		type: 'model-object',
		modelInstanceId,
		modelInstanceName,
		modelRole,
		objectId: `${modelInstanceId}:${args.object.uuid}`,
		objectName,
		object: args.object,
		properties: {
			...args.object.userData,
			...( args.properties ?? {} )
		}
	};

}

export function resolveModelObjectProperties(args: {
	selection: ModelObjectSelection;
	properties: PipeRecord | null;
	layerName?: string;
	materialName?: string;
	bounds?: THREE.Box3;
}): CanvasModelPropertyPanelData {

	const rows = [
		row( '模型实例', args.selection.modelInstanceName ),
		row( '实例 ID', args.selection.modelInstanceId ),
		row( '角色', args.selection.modelRole ),
		row( '构件名称', args.properties?.name ?? args.selection.objectName ),
		row( '图层', args.layerName ),
		row( '材质', args.properties?.material ?? args.materialName ),
		row( '状态', args.properties?.status ?? ( args.selection.object.visible ? '可见' : '隐藏' ) )
	];

	if ( args.selection.modelRole === 'utility' ) {
		rows.push(
			row( '管径', args.properties?.diameter ),
			row( '埋深', args.properties?.depth )
		);
	}

	if ( args.selection.modelRole === 'device' ) {
		rows.push(
			row( '设备类型', args.properties?.type ),
			row( '告警等级', stringifyUnknown( args.selection.properties.alarmLevel ) )
		);
	}

	if ( args.bounds !== undefined && args.bounds.isEmpty() === false ) {
		const center = args.bounds.getCenter( new THREE.Vector3() );
		rows.push( row( '工程高程', center.y.toFixed( 2 ), 'm' ) );
	}

	rows.push( row( '备注', args.properties?.remark ) );

	return {
		panelType: 'model-property',
		modelInstanceId: args.selection.modelInstanceId,
		modelInstanceName: args.selection.modelInstanceName,
		modelRole: args.selection.modelRole,
		objectId: args.selection.objectId,
		objectName: args.selection.objectName,
		title: args.properties?.name ?? args.selection.objectName,
		sections: [
			{
				id: 'main',
				title: '构件信息',
				rows: rows.filter( ( item ): item is NonNullable<typeof item> => item !== null )
			}
		],
		worldAnchor: args.bounds?.isEmpty() === false
			? args.bounds.getCenter( new THREE.Vector3() )
			: undefined,
		closable: true
	};

}

export function findModelInstanceRoot(object: THREE.Object3D | null): THREE.Object3D | null {

	let current = object;
	while ( current !== null ) {
		if ( typeof current.userData.modelInstanceId === 'string' ) {
			return current;
		}
		current = current.parent;
	}
	return null;

}

function row(
	label: string,
	value: string | number | undefined,
	unit?: string
): CanvasModelPropertyPanelData['sections'][number]['rows'][number] | null {

	if ( value === undefined || value === null || String( value ).length === 0 ) {
		return null;
	}
	return {
		label,
		value: String( value ),
		unit
	};

}

function readBusinessName(object: THREE.Object3D): string {

	const businessName = readStringUserData( object, '__businessName' );
	return businessName ?? ( object.name || object.uuid );

}

function readStringUserData(object: THREE.Object3D | null, key: string): string | null {

	const value = object?.userData[ key ];
	return typeof value === 'string' && value.length > 0 ? value : null;

}

function normalizeModelRole(value: string | null): ModelRole {

	return value === 'structure'
		|| value === 'utility'
		|| value === 'device'
		|| value === 'surface'
		|| value === 'context'
		|| value === 'primary'
		? value
		: 'primary';

}

function stringifyUnknown(value: unknown): string | undefined {

	return value === undefined || value === null ? undefined : String( value );

}

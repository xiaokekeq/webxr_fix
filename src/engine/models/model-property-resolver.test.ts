import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { resolveModelObjectProperties, resolveModelObjectSelection } from './model-property-resolver.js';

describe( 'water-network model properties', () => {

	it( 'shows pipe fields for a primary OBJ model', () => {

		const root = new THREE.Group();
		root.userData = { modelInstanceId: 'water-network', modelInstanceName: '供水管网', modelRole: 'primary' };
		const object = new THREE.Mesh();
		object.name = '对象002';
		root.add( object );
		const properties = {
			name: '对象002',
			code: 'WN-74-76-002',
			type: '供水管线',
			diameter: 'DN200',
			material: '待补录',
			depth: '约 0.39 m',
			startPoint: '(0, 0, 0)',
			endPoint: '(1, 0, 0)',
			area: '东城 74-76 区域',
			status: '待确认'
		};
		const panel = resolveModelObjectProperties( {
			selection: resolveModelObjectSelection( { object, properties } ),
			properties
		} );
		const rows = Object.fromEntries( panel.sections[ 0 ].rows.map( ( row ) => [ row.label, row.value ] ) );

		expect( rows ).toMatchObject( {
			管线编号: 'WN-74-76-002',
			管径: 'DN200',
			起点: '(0, 0, 0)',
			终点: '(1, 0, 0)',
			所属区域: '东城 74-76 区域',
			运行状态: '待确认'
		} );
		expect( panel.sections[ 0 ].rows.slice( 0, 6 ).map( ( row ) => row.label ) ).toEqual( [
			'构件名称', '管线类型', '管径', '材质', '埋深', '运行状态'
		] );

	} );

} );

import { describe, expect, it } from 'vitest';
import type { EngineeringAnnotation } from '@/engine/annotation/annotation-types.js';
import { filterActiveAnomalies } from './anomaly-panel.js';

function annotation(id: string, severity: EngineeringAnnotation['severity'], visible = true): EngineeringAnnotation {

	return {
		id,
		type: 'warning',
		title: id,
		severity,
		source: 'inspection',
		properties: {},
		visible,
		layerId: 'test'
	};

}

describe( 'AR anomaly panel', () => {

	it( 'lists visible danger and warning annotations that were not dismissed', () => {
		const annotations = [
			annotation( 'danger', 'danger' ),
			annotation( 'warning', 'warning' ),
			annotation( 'normal', 'normal' ),
			annotation( 'hidden', 'warning', false )
		];

		expect( filterActiveAnomalies( annotations, [ 'danger' ] ).map( ( item ) => item.id ) )
			.toEqual( [ 'warning' ] );
	} );

} );

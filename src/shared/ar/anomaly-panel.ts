import type { EngineeringAnnotation } from '@/engine/annotation/annotation-types.js';

export function filterActiveAnomalies(
	annotations: EngineeringAnnotation[],
	dismissedIds: readonly string[] = []
): EngineeringAnnotation[] {

	const dismissed = new Set( dismissedIds );
	return annotations.filter( ( annotation ) => (
		annotation.visible
		&& ( annotation.severity === 'danger' || annotation.severity === 'warning' )
		&& dismissed.has( annotation.id ) === false
	) );

}

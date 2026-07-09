export type AnnotationSeverity = 'normal' | 'warning' | 'danger';

export type AnnotationType =
	| 'risk'
	| 'monitor'
	| 'inspection'
	| 'label'
	| 'warning'
	| 'custom';

export interface EnuPoint {
	east: number;
	north: number;
	up: number;
}

export interface EngineeringAnnotationLabel {
	mode: 'offset' | 'absolute';
	offsetMeters?: EnuPoint;
	labelEnu?: EnuPoint;
}

export interface EngineeringAnnotation {
	id: string;
	type: AnnotationType;
	title: string;
	description?: string;
	anchorEnu: EnuPoint;
	label?: EngineeringAnnotationLabel;
	severity: AnnotationSeverity;
	status?: string;
	color?: string;
	icon?: string;
	source: 'business' | 'demo' | 'sensor' | 'inspection' | 'risk';
	properties: Record<string, string | number | boolean | null>;
	visible: boolean;
	layerId: string;
}

export interface AnnotationStyleRule {
	severity: AnnotationSeverity;
	pointColor: string;
	lineColor: string;
	labelColor: string;
}

export interface ResolvedAnnotationStyle {
	pointColor: string;
	lineColor: string;
	labelColor: string;
}

const DEFAULT_STYLE_RULES: AnnotationStyleRule[] = [
	{
		severity: 'normal',
		pointColor: '#2f80ed',
		lineColor: '#2f80ed',
		labelColor: '#2f80ed'
	},
	{
		severity: 'warning',
		pointColor: '#f2c94c',
		lineColor: '#f2c94c',
		labelColor: '#f2c94c'
	},
	{
		severity: 'danger',
		pointColor: '#eb5757',
		lineColor: '#eb5757',
		labelColor: '#eb5757'
	}
];

export function resolveAnnotationStyle(
	annotation: Pick<EngineeringAnnotation, 'severity' | 'color'>,
	styleRules: AnnotationStyleRule[] = []
): ResolvedAnnotationStyle {

	if ( typeof annotation.color === 'string' && annotation.color.length > 0 ) {
		return {
			pointColor: annotation.color,
			lineColor: annotation.color,
			labelColor: annotation.color
		};
	}

	const rule = styleRules.find( ( item ) => item.severity === annotation.severity )
		?? DEFAULT_STYLE_RULES.find( ( item ) => item.severity === annotation.severity )
		?? DEFAULT_STYLE_RULES[ 0 ];
	return {
		pointColor: rule.pointColor,
		lineColor: rule.lineColor,
		labelColor: rule.labelColor
	};

}

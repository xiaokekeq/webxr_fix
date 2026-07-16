import type { ComponentPropertyHudField } from '@/shared/config/project-config.js';
import type { SelectedComponentState } from '@/localization/core/registration-store.js';

export interface ComponentPropertyHudRow {
	key: string;
	label: string;
	value: string;
}

export function createComponentPropertyHudRows(
	selectedComponent: SelectedComponentState,
	fields: ComponentPropertyHudField[]
): ComponentPropertyHudRow[] {

	return fields.map( ( field ) => ( {
		key: field.key,
		label: field.label,
		value: formatComponentPropertyValue( selectedComponent.properties[ field.key ], field.unit )
	} ) );

}

export function formatComponentPropertyValue(value: unknown, unit?: string): string {

	const text = formatValue( value );
	if ( text === '—' || unit === undefined || unit.trim().length === 0 ) return text;
	return text.endsWith( unit ) ? text : `${text} ${unit}`;

}

function formatValue(value: unknown): string {

	if ( value === null || value === undefined ) return '—';
	if ( typeof value === 'number' ) return Number.isFinite( value ) ? String( value ) : '—';
	if ( typeof value === 'boolean' ) return value ? '是' : '否';
	if ( typeof value === 'string' ) {
		const text = value.trim();
		return text.length === 0 || /^(null|undefined|nan)$/i.test( text ) ? '—' : text;
	}
	if ( Array.isArray( value ) ) {
		const values = value.map( formatValue ).filter( ( item ) => item !== '—' );
		return values.length > 0 ? values.join( '、' ) : '—';
	}
	return '—';

}

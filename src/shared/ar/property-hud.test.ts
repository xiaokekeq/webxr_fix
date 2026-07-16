import { describe, expect, it } from 'vitest';
import { createComponentPropertyHudRows, formatComponentPropertyValue } from './property-hud.js';

describe( 'component property HUD values', () => {

	it( 'renders missing and invalid values as an em dash', () => {
		expect( formatComponentPropertyValue( null ) ).toBe( '—' );
		expect( formatComponentPropertyValue( undefined ) ).toBe( '—' );
		expect( formatComponentPropertyValue( Number.NaN ) ).toBe( '—' );
		expect( formatComponentPropertyValue( 'undefined' ) ).toBe( '—' );
	} );

	it( 'uses project field definitions rather than a hardcoded panel schema', () => {
		const rows = createComponentPropertyHudRows( {
			componentId: 'WN-74-76-001',
			displayName: 'A very long water pipe name that stays available as data',
			properties: { depth: 1.4, status: null }
		}, [
			{ key: 'depth', label: '埋深', unit: 'm' },
			{ key: 'status', label: '运行状态' }
		] );

		expect( rows ).toEqual( [
			{ key: 'depth', label: '埋深', value: '1.4 m' },
			{ key: 'status', label: '运行状态', value: '—' }
		] );
	} );

} );

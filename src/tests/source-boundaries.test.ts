import { describe, expect, it } from 'vitest';

const sharedSources = import.meta.glob<string>( '/src/shared/**/*.{ts,vue}', {
	query: '?raw',
	import: 'default',
	eager: true
} );

const commonSources = import.meta.glob<string>( [
	'/src/**/*.{ts,vue}',
	'!/src/apps/**',
	'!/src/tests/**',
	'!/src/**/*.test.ts'
], {
	query: '?raw',
	import: 'default',
	eager: true
} );

describe( 'shared source boundaries', () => {
	it( 'does not import either application', () => {
		for ( const source of Object.values( sharedSources ) ) {
			expect( source ).not.toMatch( /apps\/(dam|water-network)/ );
		}
	} );

	it( 'keeps one shared AR workspace', () => {
		expect( Object.keys( sharedSources ).filter( ( path ) => path.endsWith( '/ArWorkspace.vue' ) ) ).toHaveLength( 1 );
	} );

	it( 'keeps all common runtime code independent from application sources', () => {
		for ( const source of Object.values( commonSources ) ) {
			expect( source ).not.toMatch( /@\/apps\/(dam|water-network)/ );
		}
	} );

	it( 'keeps one ThreeEngine and one shared property selection chain', () => {
		const paths = Object.keys( commonSources );
		expect( Object.values( commonSources ).filter( ( source ) => /export class ThreeEngine\b/.test( source ) ) ).toHaveLength( 1 );
		expect( paths.filter( ( path ) => path.endsWith( '/property-selection.ts' ) ) ).toHaveLength( 1 );
		expect( paths.filter( ( path ) => path.endsWith( '/property-hud.ts' ) ) ).toHaveLength( 1 );
	} );
} );

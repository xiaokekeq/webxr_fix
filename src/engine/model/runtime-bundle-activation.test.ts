import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { TexturedEnclosureShell } from '@/engine/visualization/textured-enclosure-shell.js';
import type { LoadedModelRuntimeBundle } from './runtime.js';
import { activateRuntimeBundle } from './runtime-bundle-activation.js';

const bundle = {} as LoadedModelRuntimeBundle;

describe( 'activateRuntimeBundle', () => {

	it( 'commits ready only after core installation succeeds', () => {

		const events: string[] = [];
		const result = activateRuntimeBundle(
			bundle,
			() => events.push( 'core-installed' ),
			() => events.push( 'ready-committed' )
		);

		expect( result ).toEqual( { ok: true } );
		expect( events ).toEqual( [ 'core-installed', 'ready-committed' ] );

	} );

	it( 'does not commit ready when core installation fails', () => {

		const commitReady = vi.fn();
		const result = activateRuntimeBundle(
			bundle,
			() => { throw new Error( 'install failed' ); },
			commitReady
		);

		expect( result.ok ).toBe( false );
		expect( commitReady ).not.toHaveBeenCalled();

	} );

	it( 'keeps successful activation independent from an optional enclosure failure', () => {

		const activation = activateRuntimeBundle( bundle, () => {}, () => {} );
		const enclosure = new TexturedEnclosureShell().rebuildForModel( { model: new THREE.Group(), renderer: {} as THREE.WebGLRenderer } );

		expect( activation.ok ).toBe( true );
		expect( enclosure.ok ).toBe( false );

	} );

} );

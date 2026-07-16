import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	AR_UI_INTERACTIVE_SELECTOR,
	installArDomOverlayInputGuard
} from './ar-dom-overlay-input-guard.js';

class FakeElement {

	constructor(
		private readonly interactive = false,
		private readonly parent: FakeElement | null = null
	) {}

	closest(selector: string): FakeElement | null {

		if ( selector !== AR_UI_INTERACTIVE_SELECTOR ) return null;
		if ( this.interactive ) return this;
		return this.parent?.closest( selector ) ?? null;

	}

}

type Listener = EventListenerOrEventListenerObject;

class FakeRoot extends FakeElement {

	private readonly listeners = new Map<string, Set<Listener>>();

	addEventListener(type: string, listener: Listener | null): void {

		if ( listener === null ) return;
		const listeners = this.listeners.get( type ) ?? new Set<Listener>();
		listeners.add( listener );
		this.listeners.set( type, listeners );

	}

	removeEventListener(type: string, listener: Listener | null): void {

		if ( listener !== null ) this.listeners.get( type )?.delete( listener );

	}

	dispatch(type: string, event: Event): void {

		for ( const listener of this.listeners.get( type ) ?? [] ) {
			if ( typeof listener === 'function' ) listener( event );
			else listener.handleEvent( event );
		}

	}

	listenerCount(type: string): number {

		return this.listeners.get( type )?.size ?? 0;

	}

}

function createEvent(path: FakeElement[], pointerId?: number): Event {

	return {
		pointerId,
		composedPath: () => path,
		preventDefault: vi.fn()
	} as unknown as Event;

}

describe( 'AR DOM Overlay input guard', () => {

	afterEach( () => vi.unstubAllGlobals() );

	it( 'prevents beforexrselect for a marked panel and its child, but not transparent overlay space', () => {

		vi.stubGlobal( 'Element', FakeElement );
		const root = new FakeRoot();
		const panel = new FakeElement( true, root );
		const button = new FakeElement( false, panel );
		const scene = new FakeElement( false, root );
		const guard = installArDomOverlayInputGuard( root as unknown as HTMLElement );
		const panelEvent = createEvent( [ panel, root ] );
		const childEvent = createEvent( [ button, panel, root ] );
		const transparentEvent = createEvent( [ scene, root ] );

		root.dispatch( 'beforexrselect', panelEvent );
		root.dispatch( 'beforexrselect', childEvent );
		root.dispatch( 'beforexrselect', transparentEvent );

		expect( panelEvent.preventDefault ).toHaveBeenCalledOnce();
		expect( childEvent.preventDefault ).toHaveBeenCalledOnce();
		expect( transparentEvent.preventDefault ).not.toHaveBeenCalled();
		const worldSelect = vi.fn();
		if ( vi.mocked( panelEvent.preventDefault ).mock.calls.length === 0 ) worldSelect();
		if ( vi.mocked( transparentEvent.preventDefault ).mock.calls.length === 0 ) worldSelect();
		expect( worldSelect ).toHaveBeenCalledOnce();
		guard.dispose();

	} );

	it( 'tracks multiple UI pointers independently and releases them on up or cancel', () => {

		vi.stubGlobal( 'Element', FakeElement );
		const root = new FakeRoot();
		const panel = new FakeElement( true, root );
		const scene = new FakeElement( false, root );
		const guard = installArDomOverlayInputGuard( root as unknown as HTMLElement );
		const firstDown = createEvent( [ panel, root ], 1 ) as PointerEvent;
		const sceneDown = createEvent( [ scene, root ], 2 ) as PointerEvent;
		const secondUiDown = createEvent( [ panel, root ], 3 ) as PointerEvent;

		root.dispatch( 'pointerdown', firstDown );
		root.dispatch( 'pointerdown', sceneDown );
		root.dispatch( 'pointerdown', secondUiDown );
		expect( guard.ownsPointer( 1 ) ).toBe( true );
		expect( guard.ownsPointer( 2 ) ).toBe( false );
		expect( guard.ownsPointer( 3 ) ).toBe( true );

		root.dispatch( 'pointercancel', createEvent( [ panel, root ], 1 ) );
		expect( guard.ownsPointer( 1 ) ).toBe( false );
		expect( guard.ownsPointer( 3 ) ).toBe( true );

		const secondUp = createEvent( [ scene, root ], 3 ) as PointerEvent;
		root.dispatch( 'pointerup', secondUp );
		expect( guard.ownsPointer( 3 ) ).toBe( false );
		expect( guard.isUiOwnedPointerEvent( secondUp ) ).toBe( true );
		guard.dispose();

	} );

	it( 'removes every listener and clears pointer ownership on dispose', () => {

		vi.stubGlobal( 'Element', FakeElement );
		const root = new FakeRoot();
		const panel = new FakeElement( true, root );
		const guard = installArDomOverlayInputGuard( root as unknown as HTMLElement );
		root.dispatch( 'pointerdown', createEvent( [ panel, root ], 7 ) );

		expect( guard.ownsPointer( 7 ) ).toBe( true );
		guard.dispose();

		expect( guard.ownsPointer( 7 ) ).toBe( false );
		for ( const type of [ 'beforexrselect', 'pointerdown', 'pointerup', 'pointercancel' ] ) {
			expect( root.listenerCount( type ) ).toBe( 0 );
		}

		const nextGuard = installArDomOverlayInputGuard( root as unknown as HTMLElement );
		expect( root.listenerCount( 'beforexrselect' ) ).toBe( 1 );
		nextGuard.dispose();

	} );

} );

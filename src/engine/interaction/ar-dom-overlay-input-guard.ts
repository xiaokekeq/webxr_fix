export const AR_UI_INTERACTIVE_SELECTOR = '[data-ar-ui-interactive]';

export interface ArDomOverlayInputGuard {
	ownsPointer(pointerId: number): boolean;
	isUiOwnedPointerEvent(event: PointerEvent): boolean;
	dispose(): void;
}

export function isArUiInteractiveEvent(event: Event): boolean {

	return event.composedPath().some( ( target ) => (
		typeof Element !== 'undefined'
		&& target instanceof Element
		&& target.closest( AR_UI_INTERACTIVE_SELECTOR ) !== null
	) );

}

export function installArDomOverlayInputGuard(root: HTMLElement): ArDomOverlayInputGuard {

	const uiOwnedPointerIds = new Set<number>();
	const uiOwnedPointerEvents = new WeakSet<Event>();

	const handleBeforeXrSelect = (event: Event): void => {
		if ( isArUiInteractiveEvent( event ) ) event.preventDefault();
	};
	const handlePointerDown = (event: PointerEvent): void => {
		if ( isArUiInteractiveEvent( event ) ) uiOwnedPointerIds.add( event.pointerId );
	};
	const handlePointerUp = (event: PointerEvent): void => {
		if ( uiOwnedPointerIds.delete( event.pointerId ) ) uiOwnedPointerEvents.add( event );
	};
	const handlePointerCancel = (event: PointerEvent): void => {
		uiOwnedPointerIds.delete( event.pointerId );
	};

	root.addEventListener( 'beforexrselect', handleBeforeXrSelect, true );
	root.addEventListener( 'pointerdown', handlePointerDown, true );
	root.addEventListener( 'pointerup', handlePointerUp, true );
	root.addEventListener( 'pointercancel', handlePointerCancel, true );

	return {
		ownsPointer(pointerId) {
			return uiOwnedPointerIds.has( pointerId );
		},
		isUiOwnedPointerEvent(event) {
			return uiOwnedPointerEvents.has( event ) || uiOwnedPointerIds.has( event.pointerId );
		},
		dispose() {
			root.removeEventListener( 'beforexrselect', handleBeforeXrSelect, true );
			root.removeEventListener( 'pointerdown', handlePointerDown, true );
			root.removeEventListener( 'pointerup', handlePointerUp, true );
			root.removeEventListener( 'pointercancel', handlePointerCancel, true );
			uiOwnedPointerIds.clear();
		}
	};

}

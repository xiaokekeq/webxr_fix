const PANEL_ID = 'xr-debug-probe-panel';
const MAX_LINES = 10;
const lines: string[] = [];

// Temporary investigation only: delete this file before applying the XR fix.
export function resetXrDebugPanel(): void {

	lines.length = 0;
	document.getElementById( PANEL_ID )?.remove();

}

export function showXrDebugProbe(message: string): void {

	lines.push( `${new Date().toLocaleTimeString( 'zh-CN', { hour12: false } )} ${message}` );
	if ( lines.length > MAX_LINES ) lines.splice( 0, lines.length - MAX_LINES );

	let panel = document.getElementById( PANEL_ID );
	if ( panel === null ) {
		panel = document.createElement( 'pre' );
		panel.id = PANEL_ID;
		panel.dataset.arUi = 'true';
		Object.assign( panel.style, {
			position: 'fixed',
			top: 'calc(env(safe-area-inset-top) + 76px)',
			left: '8px',
			right: '8px',
			zIndex: '9999',
			maxHeight: '34vh',
			margin: '0',
			padding: '8px',
			overflow: 'hidden',
			border: '1px solid rgba(250, 204, 21, 0.8)',
			borderRadius: '8px',
			background: 'rgba(0, 0, 0, 0.72)',
			color: '#fde047',
			font: '11px/1.35 monospace',
			whiteSpace: 'pre-wrap',
			pointerEvents: 'none'
		} );
		document.body.appendChild( panel );
	}
	panel.textContent = `XR DEBUG（临时）\n${lines.join( '\n' )}`;

}

export function formatXrDebugPoint(point: { x: number; y: number; z: number }): string {

	return `${point.x.toFixed( 2 )},${point.y.toFixed( 2 )},${point.z.toFixed( 2 )}`;

}

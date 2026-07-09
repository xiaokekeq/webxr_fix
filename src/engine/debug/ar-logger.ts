const AR_DEBUG_ENABLED = import.meta.env.VITE_AR_DEBUG === 'true';

function formatTag(tag: string): string {
	return tag.startsWith( '[' ) ? tag : `[${tag}]`;
}

export function isArDebugEnabled(): boolean {
	return AR_DEBUG_ENABLED;
}

export function arDebug(tag: string, payload?: unknown): void {
	if ( AR_DEBUG_ENABLED === false ) {
		return;
	}
	writeConsole( console.debug, tag, payload );
}

export function arInfo(tag: string, payload?: unknown): void {
	if ( AR_DEBUG_ENABLED === false ) {
		return;
	}
	writeConsole( console.info, tag, payload );
}

export function arWarn(tag: string, payload?: unknown): void {
	writeConsole( console.warn, tag, payload );
}

export function arError(tag: string, payload?: unknown): void {
	writeConsole( console.error, tag, payload );
}

function writeConsole(
	writer: (message?: unknown, ...optionalParams: unknown[]) => void,
	tag: string,
	payload?: unknown
): void {
	if ( payload === undefined ) {
		writer( formatTag( tag ) );
		return;
	}
	writer( formatTag( tag ), payload );
}

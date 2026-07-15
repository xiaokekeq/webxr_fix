function formatTag(tag: string): string {
	return tag.startsWith( '[' ) ? tag : `[${tag}]`;
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

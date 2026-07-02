import type { PipeRecord } from '@/models/types/pipe-record.js';

export async function loadPipeRecords(pipesUrl: string): Promise<Map<string, PipeRecord>> {

	const response = await fetch( pipesUrl );
	if ( response.ok === false ) {
		throw new Error( `Failed to load pipes.json: HTTP ${response.status}` );
	}

	const data = await response.json();
	const pipes = Array.isArray( data ) ? data : data.pipes;
	if ( Array.isArray( pipes ) === false ) {
		throw new Error( 'pipes.json must be an array or an object with a pipes array.' );
	}

	return new Map( pipes.map( ( item: PipeRecord ) => [ item.name, item ] ) );

}

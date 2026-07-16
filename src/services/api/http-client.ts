export interface HttpClient {
	get<T>(url: string, params?: Record<string, unknown>): Promise<T>;
	post<T>(url: string, body?: unknown): Promise<T>;
	put<T>(url: string, body?: unknown): Promise<T>;
	delete<T>(url: string): Promise<T>;
}

interface FetchHttpClientOptions {
	baseUrl: string;
	timeoutMs?: number;
}

export class FetchHttpClient implements HttpClient {

	constructor(private readonly options: FetchHttpClientOptions) {}

	get<T>(url: string, params?: Record<string, unknown>): Promise<T> {

		return this.request<T>( 'GET', url, undefined, params );

	}

	post<T>(url: string, body?: unknown): Promise<T> {

		return this.request<T>( 'POST', url, body );

	}

	put<T>(url: string, body?: unknown): Promise<T> {

		return this.request<T>( 'PUT', url, body );

	}

	delete<T>(url: string): Promise<T> {

		return this.request<T>( 'DELETE', url );

	}

	private async request<T>(
		method: 'GET' | 'POST' | 'PUT' | 'DELETE',
		url: string,
		body?: unknown,
		params?: Record<string, unknown>
	): Promise<T> {

		const controller = new AbortController();
		const timeoutId = globalThis.setTimeout( () => {
			controller.abort();
		}, this.options.timeoutMs ?? 10000 );

		try {
			const response = await fetch( buildRequestUrl( this.options.baseUrl, url, params ), {
				method,
				headers: body === undefined ? undefined : {
					'Content-Type': 'application/json'
				},
				body: body === undefined ? undefined : JSON.stringify( body ),
				signal: controller.signal
			} );
			if ( response.ok === false ) {
				throw new Error( `HTTP ${response.status} ${response.statusText}` );
			}

			if ( response.status === 204 ) {
				return undefined as T;
			}

			return await response.json() as T;
		} catch ( error ) {
			if ( error instanceof DOMException && error.name === 'AbortError' ) {
				throw new Error( `Request timed out after ${this.options.timeoutMs ?? 10000}ms.` );
			}

			throw error;
		} finally {
			globalThis.clearTimeout( timeoutId );
		}

	}

}

function buildRequestUrl(
	baseUrl: string,
	url: string,
	params?: Record<string, unknown>
): string {

	const requestUrl = new URL( url, normalizeBaseUrl( baseUrl ) );
	if ( params !== undefined ) {
		for ( const [ key, value ] of Object.entries( params ) ) {
			if ( value === undefined || value === null ) {
				continue;
			}

			requestUrl.searchParams.set( key, String( value ) );
		}
	}

	return requestUrl.toString();

}

function normalizeBaseUrl(baseUrl: string): string {

	if ( baseUrl.trim().length === 0 ) {
		return window.location.origin;
	}

	return baseUrl.endsWith( '/' ) ? baseUrl : `${baseUrl}/`;

}

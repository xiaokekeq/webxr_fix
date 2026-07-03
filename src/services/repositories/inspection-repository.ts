import type { HttpClient } from '@/services/api/http-client.js';

export interface CreateInspectionRecordInput {
	siteId: string;
	result: string;
	riskLevel: string;
	note: string;
	snapshotUrl?: string;
	snapshotBase64?: string;
	createdBy?: string;
	createdAt?: number;
}

export interface InspectionRecord extends CreateInspectionRecordInput {
	inspectionId: string;
	createdAt: number;
}

export interface InspectionRepository {
	create(record: CreateInspectionRecordInput): Promise<InspectionRecord>;
	listBySite(siteId: string): Promise<InspectionRecord[]>;
	uploadSnapshot?(fileOrBase64: Blob | string): Promise<string>;
}

export class LocalStorageInspectionRepository implements InspectionRepository {

	async create(record: CreateInspectionRecordInput): Promise<InspectionRecord> {

		const nextRecord: InspectionRecord = {
			inspectionId: `inspection-${Date.now()}-${Math.random().toString( 36 ).slice( 2, 8 )}`,
			createdAt: record.createdAt ?? Date.now(),
			...record
		};
		const existing = await this.listBySite( record.siteId );
		writeInspectionRecords( record.siteId, [ nextRecord, ...existing ] );
		return nextRecord;

	}

	async listBySite(siteId: string): Promise<InspectionRecord[]> {

		return readInspectionRecords( siteId );

	}

}

export class ApiInspectionRepository implements InspectionRepository {

	constructor(private readonly http: HttpClient) {}

	create(record: CreateInspectionRecordInput): Promise<InspectionRecord> {

		return this.http.post<InspectionRecord>( '/api/inspections', record );

	}

	listBySite(siteId: string): Promise<InspectionRecord[]> {

		return this.http.get<InspectionRecord[]>( `/api/sites/${siteId}/inspections` );

	}

	uploadSnapshot(fileOrBase64: Blob | string): Promise<string> {

		return this.http.post<string>( '/api/files/snapshot', {
			payload: fileOrBase64
		} );

	}

}

function buildInspectionStorageKey(siteId: string): string {

	return `H5Dike.inspections.${siteId}`;

}

function readInspectionRecords(siteId: string): InspectionRecord[] {

	if ( typeof window === 'undefined' || typeof window.localStorage === 'undefined' ) {
		return [];
	}

	try {
		const raw = window.localStorage.getItem( buildInspectionStorageKey( siteId ) );
		if ( raw === null ) {
			return [];
		}

		const parsed = JSON.parse( raw ) as unknown;
		return Array.isArray( parsed )
			? parsed.filter( isInspectionRecord )
			: [];
	} catch {
		return [];
	}

}

function writeInspectionRecords(siteId: string, records: InspectionRecord[]): void {

	if ( typeof window === 'undefined' || typeof window.localStorage === 'undefined' ) {
		return;
	}

	window.localStorage.setItem( buildInspectionStorageKey( siteId ), JSON.stringify( records ) );

}

function isInspectionRecord(value: unknown): value is InspectionRecord {

	if ( typeof value !== 'object' || value === null ) {
		return false;
	}

	const candidate = value as Partial<InspectionRecord>;
	return typeof candidate.inspectionId === 'string'
		&& typeof candidate.siteId === 'string'
		&& typeof candidate.result === 'string'
		&& typeof candidate.riskLevel === 'string'
		&& typeof candidate.note === 'string'
		&& typeof candidate.createdAt === 'number';

}

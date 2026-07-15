import type { HttpClient } from '@/services/api/http-client.js';

export interface MonitoringSensor {
	id: string;
	siteId: string;
	name: string;
	type: string;
}

export interface SensorLatestValue {
	sensorId: string;
	value: number;
	unit: string;
	updatedAt: number;
	status: string;
}

export interface RiskPoint {
	id: string;
	siteId: string;
	name: string;
	level: string;
}

export interface HistoricalDiseaseRecord {
	id: string;
	siteId: string;
	title: string;
	status: string;
}

export interface MonitoringDataRepository {
	getSensors(siteId: string): Promise<MonitoringSensor[]>;
	getSensorLatest(sensorId: string): Promise<SensorLatestValue>;
	getRiskPoints(siteId: string): Promise<RiskPoint[]>;
	getHistoricalDiseases(siteId: string): Promise<HistoricalDiseaseRecord[]>;
}

export class MockMonitoringDataRepository implements MonitoringDataRepository {

	async getSensors(siteId: string): Promise<MonitoringSensor[]> {

		logMonitoringData( 'getSensors', siteId );
		return [];

	}

	async getSensorLatest(sensorId: string): Promise<SensorLatestValue> {

		logMonitoringData( 'getSensorLatest', sensorId );
		return {
			sensorId,
			value: 0,
			unit: '-',
			updatedAt: Date.now(),
			status: 'unknown'
		};

	}

	async getRiskPoints(siteId: string): Promise<RiskPoint[]> {

		logMonitoringData( 'getRiskPoints', siteId );
		return [];

	}

	async getHistoricalDiseases(siteId: string): Promise<HistoricalDiseaseRecord[]> {

		logMonitoringData( 'getHistoricalDiseases', siteId );
		return [];

	}

}

export class ApiMonitoringDataRepository implements MonitoringDataRepository {

	constructor(private readonly http: HttpClient) {}

	getSensors(siteId: string): Promise<MonitoringSensor[]> {

		return this.http.get<MonitoringSensor[]>( `/api/sites/${siteId}/sensors` );

	}

	getSensorLatest(sensorId: string): Promise<SensorLatestValue> {

		return this.http.get<SensorLatestValue>( `/api/sensors/${sensorId}/latest` );

	}

	getRiskPoints(siteId: string): Promise<RiskPoint[]> {

		return this.http.get<RiskPoint[]>( `/api/sites/${siteId}/risk-points` );

	}

	getHistoricalDiseases(siteId: string): Promise<HistoricalDiseaseRecord[]> {

		return this.http.get<HistoricalDiseaseRecord[]>( `/api/sites/${siteId}/historical-diseases` );

	}

}

function logMonitoringData(action: string, siteId: string): void {


}

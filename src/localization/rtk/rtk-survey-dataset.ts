export type RtkSurveyPointType =
	| 'site-origin'
	| 'marker-center'
	| 'marker-corner'
	| 'ground-control-point'
	| 'model-control-point'
	| 'underground-object'
	| 'sensor'
	| 'risk-point'
	| 'placement-anchor';

export type RtkSurveyPoint = {
	id: string;
	name?: string;
	type: RtkSurveyPointType;
	geodetic?: {
		longitude: number;
		latitude: number;
		altitude?: number;
	};
	enu?: [ number, number, number ];
	accuracyMeters?: number;
	measuredAt?: string;
	note?: string;
	relatedTargetId?: string;
	relatedObjectId?: string;
};

export type RtkSurveyDataset = {
	siteId: string;
	coordinateSystem: 'WGS84' | 'site-enu' | 'mixed';
	measuredAt?: string;
	source?: 'rtk-survey-json' | 'api' | 'manual-import';
	points: RtkSurveyPoint[];
};

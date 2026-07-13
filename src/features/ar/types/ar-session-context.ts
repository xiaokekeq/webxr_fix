import type { DemoModelConfig } from '@/models/config/demo-model-config.js';
import type {
	ArWorkflowMode,
	SiteCalibrationBaseline,
	VisualControlTarget
} from '@/features/ar/types/workflow.js';

export interface ArSessionContext {
	sessionId: string | null;
	mode: ArWorkflowMode;
	siteId: string;
	siteConfig: DemoModelConfig;
	baseline?: SiteCalibrationBaseline | null;
	controlTargets?: VisualControlTarget[];
}

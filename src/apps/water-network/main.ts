import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { createWaterNetworkRouter } from './router.js';
import { waterNetworkProjectConfig } from './project-config.js';
import { provideArApplicationContext } from '@/shared/config/project-config.js';
import { createProjectRepositories } from '@/services/repository-factory.js';
import { useWaterNetworkAppStore } from './stores/app.js';
import '@/styles/theme.css';

const app = createApp( App );
const pinia = createPinia();
const repositories = createProjectRepositories( waterNetworkProjectConfig );
app.use( pinia );
useWaterNetworkAppStore( pinia );
app.use( createWaterNetworkRouter() );
provideArApplicationContext( app, { projectConfig: waterNetworkProjectConfig, repositories } );
app.mount( '#app' );

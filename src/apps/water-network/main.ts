import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { createWaterNetworkRouter } from './router.js';
import { waterNetworkProjectConfig } from './project-config.js';
import { provideProjectConfig } from '@/shared/config/project-config.js';
import { configureRepositories } from '@/services/repository-factory.js';
import { useWaterNetworkAppStore } from './stores/app.js';
import '@/styles/theme.css';

const app = createApp( App );
const pinia = createPinia();
configureRepositories( waterNetworkProjectConfig );
app.use( pinia );
useWaterNetworkAppStore( pinia );
app.use( createWaterNetworkRouter() );
provideProjectConfig( app, waterNetworkProjectConfig );
app.mount( '#app' );

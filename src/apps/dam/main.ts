import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { createDamRouter } from './router.js';
import { damProjectConfig } from './project-config.js';
import { provideProjectConfig } from '@/shared/config/project-config.js';
import { configureRepositories } from '@/services/repository-factory.js';
import { useDamAppStore } from './stores/app.js';
import '@/styles/theme.css';

const app = createApp( App );
const pinia = createPinia();
configureRepositories( damProjectConfig );
app.use( pinia );
useDamAppStore( pinia );
app.use( createDamRouter() );
provideProjectConfig( app, damProjectConfig );
app.mount( '#app' );

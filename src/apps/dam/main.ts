import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { createDamRouter } from './router.js';
import { damProjectConfig } from './project-config.js';
import { provideArApplicationContext } from '@/shared/config/project-config.js';
import { createProjectRepositories } from '@/services/repository-factory.js';
import { useDamAppStore } from './stores/app.js';
import '@/styles/theme.css';

const app = createApp( App );
const pinia = createPinia();
const repositories = createProjectRepositories( damProjectConfig );
app.use( pinia );
useDamAppStore( pinia );
app.use( createDamRouter() );
provideArApplicationContext( app, { projectConfig: damProjectConfig, repositories } );
app.mount( '#app' );

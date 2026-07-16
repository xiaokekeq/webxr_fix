import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { VantResolver } from '@vant/auto-import-resolver';

export function createViteConfig(app: 'dam' | 'water-network') {
	const buildCommit = process.env.VERCEL_GIT_COMMIT_SHA?.slice( 0, 7 )
		?? process.env.GITHUB_SHA?.slice( 0, 7 )
		?? `v${process.env.npm_package_version ?? 'dev'}@${new Date().toISOString()}`;
	const isDam = app === 'dam';
	const outDir = path.resolve( __dirname, isDam ? 'dist/dam' : 'dist/water-network' );
	const projectAssets = path.resolve( __dirname, `public/projects/${app}` );

	return defineConfig( ( { command } ) => ( {
		root: path.resolve( __dirname, `src/apps/${app}` ),
		base: isDam ? '/dam/' : '/water-network/',
		publicDir: command === 'serve' ? path.resolve( __dirname, 'public' ) : false,
		define: { __BUILD_COMMIT__: JSON.stringify( buildCommit ) },
		plugins: [
			vue(),
			AutoImport( {
				dts: command === 'serve' ? path.resolve( __dirname, 'auto-imports.d.ts' ) : false,
				resolvers: [ VantResolver() ]
			} ),
			Components( {
				dts: command === 'serve' ? path.resolve( __dirname, 'components.d.ts' ) : false,
				resolvers: [ VantResolver() ]
			} ),
			...( command === 'build' ? [ {
				name: 'emit-project-assets',
				generateBundle() {
					const emitDirectory = ( directory: string, relativeDirectory = '' ) => {
						for ( const entry of readdirSync( directory, { withFileTypes: true } ) ) {
							const sourcePath = path.join( directory, entry.name );
							const relativePath = path.join( relativeDirectory, entry.name );
							if ( entry.isDirectory() ) {
								emitDirectory( sourcePath, relativePath );
							} else {
								this.emitFile( {
									type: 'asset',
									fileName: path.posix.join( 'projects', app, ...relativePath.split( path.sep ) ),
									source: readFileSync( sourcePath )
								} );
							}
						}
					};
					emitDirectory( projectAssets );
				}
			} ] : [] )
		],
		resolve: { alias: { '@': path.resolve( __dirname, 'src' ) } },
		server: {
			host: true,
			port: isDam ? 3002 : 3003,
			proxy: {
				'/api': { target: 'http://localhost:8080', changeOrigin: true },
				'/ws': { target: 'ws://localhost:8080', ws: true }
			}
		},
		build: {
			outDir,
			emptyOutDir: true,
			manifest: true
		}
	} ) );
}

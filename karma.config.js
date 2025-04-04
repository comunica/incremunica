const webkit = require('@playwright/test').webkit;
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');
const webpack = require('webpack');

const testFiles = [
  'engines/query-sparql-incremental/test-browser/QuerySparql-test.ts',
];

process.env.WEBKIT_HEADLESS_BIN = webkit.executablePath();

// Based on https://github.com/tom-sherman/blog/blob/main/posts/02-running-jest-tests-in-a-browser.md
module.exports = function(config) {
  config.set({
    basePath: '',
    plugins: [
      'karma-webpack',
      'karma-jasmine',
      'karma-chrome-launcher',
      'karma-firefox-launcher',
      'karma-webkit-launcher',
      'karma-sourcemap-loader',
      'karma-jasmine-html-reporter',
    ],
    frameworks: [ 'jasmine', 'webpack' ],

    files: [ './karma-setup.js', ...testFiles ],
    client: {
      args: [ '--grep', '/^(?!.*no browser).*$/' ],
    },
    preprocessors: {
      './karma-setup.js': [ 'webpack' ],
      ...Object.fromEntries(testFiles.map(key => [ key, [ 'webpack', 'sourcemap' ]])),
    },

    webpack: {
      mode: 'production',
      devtool: 'inline-source-map',
      resolve: {
        alias: {
          fs: false,
          module: false,
          'jest.unmock': false,
        },
        extensions: [ '.js', '.jsx', '.ts', '.tsx' ],
      },
      module: {
        rules: [
          {
            test: /\.tsx?$/u,
            loader: 'ts-loader',
            exclude: /node_modules/u,
            options: { transpileOnly: true },
          },
        ],
      },
      plugins: [
        new NodePolyfillPlugin({
          additionalAliases: [ 'process' ],
        }),
        new webpack.DefinePlugin({
          'process.stdout.isTTY': false,
        }),
      ],
      ignoreWarnings: [
        {
          module: /jest/u,
        },
        {
          module: /karma-setup/u,
        },
      ],
      stats: {
        colors: true,
        hash: false,
        version: false,
        timings: false,
        assets: false,
        chunks: false,
        modules: false,
        reasons: false,
        children: false,
        source: false,
        errors: false,
        errorDetails: false,
        warnings: false,
        publicPath: false,
      },
      performance: {
        hints: false,
      },
    },

    browsers: [
      'ChromeHeadless',
      'FirefoxHeadless',
      'WebkitHeadless',
    ],
  });
};

// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// react-i18next's ESM build (the one Metro picks via package.json
// "exports"/"module", since Expo SDK 52's Metro config enables package
// exports resolution by default) contains an internal relative import
// Metro's resolver can't follow:
//   Unable to resolve "./IcuTransUtils/index.js" from
//   "node_modules/react-i18next/dist/es/IcuTransWithoutContext.js"
// — even though that file genuinely exists on disk (confirmed: Node's own
// require.resolve() finds it fine). This is a known class of Metro/ESM
// interop bug with packages that ship explicit ".js"-extensioned internal
// imports in their "exports"-targeted build.
//
// react-i18next's "main" field already safely points at its well-tested
// CommonJS build (dist/commonjs/index.js), so disabling package-exports
// resolution sidesteps the broken ESM path entirely by falling back to
// classic "main"/"browser" field resolution for every package.
config.resolver.unstable_enablePackageExports = false;

module.exports = config;

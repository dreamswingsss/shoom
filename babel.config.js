// `babel-preset-expo` already auto-adds `react-native-worklets/plugin`
// whenever `react-native-worklets` is installed and `worklets`/`reanimated`
// aren't explicitly disabled (see node_modules/babel-preset-expo/build/
// index.js's own "Automatically add react-native-reanimated/plugin" branch)
// — both are true here (react-native-reanimated v4 depends on the separate
// react-native-worklets package for its babel transform). Listing the
// plugin again here ran the worklets transform TWICE over the same code,
// producing malformed worklet output that crashed the native UI runtime on
// launch (every screen in this app renders an Animated/worklet-driven
// component immediately — TabNavigator, FadeInView, etc.).
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};

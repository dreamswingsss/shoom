// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const i18next = require('eslint-plugin-i18next');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    files: ['src/**/*.js', 'App.js'],
    plugins: { i18next },
    rules: {
      // Flags a literal string rendered directly as JSX text, e.g.
      // <Text>Skip</Text> or <Text>{isLastStep ? 'Finish' : 'Next'}</Text>.
      // `mode: 'jsx-text-only'` only fires when the literal's direct
      // parent is the JSXElement/JSXFragment itself — this is the
      // narrowest, lowest-noise mode the plugin has. The wider 'jsx-only'
      // mode (which also walks JSX *attributes*) was tried and rejected:
      // its "inside JSX" check is ancestor-based, not attribute-based, so
      // it also flags plain internal string literals in any function that
      // happens to be lexically nested inside a JSX expression container
      // (e.g. `{list.map((item) => { navigation.navigate('Planner'); ... })}`)
      // — in a component-heavy RN codebase that's most of the code, not
      // just user-facing copy. The two attribute cases the wider mode was
      // meant to catch (placeholder, Tab.Screen options={{ title }}) are
      // covered by the two targeted no-restricted-syntax rules below
      // instead, which match the attribute directly rather than walking
      // ancestors.
      'i18next/no-literal-string': ['error', { mode: 'jsx-text-only' }],

      // Two gaps `no-literal-string` can't reach (neither mode inspects
      // plain CallExpression arguments or JSXAttribute values other than
      // via the noisy ancestor-walk rejected above), closed with precise
      // selectors instead of widening the rule above:
      'no-restricted-syntax': [
        'error',
        {
          // Alert.alert('Title', 'Message') — title/message hardcoded
          // instead of coming from t(...). Doesn't match
          // Alert.alert(t('x'), t('y')) since t(...) is a CallExpression,
          // not a Literal.
          selector:
            "CallExpression[callee.object.name='Alert'][callee.property.name='alert'] > Literal[value=/[A-Za-z]/]",
          message:
            'Alert.alert(...) text must come from t(...), not a hardcoded string — wrap it: Alert.alert(t("namespace.key"), ...).',
        },
        {
          // <TextInput placeholder="Ask your stylist..." /> — matches the
          // attribute's own literal value directly (not everything nested
          // under it), so it can't cross-contaminate unrelated code the
          // way widening no-literal-string's mode did.
          selector: "JSXAttribute[name.name='placeholder'] > Literal[value=/[A-Za-z]/]",
          message: 'placeholder text must come from t(...): placeholder={t("namespace.key")}.',
        },
        {
          // <Tab.Screen options={{ title: 'Closet' }} /> style nav titles
          // — doesn't exist in this codebase yet (the custom tab bar reads
          // TAB_CONFIG/t() instead), kept here so it's caught the moment
          // someone adds a React-Navigation-native title instead of
          // extending TAB_CONFIG.
          selector:
            "JSXAttribute[name.name='options'] Property[key.name='title'] > Literal[value=/[A-Za-z]/]",
          message: 'Navigation title text must come from t(...): options={{ title: t("namespace.key") }}.',
        },
      ],
    },
  },
]);

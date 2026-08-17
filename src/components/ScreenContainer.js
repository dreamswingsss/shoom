import { forwardRef } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../theme/tokens';

// The one root wrapper every screen renders through — replaces each
// screen's own ad hoc SafeAreaView/useSafeAreaInsets combo (several
// screens computed their own `insets.top + <magic number>`, and every one
// of them picked a different horizontal padding: 16, 20, 24, spacing.sm,
// spacing.md — no two screens agreed). Centralizing both concerns here is
// what makes "strict 16px screen margin" and "content never sits under the
// notch or the home indicator" true APP-WIDE instead of screen-by-screen.
//
//   edges        — which sides get a real safe-area inset (default
//                   ['top','bottom']). Pass ['top'] for a tab screen
//                   sitting above TabNavigator's own floating bar — that
//                   bar already insets itself off insets.bottom, so a
//                   second bottom inset here would double it up.
//   scroll        — true (default) renders content in a ScrollView, for
//                   any screen whose content can exceed one screen's
//                   height; pass false for a screen that owns its own
//                   internal scrolling (e.g. a FlatList-based screen) and
//                   only needs the safe-area + padding shell.
//   contentStyle  — merged onto the content container (ScrollView's
//                   contentContainerStyle, or the plain View when
//                   scroll=false) — e.g. extra paddingBottom to clear a
//                   floating action button, or `{ flexGrow: 0 }` to let a
//                   FlatList child manage its own height.
//   style         — merged onto the outer SafeAreaView (background color
//                   overrides, mostly).
//
// forwardRef — a couple of screens keep a ref to their own scroll container
// (WardrobeScreen's hubScrollRef, for a future scroll-to-top-on-tab-press),
// so this has to pass a caller's ref through to the real ScrollView/View
// underneath rather than swallowing it.
const ScreenContainer = forwardRef(function ScreenContainer(
  { children, edges = ['top', 'bottom'], scroll = true, style, contentStyle, ...rest },
  ref
) {
  if (!scroll) {
    return (
      <SafeAreaView edges={edges} style={[styles.safeArea, style]}>
        {/* `flexShrink: 1, minHeight: 0` on top of `content`'s own
            `flexGrow: 1` — the actual bug, not decoration. React Native's
            own layout engine (Yoga) defaults `flexShrink` to 0, unlike
            plain CSS flexbox where it defaults to 1 — react-native-web
            correctly replicates THAT default, so any View using the
            `flexGrow`/`flexShrink` LONGHAND form (as `content` below does)
            without explicitly setting `flexShrink: 1` silently refuses to
            ever shrink below its own children's natural content height on
            web, no matter how little space its parent actually gave it.
            (The `flex: 1` SHORTHAND used elsewhere in this app doesn't have
            this problem — the shorthand form always sets shrink: 1 as part
            of expanding to the three longhand properties.) Concretely: this
            View sizing to its content instead of the space React
            Navigation's BottomTabView actually gave this screen (a
            fixed-height, `overflow: hidden` wrapper it manages itself) is
            what silently hard-clipped a screen's own content — usually its
            own internal ScrollView, e.g. WardrobeScreen's hub — well before
            that inner ScrollView ever got a bounded box to scroll within.
            Confirmed empirically (DevTools computed styles across the whole
            chain, testID-tagged and inspected one link at a time) before
            landing on this fix — not guessed. Left off `styles.content`
            itself since the `scroll={true}` branch below reuses it as a
            ScrollView's `contentContainerStyle`, a completely different
            context where content SHOULD grow to its natural size, not get
            clamped. */}
        <View ref={ref} style={[styles.content, { flexShrink: 1, minHeight: 0 }, contentStyle]} {...rest}>
          {children}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={edges} style={[styles.safeArea, style]}>
      <ScrollView
        ref={ref}
        style={styles.flexFill}
        contentContainerStyle={[styles.content, contentStyle]}
        showsVerticalScrollIndicator={false}
        {...rest}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
});

export default ScreenContainer;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  flexFill: { flex: 1 },
  // The ONE place the strict 16px screen margin lives. `alignItems:
  // 'stretch'` (the flexbox default for a column, made explicit here per
  // the design-grid rule) plus `width: '100%'` on children is what lets
  // content fill the available width instead of any screen reaching for a
  // hardcoded pixel width.
  content: {
    flexGrow: 1,
    width: '100%',
    alignItems: 'stretch',
    paddingHorizontal: spacing.screenH,
  },
});

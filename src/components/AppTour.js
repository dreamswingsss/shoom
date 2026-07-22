import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Dimensions,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  UIManager,
  View,
  findNodeHandle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, Mask, Rect } from 'react-native-svg';
import { Feather } from '@expo/vector-icons';
import { colors, radius, shadows, spacing, typography, withAlpha } from '../theme/tokens';
import { triggerHaptic } from '../utils/haptics';

// Hand-rolled coach-mark overlay — not react-native-copilot (or any other
// third-party tour lib). Both react-native-copilot and
// react-native-walkthrough-tooltip haven't cut a release since well before
// this app's SDK 52 -> 54 / React Native 0.81 / Reanimated 4 upgrade, and
// neither publishes New Architecture support, so this stays hand-rolled —
// but on top of stable RN core APIs (View.measureInWindow, ScrollView.scrollTo)
// plus two dependencies already used elsewhere in this app: react-native-svg
// (ColorSwatchPicker, BodyShapeSelector) for a real rounded-rect cutout mask,
// and react-native-reanimated (TabNavigator) for the entrance animation.
//
// One provider for the whole app (mounted once in App.js, wrapping
// RootNavigator — see useAppTour below), not one per screen. A step's
// TourTarget can then live anywhere in the tree — including the bottom tab
// bar's Profile icon, which TabNavigator renders as a sibling/ancestor of
// WardrobeScreen, not a descendant, so a screen-local provider could never
// have reached it.
const TourContext = createContext(null);

// Lets any screen kick off a tour (register its own steps + start it) and
// have `TourTarget`s from a totally different part of the tree — e.g. the
// tab bar — participate, since both read/write the one AppTourProvider
// mounted near the root.
export function useAppTour() {
  return useContext(TourContext);
}

// Overlay backdrop — deliberately darker/more opaque than colors.overlay
// (the app's usual modal backdrop, ink@0.4) since a coach mark needs the
// spotlighted element to read as clearly singled-out, not just dimmed.
const TOUR_BACKDROP = withAlpha(colors.textPrimary, 0.78);
const SPOTLIGHT_PADDING = 8;
const TOOLTIP_MAX_WIDTH = 320;
// Half the tooltip's pointer-arrow triangle width — used both to size the
// triangle itself (see the `tooltipArrow*` styles) and to center it under
// its own computed `left` offset (TourTooltip's own comment covers the
// clamping math).
const ARROW_HALF_WIDTH = 8;
// Small pauses around a scroll, not a single guessed total: one short beat
// to let a just-registered rect's requestAnimationFrame actually land
// before reading it, a longer one to let ScrollView's own scroll-to
// animation finish before re-measuring the (now moved) target.
const MEASURE_SETTLE_MS = 80;
const SCROLL_SETTLE_MS = 400;
// A step whose `onEnter` navigates to a different tab points at a
// TourTarget that doesn't exist yet the instant that step becomes current
// — the destination screen (and its own TourTarget's registerTarget
// effect) is only just now mounting. Polled at this interval, up to this
// timeout, instead of assuming the target is already registered the way
// every other (same-screen) step safely can.
const TARGET_WAIT_INTERVAL_MS = 50;
const TARGET_WAIT_TIMEOUT_MS = 2500;
const TOOLTIP_ENTER_SPRING = { damping: 16, stiffness: 180 };
const BACKDROP_FADE_MS = 220;
// One pulse cycle: a ring grows outward from the static outline while
// fading out, then instantly resets — a "radar ping" reading as "look
// here" without being distracting enough to fight for attention against
// the tooltip's own text.
const PULSE_DURATION_MS = 1400;
const PULSE_MAX_SCALE = 1.12;
// A step's `floatingAction` (see TourFloatingAction below) pulses at this
// scale/speed — deliberately the same values WardrobeScreen's own scanCta
// button pulse used to drive directly on the real button, so switching that
// step from "real button revealed through a cutout" to "duplicate button
// drawn on the hole-free backdrop" (see TourSpotlight's own `hideCutout`)
// didn't also change how the pulse itself looks or feels.
const FLOATING_ACTION_PULSE_SCALE = 1.05;
const FLOATING_ACTION_PULSE_MS = 700;
// Per-character reveal speed for the tooltip's typewriter effect — fast
// enough that a short one-line tip doesn't feel sluggish to read, slow
// enough to actually register as a deliberate effect rather than a flicker.
const TYPEWRITER_CHAR_MS = 16;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Reveals `text` a character at a time on a plain JS interval — a
// typewriter effect doesn't need Reanimated's UI-thread guarantees (it's
// not a gesture-driven or continuous animation, just a slow state change a
// few times a second), so a setInterval + substring is simpler than
// modeling "how many characters" as a shared value. Resets and replays
// whenever `text` itself changes, which happens naturally here since
// TourOverlay remounts TourTooltip fresh on every step (see its own
// `key={currentStep.id}`).
function useTypewriter(text) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(0);
    if (!text) return undefined;

    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setCount(i);
      if (i >= text.length) clearInterval(id);
    }, TYPEWRITER_CHAR_MS);

    return () => clearInterval(id);
  }, [text]);

  return text.slice(0, count);
}

// Wraps whichever element a tour step should point at. Registers its rect
// (via measureInWindow, not onLayout's parent-relative one), a re-measure
// function, AND the raw native viewRef itself into AppTourProvider above it,
// keyed by `id` — AppTourProvider reads the rect back out to position the
// spotlight/tooltip, calls the re-measure function on its own before
// showing a step (a target's on-screen position can be stale from a
// previous step's scroll, or from content above it changing size, not just
// from its own layout), and calls `viewRef.current.measureLayout(...)`
// directly against a step's ScrollView to compute a scroll-content-relative
// position for auto-centering (see prepareStep in AppTourProvider below) —
// something a bare remeasure function can't expose on its own. Renders
// nothing extra itself: a plain View wrapper.
//
// `collapsable={false}` is required, not decorative: without it, Android's
// view-flattening optimization can fold this View into its parent since it
// has no background/border of its own, which breaks both measureInWindow
// (wrong node) and measureLayout (node no longer exists as a distinct
// native view to measure against).
//
// IMPORTANT for callers: never put margin directly on this component's own
// child — Yoga includes a shrink-to-fit child's margin in ITS OWN
// auto-computed box, so a `<TourTarget><Text style={{margin: 12}}/></TourTarget>`
// measures larger than the child visually appears. Put margin on a separate
// outer wrapper View instead, with TourTarget wrapping only the actual
// visual element (see WardrobeScreen.js for the established pattern).
//
// `borderRadius` travels with the rect so the spotlight's cutout can match
// this specific element's own shape — a bento card (`radius.card`), a pill
// tab button (`radius.pill`), whatever the caller passes — instead of every
// step getting the same hardcoded corner.
export function TourTarget({ id, children, style, borderRadius = radius.card }) {
  const ctx = useContext(TourContext);
  const viewRef = useRef(null);

  const measure = useCallback(() => {
    // Deferred TWO frames, not one — right after mount/a ScrollView content
    // change, or while an entrance animation (e.g. WardrobeScreen's
    // FadeInView, which fades+slides every tour target in on mount) is
    // still playing, a single requestAnimationFrame often lands before the
    // native side has actually committed/painted the final frame, and
    // measureInWindow — which reports genuine on-screen position, transform
    // included — can catch a still-mid-slide or still-mid-layout rect. One
    // rAF only guarantees "the NEXT frame is about to run", not "the
    // previous layout/paint has landed"; a second rAF nested inside the
    // first is the standard way to wait for that frame to have actually
    // committed before reading from it. Cheap (one extra ~16ms tick) and
    // eliminates a whole class of "highlight box is offset/oversized"
    // reports that were really just a measurement taken one frame too early.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        viewRef.current?.measureInWindow((x, y, width, height) => {
          if (width > 0 && height > 0) {
            ctx?.registerRect(id, { x, y, width, height, borderRadius });
          }
        });
      });
    });
  }, [ctx, id, borderRadius]);

  // Deliberately depends on the individual `registerTarget`/`unregisterTarget`
  // functions (both useCallback([])-stable — see AppTourProvider's own
  // comment) rather than on `ctx` itself. `ctx`'s wrapping object now also
  // carries reactive fields (`activeStepId`, current step tracking for the
  // pulse/arrow features below) that legitimately change on every step
  // transition — if this effect keyed off `ctx` as a whole, every mounted
  // TourTarget in the app would re-run its register/unregister cleanup on
  // EVERY step change, which is exactly the churn that used to cause false
  // "target vanished" auto-advances (see unregisterTarget's own comment).
  // Keying off the two stable functions instead means this effect only
  // ever re-runs on a genuine mount/unmount, regardless of what else in the
  // context value is changing.
  useEffect(() => {
    ctx?.registerTarget(id, { remeasure: measure, viewRef });
    return () => ctx?.unregisterTarget(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.registerTarget, ctx?.unregisterTarget, id]);

  return (
    <View ref={viewRef} onLayout={measure} style={style} collapsable={false}>
      {children}
    </View>
  );
}

// Drives the actual step machine + renders the spotlight/tooltip overlay.
// Mounted exactly once, near the app root (App.js) — individual screens
// don't own a provider of their own, they call `startTour` (from
// `useAppTour()`) with their own step list instead. That's what lets one
// tour span multiple independently-rendered parts of the tree.
export function AppTourProvider({ children }) {
  const [rects, setRects] = useState({});
  const [steps, setSteps] = useState([]);
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [stepReady, setStepReady] = useState(false);
  const rectsRef = useRef({});
  const targetsRef = useRef({});
  const onFinishRef = useRef(null);
  // Holds the CALLER's scrollViewRef (optional — only a screen whose
  // targets can sit outside the viewport, like WardrobeScreen's hub, needs
  // to pass this). A ref, not state: read inside the step-prepare effect
  // below, not something a re-render should react to.
  const activeScrollRef = useRef(null);

  // Bails out before ever touching state if the incoming rect is pixel-
  // identical to what's already registered for this id — a genuine no-op
  // guard, not a timer-based debounce (a fixed delay would just add lag to
  // every legitimate measurement). `onLayout` firing without the actual
  // on-screen box having changed (e.g. a parent re-rendering for an
  // unrelated reason) is normal RN behavior, not a bug in itself; letting
  // every such firing through to `setRects` is what turns it into one —
  // each call was a fresh state update, a fresh AppTourProvider re-render,
  // and one more opportunity for whatever's reading `rects` downstream to
  // treat "still the same rect" as "something changed".
  const registerRect = useCallback((id, rect) => {
    const prev = rectsRef.current[id];
    if (
      prev &&
      prev.x === rect.x &&
      prev.y === rect.y &&
      prev.width === rect.width &&
      prev.height === rect.height &&
      prev.borderRadius === rect.borderRadius
    ) {
      return;
    }
    rectsRef.current = { ...rectsRef.current, [id]: rect };
    setRects(rectsRef.current);
  }, []);

  // `target` is `{ remeasure, viewRef }` — see TourTarget's own comment for
  // why the raw viewRef needs to travel too, not just a remeasure callback.
  const registerTarget = useCallback((id, target) => {
    targetsRef.current[id] = target;
  }, []);

  // Mirrors of `active`/`steps`/`stepIndex` kept current on every render (not
  // via useEffect — a child's cleanup can fire in the very same commit that
  // changed these, before an effect would've re-run) so unregisterTarget
  // below always reasons about the CURRENT step, not a stale one captured
  // when this useCallback was first created.
  const activeRef = useRef(active);
  activeRef.current = active;
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const stepIndexRef = useRef(stepIndex);
  stepIndexRef.current = stepIndex;

  // A TourTarget unmounting mid-tour isn't just cleanup — if it's the
  // target the CURRENT step points at, it means the thing that step was
  // explaining just disappeared out from under it. That happens whenever a
  // step's target is itself conditional on the very state the step is
  // teaching about — e.g. WardrobeScreen's `scanCta` step wraps the
  // empty-closet CTA, which is conditionally rendered on `isEmptyCloset`;
  // successfully scanning the first item (the exact action that step asks
  // for) flips `isEmptyCloset` false and unmounts it mid-step.
  //
  // Without this, the stale rect stayed in `rects` forever (nothing ever
  // cleared it), so `currentRect`/`showOverlay` stayed truthy with no
  // TourTarget left to re-measure — a permanently-shown spotlight anchored
  // to a rect that no longer corresponds to anything on screen, whose
  // invisible touch-blocking mask (see TourSpotlight) sat over the whole
  // Closet tab with no Skip/Finish tap able to reach it either, since the
  // tooltip itself was positioned off the now-stale rect. That's the
  // "Closet is frozen after saving the first item" bug. The fix: treat a
  // vanishing CURRENT-step target as an implicit "done here" and move on,
  // exactly like the user having tapped Next themselves.
  // Set for the duration of any step transition — whether started by a
  // manual Next/Skip tap (handleNext/handleSkip) or by this same target
  // vanishing mid-step (below) — and checked by BOTH paths before either
  // is allowed to move `stepIndex`/`active` on its own. Without this, a
  // target unmounting in the same commit as a manual Next tap (e.g. a step
  // whose `onEnter` navigation causes upstream content to reflow right as
  // the client taps Next) could fire BOTH `unregisterTarget`'s auto-advance
  // AND `handleNext`'s own `setStepIndex` for the SAME logical transition —
  // one tap, two increments — which either skips a step outright or, if
  // the second increment lands back on a step whose rect was already
  // registered from earlier, redisplays it, reading as "this hint showed
  // twice". Cleared once the new step actually finishes preparing (see the
  // auto-scroll effect's own `setStepReady(true)`/cleanup below), not on a
  // timer — exactly as long as a transition is genuinely in flight, no
  // more.
  const transitioningRef = useRef(false);

  const unregisterTarget = useCallback((id) => {
    delete targetsRef.current[id];

    if (!activeRef.current || transitioningRef.current) return;
    const idx = stepIndexRef.current;
    const currentSteps = stepsRef.current;
    if (currentSteps[idx]?.id !== id) return;

    transitioningRef.current = true;

    setRects((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      rectsRef.current = next;
      return next;
    });

    if (idx >= currentSteps.length - 1) {
      transitioningRef.current = false;
      setActive(false);
      // `true` — this is the same "genuinely reached the end" case as
      // handleNext's own finishTour(true) below, just triggered by the
      // step's target vanishing instead of a Finish tap (see this
      // function's own comment for why that counts as done, not skipped).
      onFinishRef.current?.(true);
    } else {
      setStepReady(false);
      setStepIndex((i) => i + 1);
    }
  }, []);

  // Lets a screen finish the CURRENT step by the client interacting with
  // the REAL element the step points at, instead of the tooltip's own
  // Next/Finish button — needed for any step whose tooltip hides its
  // action row (`hideActions: true`, see TourTooltip below), since those
  // steps have no in-overlay button left to advance them at all. E.g.
  // WardrobeScreen's `scanCta` step: the tooltip shows text only, and the
  // REAL "Add Item" button (pulsing to draw the eye — see that screen's own
  // comment) is what the client actually taps; that tap calls this with
  // `'scanCta'` alongside its own `handleScan()`, so tapping the real
  // button both opens the scanner AND genuinely finishes the tour, exactly
  // as if Finish had been tapped.
  //
  // Deliberately mirrors `unregisterTarget`'s own step-advance logic
  // (same idx/length check, same `transitioningRef` guard) rather than
  // calling `handleNext` — `handleNext` reads `isLastStep`/`currentStep`
  // from render-time closures, which is fine for a tooltip button (always
  // rendered fresh each step) but not for a callback a caller might invoke
  // from an event handler captured earlier; reading through the same refs
  // `unregisterTarget` already uses keeps this correct regardless of when
  // it's actually called. A no-op (returns without changing anything) if
  // the tour isn't active or isn't currently on `stepId` — safe to call
  // unconditionally from a button that works the same whether the tour is
  // running or not.
  const completeStepIfActive = useCallback((stepId) => {
    if (!activeRef.current || transitioningRef.current) return;
    const idx = stepIndexRef.current;
    const currentSteps = stepsRef.current;
    if (currentSteps[idx]?.id !== stepId) return;

    transitioningRef.current = true;

    if (idx >= currentSteps.length - 1) {
      transitioningRef.current = false;
      setActive(false);
      onFinishRef.current?.(true);
    } else {
      setStepReady(false);
      setStepIndex((i) => i + 1);
    }
  }, []);

  // `tourSteps` — a plain array of { id, text, skipLabel, nextLabel,
  // finishLabel, onEnter } — plus optional `{ onFinish, scrollViewRef }`.
  // `onEnter` is optional per-step: called right before this tries to
  // measure that step's target, so a step covering content on a DIFFERENT
  // tab can navigate there first (e.g. `() => navigation.navigate('Profile')`)
  // — see waitForTargetRegistration in the step-prepare effect below for how
  // this waits out that screen's mount. Always resets to step 0, even if a
  // tour is somehow already active, so a screen re-triggering this (which
  // shouldn't normally happen — each tour only ever runs once per
  // hasSeenAppTour flip) can't land mid-sequence.
  //
  // De-dupes `tourSteps` by `id` before storing them (keeping the FIRST
  // occurrence of any repeated id) — belt-and-suspenders against a caller's
  // step array accidentally listing the same target twice, which would
  // otherwise show its tooltip back-to-back for two separate Next taps
  // ("this hint appeared twice") even though nothing else was wrong.
  const startTour = useCallback((tourSteps, options = {}) => {
    const seen = new Set();
    const dedupedSteps = tourSteps.filter((step) => {
      if (seen.has(step.id)) {
        if (__DEV__) {
          console.warn(`[AppTour] Duplicate step id "${step.id}" in startTour() — dropping the repeat.`);
        }
        return false;
      }
      seen.add(step.id);
      return true;
    });

    onFinishRef.current = options.onFinish || null;
    activeScrollRef.current = options.scrollViewRef || null;
    transitioningRef.current = false;
    setSteps(dedupedSteps);
    setStepIndex(0);
    setActive(true);
  }, []);

  const currentStep = steps[stepIndex];
  const currentRect = currentStep ? rects[currentStep.id] : null;
  const isLastStep = stepIndex === steps.length - 1;

  // Auto-scroll — always centers the upcoming step's target on screen
  // BEFORE letting the spotlight/tooltip show, using measureLayout against
  // the caller's ScrollView native node rather than tracking scroll offset
  // by hand. Re-runs on every stepIndex change (each step needs its own
  // scroll check), guarded by `cancelled` so a fast Skip/Finish during the
  // sleeps below can't apply a stale step's result.
  //
  // Deliberately depends on `currentStep?.id` (a primitive string), NOT
  // `currentStep` itself (an object reference) — this used to be the
  // actual cause of a real infinite loop: this effect's own
  // `setStepReady(true)` at the end fed back into `AppTourProvider`'s
  // context value (via `activeStepId`, used by consumers like
  // WardrobeScreen's pulse effect), which changed that context object's
  // identity — and WardrobeScreen's tour-LAUNCH effect used to list the
  // whole context object in its own dependency array. Every time a step
  // finished preparing, that context identity change re-fired the launch
  // effect, which called `startTour([...fresh step objects...])` again —
  // same step ids, same `stepIndex`, but a BRAND NEW `currentStep` object
  // reference — which this effect's old `[active, stepIndex, currentStep]`
  // deps treated as a genuine new step, re-running the whole
  // measure-then-scroll sequence from scratch. That set `stepReady` false
  // then true again, which changed `activeStepId` again, which re-fired
  // the launch effect again — forever. (WardrobeScreen's own launch effect
  // is now fixed to depend on the STABLE `tour?.startTour` function instead
  // of `tour` itself, which is the actual root-cause fix — see that
  // screen's own comment. This dependency change is the second, defense-
  // in-depth layer: even if some OTHER future caller re-invokes `startTour`
  // with fresh-but-equivalent step objects for a step that's already
  // current, this effect won't mistake that for a real step change and
  // restart the measure/scroll sequence, since the id — the only thing
  // that actually identifies "which step" — didn't change.)
  useEffect(() => {
    if (!active || !currentStep) return undefined;

    let cancelled = false;
    setStepReady(false);

    // Polls targetsRef instead of assuming `currentStep.id`'s TourTarget is
    // already registered — true for every ordinary (same-screen) step on
    // the very first check, but a step whose `onEnter` just navigated to a
    // different tab needs to wait for that screen's own TourTarget to
    // actually mount and self-register first.
    async function waitForTargetRegistration(id) {
      const deadline = Date.now() + TARGET_WAIT_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (cancelled) return null;
        const target = targetsRef.current[id];
        if (target) return target;
        await sleep(TARGET_WAIT_INTERVAL_MS);
      }
      return targetsRef.current[id] || null;
    }

    // Asks the target's own native node where it sits relative to the
    // ScrollView's content (NOT the window) — independent of the current
    // scroll offset, which is what makes this correct even for a target
    // near the very bottom of a long list. Resolves `null` (never throws,
    // never rejects) whenever this can't be answered, for any reason —
    // target not actually a descendant of that ScrollView (e.g.
    // WardrobeScreen's `scanCta`, which floats outside the scrollable hub),
    // a ref that hasn't attached to its native view yet, a target that
    // unmounted mid-measure — so the caller can always just skip scrolling
    // for that step instead of the tour crashing.
    //
    // Deliberately goes through `UIManager.measureLayout(viewHandle,
    // scrollHandle, onFail, onSuccess)` — two resolved native node HANDLES
    // — rather than `viewRef.current.measureLayout(scrollHandle, ...)`. The
    // latter calls `measureLayout` as a METHOD on the ref itself, which
    // throws "ref.measureLayout must be called with a ref to a native
    // component" the instant that ref is anything other than a raw
    // host-component instance (e.g. mid-mount, mid-unmount, or wrapped by
    // something that changes what the ref actually points at) — a crash
    // that took down the whole tour with a red screen. Resolving both
    // sides to plain node handles via `findNodeHandle` up front and calling
    // the static UIManager method instead needs nothing from the ref
    // except "does findNodeHandle currently resolve it at all", so a
    // not-yet-attached or already-detached ref just fails to produce a
    // handle — an ordinary null check — instead of throwing.
    function measureRelativeToScroll(viewRef, scrollView) {
      return new Promise((resolve) => {
        try {
          const viewHandle = viewRef?.current ? findNodeHandle(viewRef.current) : null;
          const scrollHandle = scrollView ? findNodeHandle(scrollView) : null;

          if (!viewHandle || !scrollHandle) {
            resolve(null);
            return;
          }

          UIManager.measureLayout(
            viewHandle,
            scrollHandle,
            () => resolve(null), // onFail — e.g. target isn't inside this scroll container
            (x, y, width, height) => resolve({ y, height }) // onSuccess
          );
        } catch (_err) {
          // Belt-and-suspenders: some platform/UIManager implementations
          // can throw synchronously (rather than calling onFail) for a
          // handle that resolved but is already stale. Either way, this
          // step's auto-scroll is skippable — remeasure() right after this
          // resolves is what actually keeps the tour on-screen regardless.
          resolve(null);
        }
      });
    }

    async function prepareStep() {
      // Nav steps (e.g. "switch to the Profile tab, then spotlight
      // something there") do the actual navigation here, BEFORE this tries
      // to measure anything — see this step's own `onEnter` at the
      // call site (WardrobeScreen's tour.startTour).
      currentStep.onEnter?.();

      const target = await waitForTargetRegistration(currentStep.id);
      if (cancelled || !target) return;

      const { remeasure, viewRef } = target;
      const scrollView = activeScrollRef.current?.current;

      if (scrollView) {
        const contentRelative = await measureRelativeToScroll(viewRef, scrollView);
        if (cancelled) return;

        if (contentRelative) {
          const { height: screenH } = Dimensions.get('window');
          const targetScrollY = Math.max(contentRelative.y + contentRelative.height / 2 - screenH / 2, 0);

          scrollView.scrollTo({ y: targetScrollY, animated: true });
          await sleep(SCROLL_SETTLE_MS);
          if (cancelled) return;
        }
      }

      // Final window-relative rect for the spotlight/tooltip — read AFTER
      // any scroll above has settled, never before, so the overlay can't
      // flash at a pre-scroll position for a frame.
      remeasure();
      await sleep(MEASURE_SETTLE_MS);
      if (cancelled) return;

      if (!cancelled) {
        // This step has genuinely finished preparing — the transition that
        // started it (a manual Next/Skip tap, or a vanished-target
        // auto-advance) is over, so either path is free to start a NEW one
        // again from here. Only the run that actually reaches this point
        // uncommented by a newer transition clears the flag — a superseded
        // run's cleanup below (`cancelled = true`) deliberately leaves it
        // alone, since the newer transition that superseded it owns
        // clearing it instead.
        transitioningRef.current = false;
        setStepReady(true);
      }
    }

    prepareStep();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepIndex, currentStep?.id]);

  // `completed` — true when the client actually walked to the last step and
  // tapped its Finish button, false when they backed out early via Skip.
  // Callers that only want "mark the tour as seen" bookkeeping can ignore
  // the arg; WardrobeScreen's own onFinish uses it to decide whether
  // finishing the tour should also carry the client straight into scanning
  // their first item (see that screen's own comment) — Skip shouldn't.
  function finishTour(completed) {
    transitioningRef.current = false;
    setActive(false);
    onFinishRef.current?.(completed);
  }

  // Guarded by `transitioningRef` — belt-and-suspenders against a fast
  // double-tap (or any double-fired touch event) enqueueing two advances
  // for what the client experienced as a single press. `isLastStep`/
  // `finishTour` don't need the same guard: `finishTour` already sets
  // `active` false synchronously, and `showOverlay` (which the Next/Skip
  // buttons live inside) unmounts the instant `active` does, so a second
  // stray tap has nothing left to land on. One tap here is always exactly
  // one step advance — never zero (swallowed), never two.
  function handleNext() {
    if (transitioningRef.current) return;
    triggerHaptic();
    if (isLastStep) {
      finishTour(true);
    } else {
      transitioningRef.current = true;
      setStepReady(false);
      setStepIndex((i) => i + 1);
    }
  }

  function handleSkip() {
    if (transitioningRef.current) return;
    triggerHaptic();
    finishTour(false);
  }

  // Waits for `stepReady` (not just `currentRect`) before showing the
  // overlay — otherwise a step whose target needed scrolling would flash
  // its spotlight at the OLD (pre-scroll) position for a frame before
  // jumping. This also flips false->true->false->true across every step
  // transition, which is what gives TourOverlay below a genuine mount (via
  // its `key`) to animate in from on each step, not just the first.
  const showOverlay = active && Boolean(currentStep) && Boolean(currentRect) && stepReady;

  // Android's hardware back button used to be handled by <Modal>'s own
  // onRequestClose; now that the overlay is a plain in-tree View (see
  // TourOverlay's own comment for why), that has to be wired up by hand —
  // without it, back would fall through to whatever's underneath instead
  // of closing the tour.
  useEffect(() => {
    if (!showOverlay || Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleSkip();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showOverlay]);

  // `registerRect`/`registerTarget`/`unregisterTarget`/`startTour`/
  // `completeStepIfActive` are all useCallback([])-stable. This object's
  // own IDENTITY, unlike before, now DOES change on every step transition
  // — `activeStepId` below is deliberately reactive (screens like
  // WardrobeScreen need to know exactly when the tour reaches a given step
  // to drive their own UI, e.g. the `scanCta` pulse). That used to be
  // unsafe: TourTarget's own registration effect used to key off this
  // whole object (`[ctx, id]`), so churning its identity on every step
  // change re-ran every mounted TourTarget's cleanup+setup, which
  // `unregisterTarget`'s auto-advance-on-vanish logic misread as targets
  // genuinely disappearing — "the tour never appears" / "Closet is
  // frozen". TourTarget's effect now keys off the individual stable
  // functions instead (`ctx?.registerTarget`, `ctx?.unregisterTarget` —
  // see its own comment), which don't change identity even though this
  // wrapping object does, so that failure mode no longer applies here.
  //
  // `isTourActive` — plain `active`, exposed so a screen's own ScrollView
  // can lock out manual scrolling for the duration of a tour
  // (`scrollEnabled={!tour?.isTourActive}`, see WardrobeScreen) so the
  // client's own scroll gesture and the tour's own auto-center-on-target
  // scrollTo (in the effect above) can never fight over the same
  // ScrollView's position at once — that tug-of-war is what a client
  // trying to scroll manually during the auto-scroll loop bug looked like.
  //
  // WARNING for future changes: this whole object's identity is allowed to
  // churn reactively (both `activeStepId` and `isTourActive` change during
  // a normal tour), which is exactly what caused the infinite loop this
  // comment block used to only warn about in the abstract — see the
  // auto-scroll effect's own comment above for the full postmortem. ANY
  // effect anywhere in the app that consumes `useAppTour()` and needs a
  // STABLE dependency (i.e. "run this once, not on every step") MUST
  // depend on the specific stable function it needs (`tour?.startTour`,
  // `tour?.completeStepIfActive`, etc.), never on the whole `tour` object
  // or on `useAppTour()`'s return value directly. Reading `activeStepId`/
  // `isTourActive` in a RENDER body (not an effect dependency array) is
  // always safe — it's only effect dependency arrays where this bites.
  const activeStepId = active && stepReady ? currentStep?.id ?? null : null;
  const contextValue = useMemo(
    () => ({
      registerRect,
      registerTarget,
      unregisterTarget,
      startTour,
      completeStepIfActive,
      activeStepId,
      isTourActive: active,
    }),
    [registerRect, registerTarget, unregisterTarget, startTour, completeStepIfActive, activeStepId, active]
  );

  return (
    <TourContext.Provider value={contextValue}>
      {children}
      {/* `showOverlay && <TourOverlay/>` — not a hidden/transparent
          overlay left in place, a component that is or isn't in the tree
          at all. TourOverlay's own `if (!active) return null` below is a
          second, redundant guarantee of the same thing: however this gets
          refactored later, an inactive tour can never leave so much as an
          empty touch-blocking View mounted over the screen. */}
      {showOverlay && (
        <TourOverlay
          key={currentStep.id}
          active={showOverlay}
          rect={currentRect}
          text={currentStep.text}
          isLastStep={isLastStep}
          hideActions={Boolean(currentStep.hideActions)}
          hideSpotlightRing={Boolean(currentStep.hideSpotlightRing)}
          hideSpotlightCutout={Boolean(currentStep.hideSpotlightCutout)}
          floatingAction={currentStep.floatingAction || null}
          skipLabel={currentStep.skipLabel}
          nextLabel={isLastStep ? currentStep.finishLabel : currentStep.nextLabel}
          onNext={handleNext}
          onSkip={handleSkip}
        />
      )}
    </TourContext.Provider>
  );
}

// Replaces the old <Modal>-wrapped overlay. A Modal is a SEPARATE native
// window (Dialog on Android, its own UIViewController on iOS) — everything
// inside it, INCLUDING the fully-transparent gap where the spotlighted
// element shows through, sits in front of and swallows touches meant for
// the real screen underneath. That's the root cause of the "Finish button
// (and everything else) is dead" freeze: the Modal was capturing every tap
// on screen, and depending on step/measurement timing could end up
// rendering its own Skip/Finish buttons in a position that made them look
// present but never actually receive the touch, with no way to back out.
//
// This is a plain absolutely-positioned View instead, stacked on top of
// the real screen via zIndex/elevation but living in the SAME native
// window/surface — so `pointerEvents="box-none"` here (and again on
// TourSpotlight's own wrapper) means a tap anywhere that isn't explicitly
// covered by a mask rect or the tooltip card falls straight through to
// whatever's actually underneath, including the spotlighted target itself.
// Skip/Finish, rendered after the spotlight in source order, always sit on
// top and always receive their taps regardless.
function TourOverlay({
  active,
  rect,
  text,
  isLastStep,
  hideActions,
  hideSpotlightRing,
  hideSpotlightCutout,
  floatingAction,
  skipLabel,
  nextLabel,
  onNext,
  onSkip,
}) {
  // Belt-and-suspenders: the caller already only mounts this component
  // via `showOverlay && <TourOverlay .../>`, which fully removes it (and
  // therefore the touch-blocking mask rects inside TourSpotlight) from the
  // tree — not just visually hides it — whenever the tour isn't actively
  // showing this exact step. This second check means that guarantee holds
  // even if a future change ever renders TourOverlay unconditionally.
  if (!active || !rect) return null;

  return (
    <View style={styles.overlayRoot} pointerEvents="box-none">
      <TourSpotlight rect={rect} hideRing={hideSpotlightRing} hideCutout={hideSpotlightCutout} />
      {/* Only rendered for a `hideSpotlightCutout` step — see
          TourFloatingAction's own comment for why a step needs this instead
          of just relying on TourSpotlight's cutout to reveal the real
          target. */}
      {floatingAction && <TourFloatingAction rect={rect} {...floatingAction} />}
      <TourTooltip
        rect={rect}
        text={text}
        isLastStep={isLastStep}
        hideActions={hideActions}
        skipLabel={skipLabel}
        nextLabel={nextLabel}
        onNext={onNext}
        onSkip={onSkip}
      />
    </View>
  );
}

// True rounded-rect cutout via react-native-svg's luminance <Mask> (white =
// visible, black = punched out) instead of the old "4 opaque rectangles
// framing a never-covered square gap" trick — that approach could only ever
// produce a square hole (the gap itself was just an absence of mask, with
// hard right-angle corners) no matter what borderRadius the decorative ring
// drawn on top of it used, so a rounded card under the spotlight still read
// as sitting inside a square window. The SVG mask now actually curves the
// dark backdrop around the target's own corner radius.
//
// Touch-blocking stays a separate, plain-View concern (the four
// `tapBlocker`s) rather than trying to hit-test against the SVG's rounded
// shape: they approximate the same padded rect with square corners, so
// taps a few px into the rounded corner area either still get blocked or
// still pass through depending on which side of that corner they land —
// functionally invisible in practice, and far simpler than clip-pathing
// touch regions.
//
// `hideRing` — for a step whose real target already draws its own
// attention (e.g. WardrobeScreen's `scanCta`, which pulses on its own —
// see that screen's own comment): NO decorative stroke ring, NO
// `TourPulseRing`, and NO padding around the cutout — the transparent gap
// traces the target's own bounds EXACTLY (`padding = 0` below, vs. the
// normal `SPOTLIGHT_PADDING` breathing room every other step gets), so the
// dark backdrop butts directly against the target's own edge with nothing
// drawn or left visible in between.
//
// That last part matters more than it sounds: an earlier version of this
// only dropped the stroke ring/pulse ring but kept the padded cutout — the
// padding exists purely to give the (now-removed) ring room to sit OUTSIDE
// the target's edge, so with no ring left to serve, that padding did
// nothing but leave a visible margin of plain light background between the
// target and the dark backdrop, which read as its own unwanted "white
// outline" even with the actual ring gone. Zero padding is what actually
// gets rid of it.
//
// `hideCutout` — a step further than `hideRing`: NO transparent gap at all,
// not even the bare, ring-free, zero-padding one `hideRing` alone still
// leaves. The dark backdrop is a single flat, uninterrupted rect covering
// the entire screen. This is for a step whose real target can't be
// measured perfectly stably while it's also animating its own "look here"
// pulse — WardrobeScreen's `scanCta` button used to scale up to 1.05x on a
// loop while ALSO being the exact rect this component cuts a hole around;
// since AppTour only measures a step's target once, right before showing
// it (see AppTourProvider's own prepareStep comment), and never re-measures
// it on every animation frame, the button's own pulse could grow it larger
// than the static cutout on every cycle — its scaled-up edge then got
// clipped hard by the surrounding dark rect, reading as a crooked/uneven
// outline flickering in and out of the hole in time with the pulse. A
// single flat backdrop with no hole at all can't develop that mismatch,
// because nothing is being cut around a moving target anymore — see
// TourFloatingAction below for what actually gets rendered as this step's
// visible, tappable "look here" element instead.
function TourSpotlight({ rect, hideRing, hideCutout }) {
  const { width: screenW, height: screenH } = Dimensions.get('window');

  const backdropOpacity = useSharedValue(0);
  useEffect(() => {
    backdropOpacity.value = withTiming(1, { duration: BACKDROP_FADE_MS });
  }, [backdropOpacity]);
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));

  // No mask, no ring, no per-edge tap blockers — since nothing on screen
  // stays reachable through this backdrop, one plain opaque View (which
  // blocks touches everywhere by default, `pointerEvents` unset) does the
  // whole job.
  if (hideCutout) {
    return (
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: TOUR_BACKDROP }, backdropStyle]} />
    );
  }

  const padding = hideRing ? 0 : SPOTLIGHT_PADDING;
  const top = Math.max(rect.y - padding, 0);
  const left = Math.max(rect.x - padding, 0);
  const boxW = Math.min(rect.width + padding * 2, screenW - left);
  const boxH = Math.min(rect.height + padding * 2, screenH - top);
  const cutoutRadius = rect.borderRadius ?? radius.card;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]} pointerEvents="none">
        <Svg width={screenW} height={screenH}>
          <Defs>
            <Mask id="tourSpotlightMask">
              <Rect x={0} y={0} width={screenW} height={screenH} fill="#fff" />
              <Rect x={left} y={top} width={boxW} height={boxH} rx={cutoutRadius} ry={cutoutRadius} fill="#000" />
            </Mask>
          </Defs>
          <Rect x={0} y={0} width={screenW} height={screenH} fill={TOUR_BACKDROP} mask="url(#tourSpotlightMask)" />
          {!hideRing && (
            <>
              {/* Soft outer glow (wide, faint stroke) behind the crisp inner
                  ring — cheap way to make the cutout read as "lit up" rather
                  than just outlined, without a blur filter. */}
              <Rect
                x={left}
                y={top}
                width={boxW}
                height={boxH}
                rx={cutoutRadius}
                ry={cutoutRadius}
                fill="none"
                stroke={colors.violet}
                strokeOpacity={0.18}
                strokeWidth={10}
              />
              <Rect
                x={left}
                y={top}
                width={boxW}
                height={boxH}
                rx={cutoutRadius}
                ry={cutoutRadius}
                fill="none"
                stroke={colors.violet}
                strokeWidth={2}
              />
            </>
          )}
        </Svg>
      </Animated.View>

      {!hideRing && <TourPulseRing top={top} left={left} boxW={boxW} boxH={boxH} cutoutRadius={cutoutRadius} />}

      {/* Invisible blockers so a tap on the dimmed backdrop can't reach
          whatever's underneath — the hole itself has no view registered
          here at all, so taps there fall through the box-none container
          above straight to the real, spotlighted element. */}
      <View style={[styles.tapBlocker, { top: 0, left: 0, right: 0, height: top }]} />
      <View style={[styles.tapBlocker, { top: top + boxH, left: 0, right: 0, bottom: 0 }]} />
      <View style={[styles.tapBlocker, { top, left: 0, width: left, height: boxH }]} />
      <View style={[styles.tapBlocker, { top, left: left + boxW, right: 0, height: boxH }]} />
    </View>
  );
}

// The pulsing "radar ping" around the cutout — a plain RN View (not
// another SVG shape) since it only needs a simple rounded border, and
// Reanimated can drive a native View's transform/opacity on the UI thread
// directly, no AnimatedProps/createAnimatedComponent bridging into SVG
// needed for something this simple. Scales up from the target's own rect
// while fading out, then snaps back — `withRepeat(..., -1, false)` (not
// `true`, which would ping-pong back down) is what gives the "reset and
// pulse again" cadence instead of a breathing in/out loop.
function TourPulseRing({ top, left, boxW, boxH, cutoutRadius }) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: PULSE_DURATION_MS, easing: Easing.out(Easing.ease) }), -1, false);
  }, [pulse]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: (1 - pulse.value) * 0.5,
    transform: [{ scale: 1 + pulse.value * (PULSE_MAX_SCALE - 1) }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.pulseRing, { top, left, width: boxW, height: boxH, borderRadius: cutoutRadius }, pulseStyle]}
    />
  );
}

// The visible, tappable "look here" element for a `hideSpotlightCutout`
// step (see TourSpotlight's own `hideCutout` comment for why that step
// can't just cut a hole around its real target instead). A same-styled
// re-render of that target — same icon, label, and pill shape — positioned
// at exactly the rect AppTour already measured for it, drawn ON TOP of the
// now fully opaque backdrop rather than revealed through a gap in it.
// Pulses on its own UI-thread transform, same scale/duration the old
// in-place button pulse used, so switching from "real button behind a
// hole" to "duplicate button on an opaque backdrop" didn't also change how
// the pulse itself reads.
//
// `onPress` is whatever the caller's real button already does (e.g.
// WardrobeScreen's `handleScan`, which both opens the scanner AND calls
// `completeStepIfActive('scanCta')`) — this component has no tour-advancing
// logic of its own, it's purely a positioned, pulsing stand-in for the
// real thing.
function TourFloatingAction({ rect, icon, label, onPress }) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: FLOATING_ACTION_PULSE_MS, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: FLOATING_ACTION_PULSE_MS, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      false
    );
  }, [pulse]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * (FLOATING_ACTION_PULSE_SCALE - 1) }],
  }));

  return (
    <Animated.View
      style={[
        styles.floatingActionWrap,
        { top: rect.y, left: rect.x, width: rect.width, height: rect.height },
        pulseStyle,
      ]}
    >
      <TouchableOpacity style={styles.floatingActionBtn} onPress={onPress} activeOpacity={0.85}>
        <Feather name={icon} size={18} color={colors.inverseText} />
        <Text style={styles.floatingActionText}>{label}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// Tooltip card — placed strictly by which half of the screen the target's
// CENTER falls in: top half -> tooltip goes below it, bottom half ->
// tooltip goes above it. That's a deliberate choice over the old "whichever
// side has more room" heuristic, which could flip unpredictably for a
// target near the exact middle of the screen and sometimes placed the
// tooltip on the same side as extra content, covering part of the
// spotlighted area itself. The half-screen rule instead guarantees the
// tooltip lands in the opposite half from the target, so the spotlight
// cutout (auto-centered on screen by the scroll-to-center effect above)
// always stays fully clear of the tooltip card.
//
// Always horizontally centered within the screen (not relative to the
// target, which may sit off-center) so it never runs off either edge.
// Clamped between the safe-area insets top/bottom. Fades + springs in from
// a small offset on mount (TourOverlay above remounts this — via the
// `key={currentStep.id}` on it in AppTourProvider — on every step change,
// so this entrance replays each time, not just for the very first step).
//
// `hideActions` — true for a step whose real, on-screen target IS its own
// call to action (e.g. WardrobeScreen's `scanCta`, which pulses to draw the
// eye — see that screen's own comment): the tooltip then shows ONLY the
// hint text, no Skip/Next row, since tapping the tooltip's Skip would be
// redundant with just tapping the real button, and a "Next"/"Finish"
// button here would compete with — and read as a substitute for — the
// actual action the step is trying to get the client to take. Advancing
// past a `hideActions` step happens entirely through
// `completeStepIfActive` (see AppTourProvider's own comment), called by
// whatever `onPress` the real target already has.
function TourTooltip({ rect, text, isLastStep, hideActions, skipLabel, nextLabel, onNext, onSkip }) {
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = Dimensions.get('window');

  const elementCenterY = rect.y + rect.height / 2;
  const placeBelow = elementCenterY < screenH / 2;

  const verticalStyle = placeBelow
    ? { top: Math.min(rect.y + rect.height + spacing.md, screenH - insets.bottom - spacing.md) }
    : { bottom: Math.max(screenH - rect.y + spacing.md, insets.bottom + spacing.md) };

  // Points the tooltip at the actual target rather than leaving the two
  // visually disconnected — an arrow, not just proximity, is what reads as
  // "this text is ABOUT that thing" when the tooltip itself always sits
  // centered on the SCREEN (see this function's own top comment) rather
  // than aligned to the target's own x position. Up when the tooltip is
  // BELOW the target (pointing back up at it), down when the tooltip is
  // ABOVE it. Horizontal position aims at the target's true center, then
  // clamps to stay inside the card's own rounded corners — a target near
  // either screen edge would otherwise push the arrow tip outside the
  // tooltip entirely.
  const tooltipWidth = Math.min(TOOLTIP_MAX_WIDTH, screenW * 0.9);
  const tooltipLeft = Math.max((screenW - TOOLTIP_MAX_WIDTH) / 2, spacing.md);
  const targetCenterX = rect.x + rect.width / 2;
  const arrowMargin = 20;
  const arrowLeft = Math.min(
    Math.max(targetCenterX - tooltipLeft - ARROW_HALF_WIDTH, arrowMargin),
    tooltipWidth - arrowMargin - ARROW_HALF_WIDTH * 2
  );

  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = withSpring(1, TOOLTIP_ENTER_SPRING);
  }, [enter]);
  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * (placeBelow ? -12 : 12) }],
  }));

  // Typewriter reveal — see useTypewriter's own comment for why this is a
  // plain JS interval rather than a Reanimated value.
  const displayedText = useTypewriter(text);

  return (
    <Animated.View
      style={[
        styles.tooltip,
        verticalStyle,
        { left: tooltipLeft, width: tooltipWidth },
        enterStyle,
      ]}
    >
      <View
        style={[
          styles.tooltipArrow,
          placeBelow ? styles.tooltipArrowUp : styles.tooltipArrowDown,
          { left: arrowLeft },
        ]}
      />

      <Text style={styles.tooltipText}>{displayedText}</Text>

      {!hideActions && (
        <View style={styles.actions}>
          <TouchableOpacity onPress={onSkip} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.skipText}>{skipLabel}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.nextBtn} onPress={onNext} activeOpacity={0.85}>
            <Text style={styles.nextBtnText}>{nextLabel}</Text>
          </TouchableOpacity>
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    elevation: 100,
  },
  tapBlocker: { position: 'absolute', backgroundColor: 'transparent' },
  pulseRing: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: colors.violet,
  },
  floatingActionWrap: { position: 'absolute' },
  floatingActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    width: '100%',
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    ...shadows.accent,
  },
  floatingActionText: { color: colors.inverseText, fontWeight: '800', fontSize: 14.5 },
  tooltip: {
    position: 'absolute',
    backgroundColor: colors.surface,
    borderRadius: radius.cardLg,
    padding: spacing.sm,
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 101,
  },
  // Classic CSS-triangle trick — a zero-size box with only two adjacent
  // borders colored, the rest transparent. `tooltipArrowUp` (pointing up,
  // used when the tooltip sits BELOW its target) colors the bottom border;
  // `tooltipArrowDown` (pointing down, tooltip ABOVE its target) colors the
  // top border instead. Positioned just outside the card's own edge
  // (negative top/bottom) so it reads as attached to, not overlapping, the
  // tooltip.
  tooltipArrow: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderLeftWidth: ARROW_HALF_WIDTH,
    borderRightWidth: ARROW_HALF_WIDTH,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  tooltipArrowUp: {
    top: -ARROW_HALF_WIDTH,
    borderBottomWidth: ARROW_HALF_WIDTH,
    borderBottomColor: colors.surface,
  },
  tooltipArrowDown: {
    bottom: -ARROW_HALF_WIDTH,
    borderTopWidth: ARROW_HALF_WIDTH,
    borderTopColor: colors.surface,
  },
  tooltipText: { ...typography.body, fontSize: 14.5, lineHeight: 21 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  skipText: { ...typography.bodySecondary, fontSize: 13.5, fontWeight: '700' },
  nextBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  nextBtnText: { color: colors.inverseText, fontSize: 13.5, fontWeight: '700' },
});

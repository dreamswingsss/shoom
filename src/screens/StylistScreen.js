import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Modal,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { sendChatMessage } from '../services/aiChatEngine';
import { useUserStore } from '../store/useUserStore';
import { useWardrobeStore } from '../store/useWardrobeStore';
import { useChatStore } from '../store/useChatStore';
import { usePlannerStore, toDateKey, getPlannedDaysCount } from '../store/usePlannerStore';
import { useFadeOnFocus } from '../hooks/useFadeOnFocus';
import { useGoogleSignIn } from '../hooks/useGoogleSignIn';
import { useToast } from '../hooks/useToast';
import { usePaywall } from '../hooks/usePaywall';
import { formatWeekdayLong, formatWeekdayShortWithDate } from '../utils/dateFormat';
import { colors, cardTints, spacing, radius, typography, shadows, buttons, opacity } from '../theme/tokens';
import ScreenContainer from '../components/ScreenContainer';
import BottomSheet from '../components/BottomSheet';
import { TourTarget } from '../components/AppTour';
import { FadeInView } from '../components/AnimatedPressable';
import FullScreenImageViewer from '../components/FullScreenImageViewer';
import Toast from '../components/Toast';
import PaywallModal from '../components/PaywallModal';
import { triggerHaptic } from '../utils/haptics';
import { FREE_CHAT_MESSAGE_LIMIT, FREE_PLANNED_DAYS_LIMIT } from '../constants/monetization';

// Injected as a hidden ("sender: 'user'", not rendered) turn once the
// client confirms — buildContents() in aiChatEngine replays chat history
// as alternating user/model turns on every request, so from this point
// forward every future request's context includes this instruction, same
// as if the client had actually typed it. Deliberately NOT translated: this
// is an instruction for Gemini, not copy a human ever reads, and the rest
// of the system prompt/rules it rides alongside are English regardless of
// app language.
const PROFILE_CONFIRMED_SYSTEM_NOTE =
  'The user has confirmed new profile parameters. From now on, use this new profile data for all outfit recommendations.';


// Quick Prompts — a horizontal row of one-tap starters, shown only at the
// very start of a conversation (see DynamicQuickReplies below). Each
// `prompt` is the literal text sent to the stylist (translated, since
// unlike aiChatEngine's system-prompt copy this IS something a human reads —
// as their own outgoing chat bubble).
const QUICK_PROMPTS = [
  { id: 'officeLook', promptKey: 'stylist.quickPrompts.officeLook' },
  { id: 'dateNight', promptKey: 'stylist.quickPrompts.dateNight' },
  { id: 'casualWeekend', promptKey: 'stylist.quickPrompts.casualWeekend' },
  { id: 'rainyDay', promptKey: 'stylist.quickPrompts.rainyDay' },
  { id: 'surpriseMe', promptKey: 'stylist.quickPrompts.surpriseMe' },
];

// Context Prompts — shown instead of QUICK_PROMPTS when the stylist's last
// reply was a clarifying question (RULE #0 in aiChatEngine.js's system
// prompt: a turn with no occasion/mood/style signal to go on gets a
// question back, not an outfit) rather than an opening greeting. A subset
// of QUICK_PROMPTS' own occasion-style entries — each one directly answers
// "what's the occasion/vibe?" in one tap.
const CONTEXT_PROMPTS = [
  { id: 'officeLook', promptKey: 'stylist.quickPrompts.officeLook' },
  { id: 'dateNight', promptKey: 'stylist.quickPrompts.dateNight' },
  { id: 'casualWeekend', promptKey: 'stylist.quickPrompts.casualWeekend' },
  { id: 'rainyDay', promptKey: 'stylist.quickPrompts.rainyDay' },
];

// Quick Actions — shown (via DynamicQuickReplies below) once the stylist's
// last reply actually delivered an outfit, letting the client iterate on
// the last suggestion in one tap instead of typing a follow-up. The emoji
// lives in the translated label itself (not a separate icon glyph) — it's
// the whole visual marker for these chips.
const QUICK_ACTIONS = [
  { id: 'swapTop', labelKey: 'stylist.quickActions.swapTop', promptKey: 'stylist.quickActions.swapTopPrompt' },
  { id: 'warmer', labelKey: 'stylist.quickActions.warmer', promptKey: 'stylist.quickActions.warmerPrompt' },
  { id: 'cooler', labelKey: 'stylist.quickActions.cooler', promptKey: 'stylist.quickActions.coolerPrompt' },
  {
    id: 'moreFormal',
    labelKey: 'stylist.quickActions.moreFormal',
    promptKey: 'stylist.quickActions.moreFormalPrompt',
  },
];

// Feedback Actions — a second, emotional-reaction row alongside Quick
// Actions above (same "an outfit was actually delivered" gate). Where Quick
// Actions iterate on the outfit itself (swap/warmer/cooler/formal), these
// react to it, still via the same canned-prompt-through-handleSend
// mechanism.
const FEEDBACK_ACTIONS = [
  { id: 'loveIt', labelKey: 'stylist.feedbackActions.loveIt', promptKey: 'stylist.feedbackActions.loveItPrompt' },
  {
    id: 'notMyStyle',
    labelKey: 'stylist.feedbackActions.notMyStyle',
    promptKey: 'stylist.feedbackActions.notMyStylePrompt',
  },
  {
    id: 'tooBright',
    labelKey: 'stylist.feedbackActions.tooBright',
    promptKey: 'stylist.feedbackActions.tooBrightPrompt',
  },
];

// Typing Indicator — 3-dot bounce, one Animated.Value per dot, staggered.
const TYPING_DOT_BOUNCE_MS = 220;
const TYPING_DOT_STAGGER_MS = 150;
// Full loop length each dot's sequence pads out to, so all three dots
// restart in sync every cycle instead of drifting apart over time.
const TYPING_CYCLE_MS = 900;

// Cycles alongside the dots so a slow reply (real work — weather, wardrobe,
// color-type reasoning all happen before Gemini even returns) reads as
// visible progress instead of the same static "..." sitting there the whole
// time. Purely cosmetic — the actual request is one single Gemini call, not
// a multi-stage pipeline — but it's an honest description of what a
// stylist's reasoning process actually covers, not a fabricated one.
const STATUS_KEYS = ['analyzingWeather', 'checkingColorDna', 'matchingOutfits'];
const STATUS_CYCLE_MS = 1400;
const STATUS_FADE_MS = 180;

export default function StylistScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const route = useRoute();
  const wardrobe = useWardrobeStore((state) => state.items);
  const isProfileStale = useUserStore((state) => state.isProfileStale);
  const confirmProfileUpdate = useUserStore((state) => state.confirmProfileUpdate);
  const dismissProfileStale = useUserStore((state) => state.dismissProfileStale);
  const isPro = useUserStore((state) => state.isPro);
  const messages = useChatStore((state) => state.messages);
  const addMessage = useChatStore((state) => state.addMessage);
  const updateMessage = useChatStore((state) => state.updateMessage);
  const pendingPrompt = useChatStore((state) => state.pendingPrompt);
  const clearPendingPrompt = useChatStore((state) => state.clearPendingPrompt);
  const upsertProfileStalePrompt = useChatStore((state) => state.upsertProfileStalePrompt);
  const freeMessagesUsed = useChatStore((state) => state.freeMessagesUsed);
  const fadeOpacity = useFadeOnFocus();

  // Freemium chat cap — once hit, the input bar itself is replaced by an
  // upgrade prompt (see the render below), not just disabled in place, per
  // the monetization spec. `isPro` always wins regardless of count.
  const chatLimitReached = !isPro && freeMessagesUsed >= FREE_CHAT_MESSAGE_LIMIT;

  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  // Full-screen viewer for any tapped chat image (a wardrobe photo) — one
  // piece of state at screen level rather than per-message, since only one
  // image can be open at a time regardless of which bubble it came from.
  const [viewerUri, setViewerUri] = useState(null);
  const { toastMessage, toastKey, toastHoldMs, showToast } = useToast();
  const { paywallMessage, showPaywall, closePaywall } = usePaywall();

  const listRef = useRef(null);
  // Synchronous companion to the `sending` state guard in handleSend below.
  // `sending` alone isn't enough: setSending(true) is a React state update,
  // which is asynchronous/batched, so two near-simultaneous calls to
  // handleSend (e.g. the keyboard's "send" action and a tap on the send
  // button both firing for what the client experienced as one action) can
  // both read `sending === false` before either commits — producing the
  // exact same user message twice in the transcript. A ref updates
  // immediately, so the second call sees it flip before it can slip through.
  const sendingRef = useRef(false);

  const wardrobeById = useMemo(
    () => Object.fromEntries(wardrobe.map((item) => [item.id, item])),
    [wardrobe]
  );

  // Hidden turns (the profile-confirmed system note) still ride along in
  // `messages` so they're replayed to Gemini as history, but never render
  // as their own chat bubble.
  const visibleMessages = useMemo(() => messages.filter((m) => !m.hidden), [messages]);

  // WeeklyPlanner's empty-day "+" navigates here with a pre-filled question
  // via route params instead of auto-sending it — the client still has to
  // hit send. Cleared via setParams right after so it doesn't re-fire if
  // the client leaves and comes back to this tab without a fresh tap.
  useEffect(() => {
    if (!route.params?.initialPrompt) return;
    setInputText(route.params.initialPrompt);
    navigation.setParams({ initialPrompt: undefined });
  }, [route.params?.initialPrompt]);

  // Planner's "Ask AI Stylist" step hands the prompt off via the chat store
  // instead of route params, and — unlike the pre-fill above — sends it
  // immediately: the client already confirmed day + occasion on the Planner
  // screen, so requiring a second "hit send" here would just be friction.
  useEffect(() => {
    if (!pendingPrompt) return;
    clearPendingPrompt();
    handleSend(pendingPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt]);

  // ItemDetailScreen's "Style this item" hands off the exact wardrobe item
  // via a route param instead of the chat store — the specific item being
  // styled belongs to this navigation, not global chat state. Sends
  // immediately (same reasoning as pendingPrompt above): tapping the button
  // was already the client's explicit choice.
  useEffect(() => {
    const targetItem = route.params?.targetItem;
    if (!targetItem) return;
    navigation.setParams({ targetItem: undefined });
    const itemLabel = `${t(`closet.colors.${targetItem.color}`)} ${targetItem.subcategory}`;
    // baseItemId rides along to the resulting AI message so a later "Save
    // Inspiration" tap on it knows which wardrobe item this look started
    // from (see handleSend's own comment on why it takes this as a param
    // instead of some ambient "currently styling" state).
    handleSend(t('stylist.targetItemPrompt', { item: itemLabel }), { baseItemId: targetItem.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.targetItem]);

  // Fires on every stale→true transition (and once on mount if the profile
  // was already left stale from a previous session/tab). `upsertProfileStalePrompt`
  // itself strips any earlier unresolved prompt before appending the new
  // one, so this is safe to call more than once for the same transition —
  // e.g. under React 18 Strict Mode's dev-only double effect invocation,
  // which previously produced two stacked "confirm profile update?" bubbles
  // because the old guard read a stale `messages` closure both times.
  useEffect(() => {
    if (!isProfileStale) return;
    upsertProfileStalePrompt(t('stylist.profileStale.prompt'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProfileStale]);

  function handleProfileUpdateConfirm(promptMessage) {
    triggerHaptic();
    confirmProfileUpdate();
    updateMessage(promptMessage.id, { resolution: 'confirmed' });
    // Hidden turn — reaches Gemini via history replay on the next request,
    // never rendered as its own bubble (filtered out below).
    addMessage({
      id: `${Date.now()}-profile-confirm-note`,
      sender: 'user',
      text: PROFILE_CONFIRMED_SYSTEM_NOTE,
      hidden: true,
    });
  }

  function handleProfileUpdateDismiss(promptMessage) {
    triggerHaptic();
    dismissProfileStale();
    updateMessage(promptMessage.id, { resolution: 'dismissed' });
  }

  // `baseItemId` — only ever passed by the targetItem effect above — rides
  // along onto the resulting AI message untouched, purely as data for that
  // message's own "Save Inspiration" button later; nothing here reads it.
  async function handleSend(overrideText, { baseItemId = null } = {}) {
    const text = (overrideText ?? inputText).trim();
    if (!text || sendingRef.current) return;
    // Defense in depth — the render below already replaces the entire
    // input bar (including every quick-prompt chip) with an upgrade prompt
    // once `chatLimitReached`, so there's no live UI path left that calls
    // this, but a stale pendingPrompt hand-off (see the effect above) could
    // still fire on a screen that mounted before the limit was hit.
    if (chatLimitReached) return;
    sendingRef.current = true;

    triggerHaptic();
    const userMessage = { id: `${Date.now()}-user`, sender: 'user', text };
    const historyForRequest = messages;

    addMessage(userMessage);
    setInputText('');
    setError(null);
    setSending(true);

    try {
      if (wardrobe.length === 0) {
        // Wardrobe-Only Guard — the stylist only ever reasons about pieces
        // that exist in the client's own closet (see aiChatEngine.js's
        // RULE #5), so an empty closet has nothing for it to work with,
        // full stop. Short-circuits before any network call, regardless of
        // profile completeness or what the client typed — there used to be
        // a "Zero-Closet Inspiration Mode" here that shopped for pieces to
        // buy instead, but that's exactly the made-up-item behavior RULE #5
        // now forbids, so this case has nothing left to do but ask for a
        // real closet. `finally` below still resets `sending`/`sendingRef`
        // on this path since `return` inside `try` runs it regardless.
        addMessage({ id: `${Date.now()}-ai`, sender: 'ai', type: 'closetEmpty', text: t('stylist.closetEmpty.message') });
        return;
      }

      const { text: aiText, outfitIds } = await sendChatMessage({
        message: text,
        wardrobe,
        history: historyForRequest,
      });
      addMessage({ id: `${Date.now()}-ai`, sender: 'ai', text: aiText, outfitIds, baseItemId });
    } catch (err) {
      setError(err.message || t('stylist.genericError'));
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  }

  // "Add Items" CTA under the closetEmpty message — Closet is a sibling tab
  // inside the same "Main" tab navigator this screen already lives in
  // (unlike ItemDetailScreen, which sits on the root Stack and has to nest
  // through `{ screen, params }` to reach a tab — see that screen's own
  // comment), so this navigates directly by tab name.
  function handleAddItems() {
    triggerHaptic();
    navigation.navigate('Closet');
  }

  async function handleCameraPress() {
    triggerHaptic();
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      showToast(t('stylist.cameraPermission.message'));
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.5,
    });

    if (result.canceled || !result.assets?.[0]) return;

    addMessage({
      id: `${Date.now()}-user-image`,
      sender: 'user',
      type: 'image',
      uri: result.assets[0].uri,
    });
  }

  return (
    // scroll=false — this screen's FlatList + KeyboardAvoidingView input bar
    // can't nest inside ScreenContainer's own ScrollView. contentStyle zeroes
    // the shell's 16px margin out because every child here already pads
    // itself independently (header/messagesContent/inputBar/etc. below, all
    // now on spacing.screenH) rather than relying on one shared inset.
    <ScreenContainer edges={['top']} scroll={false} style={styles.container} contentStyle={styles.zeroHPadding}>
      <Animated.View style={[styles.flexFill, { opacity: fadeOpacity }]}>
      {/* App Tour's `stylistHeader` step — WardrobeScreen's tour navigates
          here (navigation.navigate('AI Stylist')) before spotlighting this,
          so it always exists by the time that step measures it: this
          screen mounts (if it hadn't already) as part of that same
          navigation, and its own registerTarget effect runs immediately
          after.
          `headerOuter` (not the TourTarget) carries the margin/padding —
          `styles.header`'s own marginTop/marginBottom used to sit on the
          Text INSIDE the TourTarget, and Yoga counts a child's margin
          toward an auto-sized parent's measured box, so the spotlight was
          bleeding ~40px past the visible text into the banner/list below
          it. Margin now lives on this outer, non-target wrapper instead —
          TourTarget's own box is exactly the header text's line box. */}
      <View style={styles.headerOuter}>
        <TourTarget id="stylistHeader">
          <Text style={styles.header}>{t('stylist.header')}</Text>
        </TourTarget>
      </View>

      {wardrobe.length === 0 && (
        <View style={styles.zeroClosetBanner}>
          <Feather name="info" size={13} color={colors.textSecondary} />
          <Text style={styles.zeroClosetBannerText}>{t('stylist.zeroCloset.banner')}</Text>
        </View>
      )}

      <FlatList
        ref={listRef}
        data={visibleMessages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messagesContent}
        renderItem={({ item }) => (
          <FadeInView duration={250}>
            <MessageBubble
              item={item}
              wardrobeById={wardrobeById}
              onConfirmProfileUpdate={handleProfileUpdateConfirm}
              onDismissProfileUpdate={handleProfileUpdateDismiss}
              onImagePress={setViewerUri}
              onAddItems={handleAddItems}
              showToast={showToast}
            />
          </FadeInView>
        )}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListFooterComponent={
          sending ? (
            <TypingIndicator />
          ) : visibleMessages.length <= 1 ? (
            <EmptyStateCard onSurpriseMe={() => handleSend(t('stylist.quickPrompts.surpriseMe'))} />
          ) : null
        }
      />

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {chatLimitReached ? (
        // Freemium chat cap — the input bar (quick prompts, camera button,
        // text field, send button) is fully replaced by this, not just
        // disabled in place, per the monetization spec: "the input should
        // be blocked, and a button/message should appear instead of it."
        <View style={styles.chatLimitBar}>
          <Text style={styles.chatLimitText}>{t('paywall.chatLimitMessage')}</Text>
          <TouchableOpacity
            style={styles.chatLimitBtn}
            onPress={() => showPaywall(t('paywall.chatLimitMessage'))}
            activeOpacity={0.85}
          >
            <Feather name="zap" size={15} color={colors.inverseText} />
            <Text style={styles.chatLimitBtnText}>{t('paywall.upgrade')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.select({ ios: 'padding', android: 'height', default: undefined })}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
        >
          {!sending && (
            <DynamicQuickReplies
              lastMessage={visibleMessages[visibleMessages.length - 1]}
              isConversationStart={visibleMessages.length <= 1}
              onSelect={(prompt) => handleSend(prompt)}
            />
          )}

          <View style={styles.inputBar}>
            <View style={styles.cameraBtnContainer}>
              <TouchableOpacity
                style={styles.rateMyFitBtn}
                onPress={handleCameraPress}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                activeOpacity={0.8}
              >
                <Feather name="camera" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              value={inputText}
              onChangeText={setInputText}
              placeholder={
                wardrobe.length === 0 ? t('stylist.inputPlaceholderShopping') : t('stylist.inputPlaceholder')
              }
              placeholderTextColor={colors.textMuted}
              onSubmitEditing={() => handleSend()}
              returnKeyType="send"
              editable={!sending}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!inputText.trim() || sending) && styles.sendBtnDisabled]}
              onPress={() => handleSend()}
              disabled={!inputText.trim() || sending}
              activeOpacity={0.8}
            >
              <Feather name="arrow-up" size={20} color={colors.inverseText} />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
      </Animated.View>

      <FullScreenImageViewer visible={!!viewerUri} imageUri={viewerUri} onClose={() => setViewerUri(null)} />
      <Toast key={toastKey} message={toastMessage} holdMs={toastHoldMs} />
      <PaywallModal visible={!!paywallMessage} message={paywallMessage} onClose={closePaywall} />
    </ScreenContainer>
  );
}

function MessageBubble({
  item,
  wardrobeById,
  onConfirmProfileUpdate,
  onDismissProfileUpdate,
  onImagePress,
  onAddItems,
  showToast,
}) {
  const { t } = useTranslation();
  const isUser = item.sender === 'user';

  // Wardrobe-Only Guard's own card — see handleSend's own comment in the
  // parent screen. No SaveInspirationButton here — there's no outfit to
  // save, just a dead end with one way out: go add something to the closet.
  if (item.type === 'closetEmpty') {
    return (
      <View style={styles.messageRowAi}>
        <View style={styles.aiCard}>
          <Text style={styles.aiMessageText}>{item.text}</Text>
          <TouchableOpacity style={styles.completeProfileBtn} onPress={onAddItems} activeOpacity={0.85}>
            <Feather name="plus-circle" size={15} color={colors.inverseText} />
            <Text style={styles.completeProfileBtnText}>{t('stylist.closetEmpty.cta')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (item.type === 'profileStaleConfirm') {
    return (
      <View style={styles.messageRowAi}>
        <View style={styles.aiCard}>
          <Text style={styles.aiMessageText}>{item.text}</Text>

          {item.resolution ? (
            <Text style={styles.profileStaleResolvedText}>
              {item.resolution === 'confirmed'
                ? t('stylist.profileStale.confirmedNote')
                : t('stylist.profileStale.dismissedNote')}
            </Text>
          ) : (
            <View style={styles.profileStaleActions}>
              <TouchableOpacity
                style={styles.profileStaleYesBtn}
                onPress={() => onConfirmProfileUpdate(item)}
                activeOpacity={0.85}
              >
                <Text style={styles.profileStaleYesBtnText}>{t('stylist.profileStale.yes')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.profileStaleNoBtn}
                onPress={() => onDismissProfileUpdate(item)}
                activeOpacity={0.8}
              >
                <Text style={styles.profileStaleNoBtnText}>{t('stylist.profileStale.no')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    );
  }

  if (isUser) {
    return (
      <View style={styles.messageRowUser}>
        {item.type === 'image' ? (
          <Image source={{ uri: item.uri }} style={styles.userImage} />
        ) : (
          <View style={styles.userBubble}>
            <Text style={styles.userBubbleText}>{item.text}</Text>
          </View>
        )}
      </View>
    );
  }

  const outfitItems = (item.outfitIds || []).map((id) => wardrobeById[id]).filter(Boolean);

  return (
    <View style={styles.messageRowAi}>
      <View style={styles.aiCard}>
        <Text style={styles.aiMessageText}>{item.text}</Text>

        {outfitItems.length > 0 && (
          <View style={styles.outfitStrip}>
            {outfitItems.map((wardrobeItem) => (
              <View key={wardrobeItem.id} style={styles.outfitMiniCard}>
                <TouchableOpacity
                  onPress={() => onImagePress(wardrobeItem.imageUri)}
                  activeOpacity={0.85}
                  disabled={!wardrobeItem.imageUri}
                >
                  <Image source={{ uri: wardrobeItem.imageUri }} style={styles.outfitMiniImage} />
                </TouchableOpacity>
                <Text style={styles.outfitMiniLabel} numberOfLines={1}>
                  {wardrobeItem.subcategory}
                </Text>
                <Text style={styles.outfitMiniColor} numberOfLines={1}>
                  {wardrobeItem.color}
                </Text>
              </View>
            ))}
          </View>
        )}

        {outfitItems.length > 0 && (
          <>
            <SaveInspirationButton
              messageId={item.id}
              saved={Boolean(item.inspirationSaved)}
              baseItemId={item.baseItemId ?? null}
              aiText={item.text}
              generatedItems={outfitItems.map((wardrobeItem) => ({
                type: 'wardrobe',
                id: wardrobeItem.id,
                name: wardrobeItem.subcategory,
                imageUrl: wardrobeItem.imageUri,
              }))}
              showToast={showToast}
            />
            <SaveToPlannerButton outfitIds={item.outfitIds || []} />
          </>
        )}
      </View>
    </View>
  );
}

// Lookbook — bookmarks this exact look (AI text + every visual reference
// shown for it) via useWardrobeStore's saveInspiration, so it survives past
// this chat transcript into WardrobeScreen's own Inspirations section.
// Saved state lives on the message itself (`item.inspirationSaved`), the
// same way profileStaleConfirm's `resolution` does above — persists
// naturally through useChatStore's own AsyncStorage persistence, no
// separate "which messages are saved" bookkeeping needed here.
//
// Guest gate mirrors ScanSheet's Save-to-Closet flow exactly (same
// useGoogleSignIn hook, same BottomSheet shape): checking `isLoggedIn`
// BEFORE attempting the save — not attempt-then-catch-"not signed in" —
// is what lets a successful sign-in fall straight through into performSave()
// with the generated look still in hand, instead of the client losing this
// exact look the moment they navigate away to sign in from Profile.
function SaveInspirationButton({ messageId, saved, baseItemId, aiText, generatedItems, showToast }) {
  const { t } = useTranslation();
  const isLoggedIn = useUserStore((state) => state.isLoggedIn);
  const updateMessage = useChatStore((state) => state.updateMessage);
  const saveInspiration = useWardrobeStore((state) => state.saveInspiration);
  const {
    signIn: signInWithGoogle,
    signingIn,
    error: googleSignInError,
    setError: setGoogleSignInError,
  } = useGoogleSignIn();

  const [saving, setSaving] = useState(false);
  const [authPromptVisible, setAuthPromptVisible] = useState(false);

  async function performSave() {
    setSaving(true);
    try {
      const inspiration = await saveInspiration({ baseItemId, aiText, generatedItems });
      updateMessage(messageId, { inspirationSaved: true, inspirationId: inspiration.id });
    } catch (err) {
      console.error('[StylistScreen] Save inspiration failed:', err);
      showToast(err.message || t('stylist.saveInspiration.genericError'));
    } finally {
      setSaving(false);
    }
  }

  function handlePress() {
    if (saved || saving) return;
    triggerHaptic();

    if (!isLoggedIn) {
      setGoogleSignInError(null);
      setAuthPromptVisible(true);
      return;
    }

    performSave();
  }

  // Same handoff as ScanSheet's own handleGooglePress: sign-in succeeds ->
  // close the sheet -> immediately run the save that was already pending,
  // rather than making the client tap "Save Look" a second time.
  async function handleGooglePress() {
    const result = await signInWithGoogle();
    if (result.status !== 'success') return;
    setAuthPromptVisible(false);
    await performSave();
  }

  function handleAuthPromptCancel() {
    if (signingIn) return;
    setAuthPromptVisible(false);
    setGoogleSignInError(null);
  }

  return (
    <>
      <TouchableOpacity
        style={[styles.saveInspirationBtn, saved && styles.saveInspirationBtnSaved]}
        onPress={handlePress}
        disabled={saved || saving}
        activeOpacity={0.85}
      >
        {saving ? (
          <ActivityIndicator size="small" color={colors.inverseText} />
        ) : (
          <>
            <Feather
              name={saved ? 'check' : 'bookmark'}
              size={16}
              color={saved ? colors.success : colors.inverseText}
            />
            <Text style={[styles.saveInspirationBtnText, saved && styles.saveInspirationBtnTextSaved]}>
              {saved ? t('stylist.saveInspiration.saved') : t('stylist.saveInspiration.save')}
            </Text>
          </>
        )}
      </TouchableOpacity>

      <BottomSheet visible={authPromptVisible} onClose={handleAuthPromptCancel}>
        <View style={styles.authPromptWrap}>
          <LinearGradient colors={[colors.violet, colors.violetLight]} style={styles.authPromptIconWrap}>
            <Feather name="lock" size={26} color={colors.inverseText} />
          </LinearGradient>
          <Text style={styles.authPromptTitle}>{t('closet.scan.authPrompt.title')}</Text>
          <Text style={styles.authPromptMessage}>{t('stylist.saveInspiration.authPromptMessage')}</Text>

          {googleSignInError && (
            <Text style={styles.authPromptError}>
              {googleSignInError.message || t('closet.scan.authPrompt.genericError')}
            </Text>
          )}

          <TouchableOpacity
            style={[styles.googleBtn, signingIn && styles.actionBtnDisabled]}
            onPress={handleGooglePress}
            disabled={signingIn}
            activeOpacity={0.85}
          >
            {signingIn ? (
              <ActivityIndicator size="small" color={colors.inverseText} />
            ) : (
              <>
                <MaterialCommunityIcons name="google" size={20} color={colors.inverseText} />
                <Text style={styles.googleBtnText}>{t('closet.scan.authPrompt.googleButton')}</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.authPromptCancelBtn}
            onPress={handleAuthPromptCancel}
            disabled={signingIn}
            activeOpacity={0.7}
          >
            <Text style={styles.authPromptCancelBtnText}>{t('closet.scan.authPrompt.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </BottomSheet>
    </>
  );
}

// One-tap follow-up iterations on the outfit that was just suggested — each
// button just sends a canned prompt through the normal `handleSend` path
// (via `onQuickAction`), same as if the client had typed and submitted it.
function QuickActionsRow({ onSelect }) {
  const { t } = useTranslation();
  return (
    <View style={styles.quickActionsRow}>
      {QUICK_ACTIONS.map((action) => (
        <TouchableOpacity
          key={action.id}
          style={styles.quickActionChip}
          onPress={() => {
            triggerHaptic();
            onSelect(t(action.promptKey));
          }}
          activeOpacity={0.8}
        >
          <Text style={styles.quickActionChipText}>{t(action.labelKey)}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// One-tap emotional reactions to the outfit that was just suggested — same
// send-a-canned-prompt mechanism as Quick Actions above, rendered as its own
// row directly below it under the last AI turn.
function FeedbackActionsRow({ onSelect }) {
  const { t } = useTranslation();
  return (
    <View style={styles.feedbackActionsRow}>
      {FEEDBACK_ACTIONS.map((action) => (
        <TouchableOpacity
          key={action.id}
          style={styles.feedbackActionChip}
          onPress={() => {
            triggerHaptic();
            onSelect(t(action.promptKey));
          }}
          activeOpacity={0.8}
        >
          <Text style={styles.feedbackActionChipText}>{t(action.labelKey)}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// Redesign v2 — fills the dead space between the welcome bubble and the
// input bar when there's nothing else to look at yet (rendered as the
// FlatList's footer, so it sits directly after the welcome bubble and
// scrolls away naturally once real messages exist).
function EmptyStateCard({ onSurpriseMe }) {
  const { t } = useTranslation();
  return (
    <View style={styles.emptyStateCard}>
      <View style={styles.emptyStateIconWrap}>
        <Feather name="star" size={20} color={colors.inverseText} />
      </View>
      <Text style={styles.emptyStateTitle}>{t('stylist.emptyState.title')}</Text>
      <Text style={styles.emptyStateCaption}>{t('stylist.emptyState.caption')}</Text>
      <TouchableOpacity style={styles.emptyStateBtn} onPress={onSurpriseMe} activeOpacity={0.85}>
        <Text style={styles.emptyStateBtnText}>{t('stylist.quickPrompts.surpriseMe')}</Text>
      </TouchableOpacity>
    </View>
  );
}

// Horizontal, scrollable one-tap chip row — shared shell for both
// QUICK_PROMPTS (conversation start) and CONTEXT_PROMPTS (a clarifying-
// question reply), the two cases DynamicQuickReplies below renders as a
// plain prompt list rather than the outfit-feedback combo. Text is sent
// verbatim as the outgoing message — `onSelect` is `handleSend`.
function PromptChipsRow({ prompts, onSelect }) {
  const { t } = useTranslation();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.quickPromptsRow}
      keyboardShouldPersistTaps="handled"
    >
      {prompts.map((prompt) => (
        <TouchableOpacity
          key={prompt.id}
          style={styles.quickPromptChip}
          onPress={() => onSelect(t(prompt.promptKey))}
          activeOpacity={0.8}
        >
          <Text style={styles.quickPromptChipText}>{t(prompt.promptKey)}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// The one place that decides what the reply-chip row above the input bar
// shows, based on the actual state of the conversation instead of a fixed
// row that stays put no matter what the stylist just said:
//   - Fresh conversation (nothing but the welcome bubble) -> QUICK_PROMPTS,
//     generic occasion starters.
//   - Last reply delivered a real outfit (RULE #0 in aiChatEngine.js
//     guarantees non-empty "suggested_outfit_ids" only when it actually
//     built a look) -> QuickActionsRow + FeedbackActionsRow, so the client
//     can iterate on or react to THAT look.
//   - Last reply was a clarifying question instead (RULE #0's other case —
//     no outfit, the stylist asked for occasion/mood/vibe) -> CONTEXT_PROMPTS,
//     direct one-tap answers to that question.
//   - Anything else (a special card with its own dedicated CTA already —
//     closetEmpty/profileStaleConfirm — or the last message is the client's
//     own, meaning a reply is still in flight) -> nothing; the typing
//     indicator or that card's own button already covers it.
// Driven by `outfitIds` presence rather than sniffing the reply text for
// English words like "vibe"/"occasion" — aiChatEngine's own LANGUAGE rule
// writes that text in whatever language the app is set to, so a keyword
// match would silently stop working for every non-English client. This is
// reliable specifically because aiChatEngine.js's own parsing now forces
// `outfitIds` to `[]` whenever Gemini's "is_clarifying_question" flag is
// true, even if "suggested_outfit_ids" itself came back non-empty (e.g. a
// mid-conversation follow-up like "what about tomorrow?" echoing ids from
// an earlier turn while still asking a new clarifying question) — so a
// clarifying-question turn can never fall through to the outfit-feedback
// branch below by accident.
function DynamicQuickReplies({ lastMessage, isConversationStart, onSelect }) {
  if (isConversationStart) {
    return <PromptChipsRow prompts={QUICK_PROMPTS} onSelect={onSelect} />;
  }

  if (!lastMessage || lastMessage.sender !== 'ai') return null;

  const hasOutfit = (lastMessage.outfitIds || []).length > 0;
  if (hasOutfit) {
    return (
      <View style={styles.dynamicRepliesWrap}>
        <QuickActionsRow onSelect={onSelect} />
        <FeedbackActionsRow onSelect={onSelect} />
      </View>
    );
  }

  if (lastMessage.type === 'closetEmpty' || lastMessage.type === 'profileStaleConfirm') return null;

  return <PromptChipsRow prompts={CONTEXT_PROMPTS} onSelect={onSelect} />;
}

// Lets the client pin this exact generated look (wardrobe item ids + any
// suggested-to-buy items) to a day on the WeeklyPlanner without leaving the
// chat. Picks from the same 7-day window WeeklyPlanner shows.
function SaveToPlannerButton({ outfitIds }) {
  const { t, i18n } = useTranslation();
  const scheduleOutfit = usePlannerStore((state) => state.scheduleOutfit);
  const scheduledOutfits = usePlannerStore((state) => state.scheduledOutfits);
  const isPro = useUserStore((state) => state.isPro);
  const [modalVisible, setModalVisible] = useState(false);
  const [savedLabel, setSavedLabel] = useState(null);
  // Own PaywallModal instance, same as SaveInspirationButton right above
  // owning its own BottomSheet rather than reaching up into the screen's
  // state — this button already manages its own day-picker Modal locally,
  // so its freemium gate stays local too.
  const { paywallMessage, showPaywall, closePaywall } = usePaywall();

  const days = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      return date;
    });
  }, []);

  async function handleSelectDay(date) {
    triggerHaptic();
    const dateKey = toDateKey(date);
    // Freemium day-count cap — pre-checked here for the common case (avoids
    // a round trip to the store's own backstop, which exists specifically
    // because THIS picker offers every one of the next 7 days with no
    // per-pill lock of its own, unlike PlannerScreen's day row). Replacing
    // an already-planned day never counts against the cap.
    if (!isPro && !scheduledOutfits[dateKey] && getPlannedDaysCount(scheduledOutfits) >= FREE_PLANNED_DAYS_LIMIT) {
      setModalVisible(false);
      showPaywall(t('paywall.plannerDaysLimitMessage'));
      return;
    }
    try {
      await scheduleOutfit(dateKey, { outfitIds });
    } catch (err) {
      // scheduleOutfit's own backstop threw — the pre-check above should
      // already have caught this in practice, but a second device planning
      // a day concurrently is exactly the race that backstop exists for.
      console.error('[StylistScreen] Save to Planner failed:', err);
      setModalVisible(false);
      showPaywall(t('paywall.plannerDaysLimitMessage'));
      return;
    }
    setModalVisible(false);
    setSavedLabel(formatWeekdayShortWithDate(date, i18n.language));
  }

  if (savedLabel) {
    return (
      <Text style={styles.plannerSavedText}>{t('stylist.plannerModal.saved', { date: savedLabel })}</Text>
    );
  }

  return (
    <>
      <TouchableOpacity
        style={styles.saveToPlannerBtn}
        onPress={() => setModalVisible(true)}
        activeOpacity={0.8}
      >
        <Feather name="calendar" size={14} color={colors.textPrimary} />
        <Text style={styles.saveToPlannerBtnText}>{t('stylist.saveToPlanner')}</Text>
      </TouchableOpacity>

      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <Pressable style={styles.plannerBackdrop} onPress={() => setModalVisible(false)}>
          <Pressable style={styles.plannerSheet} onPress={() => {}}>
            <Text style={styles.plannerSheetTitle}>{t('stylist.plannerModal.title')}</Text>
            {days.map((date) => (
              <TouchableOpacity
                key={toDateKey(date)}
                style={styles.plannerDayRow}
                onPress={() => handleSelectDay(date)}
                activeOpacity={0.7}
              >
                <Text style={styles.plannerDayRowText}>
                  {formatWeekdayLong(date, i18n.language)}
                </Text>
              </TouchableOpacity>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      <PaywallModal visible={!!paywallMessage} message={paywallMessage} onClose={closePaywall} />
    </>
  );
}


// Classic 3-dot typing indicator — one Animated.Value per dot, each bouncing
// up and back down with a staggered start so they ripple left-to-right
// instead of moving in lockstep. Rendered inside the same `aiCard` shell as
// a real reply, so it reads as "the stylist is about to answer here" rather
// than a generic spinner.
function TypingIndicator() {
  const { t } = useTranslation();
  const dotValues = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
  const [statusIndex, setStatusIndex] = useState(0);
  const statusOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loops = dotValues.map((value, index) => {
      const stagger = index * TYPING_DOT_STAGGER_MS;
      return Animated.loop(
        Animated.sequence([
          Animated.delay(stagger),
          Animated.timing(value, {
            toValue: -5,
            duration: TYPING_DOT_BOUNCE_MS,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0,
            duration: TYPING_DOT_BOUNCE_MS,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay(Math.max(TYPING_CYCLE_MS - stagger - TYPING_DOT_BOUNCE_MS * 2, 0)),
        ])
      );
    });

    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cross-fades to the next status phrase on a timer — reset to index 0 on
  // every mount, which happens exactly once per in-flight request (this
  // component only renders while `sending` is true), so a fresh request
  // always starts back at "Analyzing weather..." rather than resuming
  // wherever the previous one left off.
  useEffect(() => {
    const interval = setInterval(() => {
      Animated.timing(statusOpacity, {
        toValue: 0,
        duration: STATUS_FADE_MS,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        setStatusIndex((prev) => (prev + 1) % STATUS_KEYS.length);
        Animated.timing(statusOpacity, {
          toValue: 1,
          duration: STATUS_FADE_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start();
      });
    }, STATUS_CYCLE_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.messageRowAi}>
      <View style={[styles.aiCard, styles.typingCard]}>
        <Animated.Text style={[styles.typingStatusText, { opacity: statusOpacity }]}>
          {t(`stylist.status.${STATUS_KEYS[statusIndex]}`)}
        </Animated.Text>
        <View style={styles.typingDotsRow}>
          {dotValues.map((value, index) => (
            <Animated.View key={index} style={[styles.typingDot, { transform: [{ translateY: value }] }]} />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.premiumBackground },
  // Cancels ScreenContainer's own 16px shell padding — every child below
  // (header/banner/list/input bar) applies that same spacing.screenH itself
  // instead, since none of them share one common padded ancestor here.
  zeroHPadding: { paddingHorizontal: 0 },
  flexFill: { flex: 1 },
  // Margin/padding moved to `headerOuter` (see the TourTarget's own
  // comment) — this stays just the text's own type styling now.
  headerOuter: { paddingHorizontal: spacing.screenH, marginTop: spacing.sm, marginBottom: spacing.md },
  header: {
    ...typography.h2,
    fontWeight: '800',
  },

  // Zero-Closet notice — tells the client up front why they're getting a
  // shopping board instead of an outfit built from items they own.
  zeroClosetBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: spacing.screenH,
    marginBottom: spacing.sm,
    padding: spacing.xs,
    backgroundColor: colors.glassCard,
    borderRadius: radius.lg,
    ...shadows.sm,
  },
  zeroClosetBannerText: { flex: 1, fontSize: 12, lineHeight: 16, color: colors.textSecondary },

  messagesContent: {
    paddingHorizontal: spacing.screenH,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },

  messageRowUser: { alignItems: 'flex-end', marginBottom: spacing.sm },
  userBubble: {
    maxWidth: '80%',
    backgroundColor: colors.glassCard,
    borderRadius: radius.card,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    ...shadows.soft,
  },
  userBubbleText: { color: colors.textPrimary, fontSize: 15, lineHeight: 21 },
  userImage: { width: 200, height: 200, borderRadius: radius.card, ...shadows.soft },

  messageRowAi: { alignItems: 'flex-start', marginBottom: spacing.sm, paddingRight: spacing.lg },
  // The assistant's answer as a "look presentation" card — glassCard fill,
  // rounded corners, light lift — instead of bare text sitting on the
  // screen background. Quick/Feedback Actions render below this, not
  // inside it, so they read as controls on the message rather than part
  // of the stylist's own copy.
  aiCard: {
    backgroundColor: colors.glassCard,
    borderRadius: radius.lg,
    padding: spacing.sm,
    maxWidth: '88%',
    ...shadows.sm,
  },
  aiMessageText: { color: colors.textPrimary, fontSize: 15, lineHeight: 21 },

  profileStaleActions: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm },
  profileStaleYesBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  profileStaleYesBtnText: { color: colors.inverseText, fontSize: 13, fontWeight: '700' },
  profileStaleNoBtn: {
    backgroundColor: colors.glassCard,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    ...shadows.sm,
  },
  profileStaleNoBtnText: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  profileStaleResolvedText: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },

  // Wardrobe-Only Guard's CTA — solid accent fill (same weight as a primary
  // action, not a secondary/outline chip) since adding an item is the ONLY
  // way forward from this card, not one option among several.
  completeProfileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  completeProfileBtnText: { color: colors.inverseText, fontSize: 14, fontWeight: '700' },

  outfitStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  outfitMiniCard: { width: 84 },
  outfitMiniImage: {
    width: 84,
    height: 84,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    marginBottom: 4,
  },
  outfitMiniLabel: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
  outfitMiniColor: { fontSize: 11, color: colors.textSecondary },

  saveToPlannerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: colors.glassCard,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    marginTop: spacing.sm,
    ...shadows.sm,
  },
  saveToPlannerBtnText: { fontSize: 12, fontWeight: '700', color: colors.textPrimary },

  // Save Inspiration — deliberately bigger/bolder than saveToPlannerBtn
  // above (full-width pill vs. a small tag) so it reads as the primary
  // action on a look, matching the "beautiful, noticeable" ask; the
  // planner shortcut stays secondary underneath it.
  saveInspirationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: 12,
    marginTop: spacing.sm,
    ...shadows.accent,
  },
  saveInspirationBtnSaved: { backgroundColor: colors.glassCard, ...shadows.sm },
  saveInspirationBtnText: { fontSize: 14, fontWeight: '800', color: colors.inverseText },
  saveInspirationBtnTextSaved: { color: colors.success },

  // Guest gate for Save Inspiration — same shape as ScanSheet's own
  // Save-to-Closet auth prompt, duplicated here rather than shared (it's a
  // small, screen-local style block, and the two sheets already carry
  // slightly different copy/spacing conventions per their own screen).
  authPromptWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, alignItems: 'center' },
  authPromptIconWrap: {
    width: 64,
    height: 64,
    borderRadius: radius.cardLg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    shadowColor: colors.violet,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 6,
  },
  authPromptTitle: { ...typography.h2, fontSize: 19, textAlign: 'center', marginBottom: spacing.xs },
  authPromptMessage: {
    ...typography.bodySecondary,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  authPromptError: {
    fontSize: 13,
    color: colors.danger,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    width: '100%',
    backgroundColor: colors.inverseBackground,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    ...shadows.accent,
  },
  googleBtnText: { ...buttons.primaryText, fontSize: 16 },
  actionBtnDisabled: { opacity: opacity.disabled },
  authPromptCancelBtn: {
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authPromptCancelBtnText: { fontSize: 14.5, fontWeight: '600', color: colors.textSecondary },

  // DynamicQuickReplies' outfit-feedback case — stacks QuickActionsRow +
  // FeedbackActionsRow above the input bar. Horizontal padding lives here
  // (not on the two rows themselves): they used to sit inside the already-
  // padded `aiCard`, but now render in the zero-inset shell alongside
  // `quickPromptsRow`/`inputBar`, which carry this same `spacing.screenH`
  // padding independently for the same reason.
  dynamicRepliesWrap: { paddingHorizontal: spacing.screenH, paddingBottom: spacing.xs, gap: spacing.xs },

  // Quick Actions — one-tap outfit iterations under a suggestion turn.
  quickActionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  quickActionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  quickActionChipText: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },

  // Feedback Actions — emotional-reaction row directly under Quick Actions.
  // Filled glassCard chips (vs. Quick Actions' outline) so the two rows read
  // as distinct groups: "adjust the look" vs. "react to it".
  feedbackActionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  feedbackActionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.glassCard,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    ...shadows.sm,
  },
  feedbackActionChipText: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },

  plannerSavedText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: spacing.sm,
  },
  plannerBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  plannerSheet: {
    backgroundColor: colors.premiumBackground,
    borderRadius: radius.card,
    paddingVertical: spacing.xs,
    ...shadows.soft,
  },
  plannerSheetTitle: {
    ...typography.label,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  plannerDayRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  plannerDayRowText: { fontSize: 15, color: colors.textPrimary, fontWeight: '500' },

  errorBox: {
    marginHorizontal: spacing.screenH,
    marginBottom: spacing.xs,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
  },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 18 },

  // Empty-state feature card — v7: sky-tinted (this tab's own accent, per
  // the mockup's `stylistFeatureCardStyle`/`stylistFeatureIconWrapStyle`/
  // `stylistFeatureBtnStyle`, all keyed off `sky`), not violet — the global
  // accent doesn't belong on a Stylist-only element when every other
  // section already gets its own tab color elsewhere (Planner=coral,
  // Profile=sage). Centered, shown only until the client's first real
  // exchange exists.
  emptyStateCard: {
    backgroundColor: cardTints.sky,
    borderWidth: 1,
    borderColor: cardTints.skyBorder,
    borderRadius: radius.cardLg,
    padding: spacing.md,
    marginHorizontal: spacing.screenH,
    marginTop: spacing.sm,
    alignItems: 'center',
  },
  emptyStateIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.sky,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyStateTitle: { fontSize: 16, fontWeight: '800', color: colors.textPrimary, marginBottom: 4, textAlign: 'center' },
  emptyStateCaption: {
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  // Shadow shape is this button's own (`0 8px 18px sky4d`), not the shared
  // `shadows.accent` (which is violet-colored and a different offset/radius).
  emptyStateBtn: {
    backgroundColor: colors.sky,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    shadowColor: colors.sky,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 18,
    elevation: 5,
  },
  emptyStateBtnText: { fontSize: 13, fontWeight: '700', color: colors.inverseText },

  // Quick Prompts — horizontal one-tap starters pinned above the input bar.
  // No wrapper bleed needed here (unlike WardrobeScreen's carousels): this
  // ScrollView isn't nested inside any padded ancestor — `zeroHPadding`
  // above means the shell contributes zero horizontal inset, so this
  // content padding is already the only inset, and scrolling already
  // reaches the true screen edge.
  quickPromptsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.screenH,
    paddingBottom: spacing.xs,
  },
  quickPromptChip: {
    backgroundColor: colors.glassCard,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    ...shadows.sm,
  },
  quickPromptChipText: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.screenH,
    paddingVertical: spacing.xs,
    backgroundColor: colors.premiumBackground,
    ...shadows.soft,
  },
  // Freemium chat cap — replaces the entire input bar once the free tier's
  // message count is spent. Same horizontal padding/background as
  // `inputBar` above so it reads as "the same slot, different content"
  // rather than a jarring layout shift.
  chatLimitBar: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.screenH,
    paddingVertical: spacing.sm,
    backgroundColor: colors.premiumBackground,
    ...shadows.soft,
  },
  chatLimitText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  chatLimitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chatLimitBtnText: { color: colors.inverseText, fontSize: 14, fontWeight: '700' },
  // Fixed-width slot for the camera button — pins its hit area to exactly
  // 44px regardless of what the flex siblings around it do, and `zIndex`
  // guarantees it always wins hit-testing over the adjacent TextInput.
  cameraBtnContainer: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  // "Rate My Fit" — glass + soft shadow, reads as a secondary action next
  // to the accent-filled send button.
  rateMyFitBtn: {
    width: 44,
    height: 44,
    borderRadius: 18,
    backgroundColor: colors.glassCard,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  // `flex: 1` — takes only the space left over after the fixed-width camera
  // slot and send button, so it can never encroach on either.
  input: {
    flex: 1,
    height: 50,
    backgroundColor: colors.glassCard,
    borderRadius: radius.xl,
    color: colors.textPrimary,
    fontSize: 15,
    paddingHorizontal: spacing.sm,
  },
  // Primary CTA of the screen — Electric Blue fill.
  // v6 — "violet circle, arrow icon" per the redesign's input-bar spec
  // (was `radius.xl`'s squircle).
  sendBtn: {
    width: 50,
    height: 50,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },

  // Typing Indicator — 3 bouncing dots inside the same aiCard shell as a
  // real reply.
  typingCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 14 },
  typingStatusText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  typingDotsRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  typingDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.textMuted,
  },
});

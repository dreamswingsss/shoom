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
  Linking,
  Modal,
  Pressable,
  Alert,
  ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { sendChatMessage, fetchInspirationBoard } from '../services/aiChatEngine';
import { useUserStore } from '../store/useUserStore';
import { useWardrobeStore } from '../store/useWardrobeStore';
import { useChatStore } from '../store/useChatStore';
import { usePlannerStore, toDateKey } from '../store/usePlannerStore';
import { useFadeOnFocus } from '../hooks/useFadeOnFocus';
import { useWeather } from '../hooks/useWeather';
import { formatWeekdayLong, formatWeekdayShortWithDate } from '../utils/dateFormat';
import { colors, cardTints, spacing, radius, typography, shadows } from '../theme/tokens';
import { FadeInView } from '../components/AnimatedPressable';
import { triggerHaptic } from '../utils/haptics';

// Matches Markdown links: [label](https://...). Restricted to http(s) so a
// stray/AI-generated non-http scheme (e.g. "javascript:") can never end up
// wired to a tappable Text — it just renders as plain, inert text instead.
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

// Splits AI message text on Markdown links into an array of plain-text and
// link runs. The chat's copy is otherwise plain single-line text (per the
// stylist's "zero fluff" prompt rules), so a full Markdown renderer would
// be overkill for the one feature it actually needs: tappable links.
function parseMarkdownLinks(text) {
  const parts = [];
  let lastIndex = 0;
  let match;

  MARKDOWN_LINK_PATTERN.lastIndex = 0;
  while ((match = MARKDOWN_LINK_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index) });
    }
    parts.push({ text: match[1], url: match[2] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex) });
  }
  return parts;
}

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

// Quick Prompts — a horizontal row of one-tap starters above the input bar.
// Each `prompt` is the literal text sent to the stylist (translated, since
// unlike aiChatEngine's system-prompt copy this IS something a human reads —
// as their own outgoing chat bubble).
const QUICK_PROMPTS = [
  { id: 'officeLook', promptKey: 'stylist.quickPrompts.officeLook' },
  { id: 'dateNight', promptKey: 'stylist.quickPrompts.dateNight' },
  { id: 'casualWeekend', promptKey: 'stylist.quickPrompts.casualWeekend' },
  { id: 'rainyDay', promptKey: 'stylist.quickPrompts.rainyDay' },
  { id: 'surpriseMe', promptKey: 'stylist.quickPrompts.surpriseMe' },
];

// Quick Actions — shown under the most recent AI turn (once it's actually
// replied, not the bare welcome greeting), letting the client iterate on the
// last suggestion in one tap instead of typing a follow-up. The emoji lives
// in the translated label itself (not a separate icon glyph) — it's the
// whole visual marker for these chips.
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

// Feedback Actions — a second, emotional-reaction row under the same last-AI
// turn as Quick Actions above. Where Quick Actions iterate on the outfit
// itself (swap/warmer/cooler/formal), these react to it, still via the same
// canned-prompt-through-handleSend mechanism.
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

function handleLinkPress(url) {
  Linking.canOpenURL(url)
    .then((supported) => {
      if (supported) return Linking.openURL(url);
      console.warn(`[StylistScreen] Cannot open URL: ${url}`);
    })
    .catch((err) => console.warn(`[StylistScreen] Failed to open URL "${url}":`, err.message));
}

// Renders `text` as plain <Text>, except any Markdown link runs become
// tappable, underlined spans that open in the device browser.
function LinkableText({ text, style, linkStyle }) {
  const parts = useMemo(() => parseMarkdownLinks(text), [text]);

  return (
    <Text style={style}>
      {parts.map((part, index) =>
        part.url ? (
          <Text key={index} style={linkStyle} onPress={() => handleLinkPress(part.url)}>
            {part.text}
          </Text>
        ) : (
          <Text key={index}>{part.text}</Text>
        )
      )}
    </Text>
  );
}

export default function StylistScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const route = useRoute();
  const wardrobe = useWardrobeStore((state) => state.items);
  const isProfileStale = useUserStore((state) => state.isProfileStale);
  const confirmProfileUpdate = useUserStore((state) => state.confirmProfileUpdate);
  const dismissProfileStale = useUserStore((state) => state.dismissProfileStale);
  const messages = useChatStore((state) => state.messages);
  const addMessage = useChatStore((state) => state.addMessage);
  const updateMessage = useChatStore((state) => state.updateMessage);
  const pendingPrompt = useChatStore((state) => state.pendingPrompt);
  const clearPendingPrompt = useChatStore((state) => state.clearPendingPrompt);
  const upsertProfileStalePrompt = useChatStore((state) => state.upsertProfileStalePrompt);
  const fadeOpacity = useFadeOnFocus();
  const weather = useWeather();

  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  const listRef = useRef(null);

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
    handleSend(t('stylist.targetItemPrompt', { item: itemLabel }));
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

  async function handleSend(overrideText) {
    const text = (overrideText ?? inputText).trim();
    if (!text || sending) return;

    triggerHaptic();
    const userMessage = { id: `${Date.now()}-user`, sender: 'user', text };
    const historyForRequest = messages;

    addMessage(userMessage);
    setInputText('');
    setError(null);
    setSending(true);

    try {
      if (wardrobe.length === 0) {
        // Zero-Closet — nothing to build an outfit from yet, so ask for a
        // shopping-reference "Inspiration Board" reasoned from the profile
        // (skin tone / body shape / hair color) instead.
        const { text: aiText, boardItems } = await fetchInspirationBoard({
          message: text,
          history: historyForRequest,
          weather,
        });
        addMessage({ id: `${Date.now()}-ai`, sender: 'ai', type: 'inspirationBoard', text: aiText, boardItems });
      } else {
        const { text: aiText, outfitIds, newItems } = await sendChatMessage({
          message: text,
          wardrobe,
          history: historyForRequest,
        });
        addMessage({ id: `${Date.now()}-ai`, sender: 'ai', text: aiText, outfitIds, newItems });
      }
    } catch (err) {
      setError(err.message || t('stylist.genericError'));
    } finally {
      setSending(false);
    }
  }

  async function handleCameraPress() {
    triggerHaptic();
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('stylist.cameraPermission.title'), t('stylist.cameraPermission.message'));
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
    <Animated.View style={[styles.container, { opacity: fadeOpacity, paddingTop: insets.top }]}>
      <Text style={styles.header}>{t('stylist.header')}</Text>

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
        renderItem={({ item, index }) => (
          <FadeInView duration={250}>
            <MessageBubble
              item={item}
              wardrobeById={wardrobeById}
              isLastMessage={index === visibleMessages.length - 1}
              sending={sending}
              onConfirmProfileUpdate={handleProfileUpdateConfirm}
              onDismissProfileUpdate={handleProfileUpdateDismiss}
              onQuickAction={(prompt) => handleSend(prompt)}
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

      <KeyboardAvoidingView
        behavior={Platform.select({ ios: 'padding', android: 'height', default: undefined })}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <QuickPromptsRow onSelect={(prompt) => handleSend(prompt)} disabled={sending} />

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
    </Animated.View>
  );
}

function MessageBubble({
  item,
  wardrobeById,
  isLastMessage,
  sending,
  onConfirmProfileUpdate,
  onDismissProfileUpdate,
  onQuickAction,
}) {
  const { t } = useTranslation();
  const isUser = item.sender === 'user';

  // Refine-this-look + reaction rows — only under the most recent AI turn,
  // once it's actually replied (not the bare welcome greeting) and not
  // while the next reply is still streaming in.
  const showResponseActions = !isUser && isLastMessage && !sending && item.id !== 'welcome';

  if (item.type === 'inspirationBoard') {
    return (
      <View style={styles.messageRowAi}>
        <View style={styles.aiCard}>
          <LinkableText text={item.text} style={styles.aiMessageText} linkStyle={styles.aiMessageLink} />
          <InspirationBoard items={item.boardItems || []} />
        </View>
        {showResponseActions && (
          <>
            <QuickActionsRow onSelect={onQuickAction} />
            <FeedbackActionsRow onSelect={onQuickAction} />
          </>
        )}
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
  const newItems = item.newItems || [];

  return (
    <View style={styles.messageRowAi}>
      <View style={styles.aiCard}>
        <LinkableText text={item.text} style={styles.aiMessageText} linkStyle={styles.aiMessageLink} />

        {outfitItems.length > 0 && (
          <View style={styles.outfitStrip}>
            {outfitItems.map((wardrobeItem) => (
              <View key={wardrobeItem.id} style={styles.outfitMiniCard}>
                <Image source={{ uri: wardrobeItem.imageUri }} style={styles.outfitMiniImage} />
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

        {newItems.length > 0 && (
          <View style={styles.buyStrip}>
            {newItems.map((newItem, index) => {
              const isClickable = Boolean(newItem.buyUrl);
              return (
                <View key={`${newItem.name}-${index}`} style={styles.buyCardShadow}>
                  <TouchableOpacity
                    style={styles.buyCard}
                    onPress={isClickable ? () => handleLinkPress(newItem.buyUrl) : undefined}
                    disabled={!isClickable}
                    activeOpacity={0.8}
                  >
                    <BuyItemImage uri={newItem.imageUrl} name={newItem.name} />
                    <Text style={styles.buyName} numberOfLines={2}>
                      {newItem.name}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}

        {(outfitItems.length > 0 || newItems.length > 0) && (
          <SaveToPlannerButton outfitIds={item.outfitIds || []} newItems={newItems} />
        )}
      </View>

      {showResponseActions && (
        <>
          <QuickActionsRow onSelect={onQuickAction} />
          <FeedbackActionsRow onSelect={onQuickAction} />
        </>
      )}
    </View>
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

// "Inspiration Board" — the Zero-Closet reply's shopping-reference grid.
// Visually similar to the "suggested to buy" strip on a normal outfit turn
// (same card width/shadow), but each card also shows the profile-tied
// "reason" the client doesn't get from a plain buy card.
function InspirationBoard({ items }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;

  return (
    <View style={styles.inspirationBoard}>
      <View style={styles.inspirationHeader}>
        <Feather name="compass" size={12} color={colors.accent} />
        <Text style={styles.inspirationHeaderText}>{t('stylist.inspirationBoard.title')}</Text>
      </View>
      <View style={styles.buyStrip}>
        {items.map((boardItem, index) => {
          const isClickable = Boolean(boardItem.buyUrl);
          return (
            <View key={`${boardItem.name}-${index}`} style={styles.inspirationCardShadow}>
              <TouchableOpacity
                style={styles.inspirationCard}
                onPress={isClickable ? () => handleLinkPress(boardItem.buyUrl) : undefined}
                disabled={!isClickable}
                activeOpacity={0.8}
              >
                <BuyItemImage uri={boardItem.imageUrl} name={boardItem.name} />
                <Text style={styles.buyName} numberOfLines={2}>
                  {boardItem.name}
                </Text>
                {!!boardItem.reason && (
                  <Text style={styles.inspirationReason} numberOfLines={3}>
                    {boardItem.reason}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          );
        })}
      </View>
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

// Horizontal, scrollable one-tap starters pinned above the input bar. Text
// is sent verbatim as the outgoing message — `onSelect` is `handleSend`.
function QuickPromptsRow({ onSelect, disabled }) {
  const { t } = useTranslation();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.quickPromptsRow}
      keyboardShouldPersistTaps="handled"
    >
      {QUICK_PROMPTS.map((prompt) => (
        <TouchableOpacity
          key={prompt.id}
          style={styles.quickPromptChip}
          onPress={() => onSelect(t(prompt.promptKey))}
          disabled={disabled}
          activeOpacity={0.8}
        >
          <Text style={styles.quickPromptChipText}>{t(prompt.promptKey)}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// Lets the client pin this exact generated look (wardrobe item ids + any
// suggested-to-buy items) to a day on the WeeklyPlanner without leaving the
// chat. Picks from the same 7-day window WeeklyPlanner shows.
function SaveToPlannerButton({ outfitIds, newItems }) {
  const { t, i18n } = useTranslation();
  const scheduleOutfit = usePlannerStore((state) => state.scheduleOutfit);
  const [modalVisible, setModalVisible] = useState(false);
  const [savedLabel, setSavedLabel] = useState(null);

  const days = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      return date;
    });
  }, []);

  function handleSelectDay(date) {
    triggerHaptic();
    scheduleOutfit(toDateKey(date), { outfitIds, newItems });
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
    </>
  );
}

// Gemini's `image_url` is frequently broken or hallucinated — this renders
// the real photo when it loads, and quietly swaps to a monochrome
// initial-letter tile instead of a dead image icon when it doesn't.
function BuyItemImage({ uri, name }) {
  const [failed, setFailed] = useState(false);
  const initial = name?.trim()?.[0]?.toUpperCase() || '?';

  if (!uri || failed) {
    return (
      <View style={styles.buyImagePlaceholder}>
        <Text style={styles.buyImagePlaceholderText}>{initial}</Text>
      </View>
    );
  }

  return <Image source={{ uri }} style={styles.buyImage} onError={() => setFailed(true)} />;
}

// Classic 3-dot typing indicator — one Animated.Value per dot, each bouncing
// up and back down with a staggered start so they ripple left-to-right
// instead of moving in lockstep. Rendered inside the same `aiCard` shell as
// a real reply, so it reads as "the stylist is about to answer here" rather
// than a generic spinner.
function TypingIndicator() {
  const dotValues = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];

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

  return (
    <View style={styles.messageRowAi}>
      <View style={[styles.aiCard, styles.typingCard]}>
        {dotValues.map((value, index) => (
          <Animated.View key={index} style={[styles.typingDot, { transform: [{ translateY: value }] }]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // paddingTop set inline above, from real safe-area top inset.
  container: { flex: 1, backgroundColor: colors.premiumBackground },
  header: { ...typography.h2, fontWeight: '800', paddingHorizontal: spacing.sm, marginTop: 14, marginBottom: spacing.md },

  // Zero-Closet notice — tells the client up front why they're getting a
  // shopping board instead of an outfit built from items they own.
  zeroClosetBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    padding: spacing.xs,
    backgroundColor: colors.glassCard,
    borderRadius: radius.lg,
    ...shadows.sm,
  },
  zeroClosetBannerText: { flex: 1, fontSize: 12, lineHeight: 16, color: colors.textSecondary },

  messagesContent: {
    paddingHorizontal: spacing.sm,
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
  // Monochrome by design — links read as tappable via underline + weight
  // rather than an accent color, so they stay visually distinct from the
  // screen's Electric Blue CTAs (send button, "Yes, update").
  aiMessageLink: {
    color: colors.textPrimary,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },

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

  // "Suggested to buy" cards — visually distinct from wardrobe mini cards:
  // glass background, slightly wider.
  buyStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  // Split shadow (outer) / clip (inner): a rounded-corner soft shadow and
  // `overflow: hidden` (needed to clip BuyItemImage to the card's corners)
  // can't live on the same node — iOS clips the shadow away too.
  buyCardShadow: {
    width: 104,
    borderRadius: radius.card,
    backgroundColor: colors.glassCard,
    ...shadows.soft,
  },
  buyCard: {
    width: 104,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  buyImage: { width: '100%', height: 104, backgroundColor: colors.surface },
  buyImagePlaceholder: {
    width: '100%',
    height: 104,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  buyImagePlaceholderText: {
    fontFamily: typography.h2.fontFamily,
    fontWeight: '700',
    fontSize: 28,
    color: colors.textMuted,
  },
  buyName: { fontSize: 12, fontWeight: '600', color: colors.textPrimary, padding: 6 },

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

  // Inspiration Board (Zero-Closet) — same card geometry as the "buy" strip,
  // plus a header label and a reason caption baked into each card.
  inspirationBoard: { marginTop: spacing.xs },
  inspirationHeader: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: spacing.xs },
  inspirationHeaderText: {
    ...typography.label,
    fontSize: 11,
    color: colors.accent,
  },
  inspirationCardShadow: {
    width: 132,
    borderRadius: radius.card,
    backgroundColor: colors.glassCard,
    ...shadows.soft,
  },
  inspirationCard: { width: 132, borderRadius: radius.card, overflow: 'hidden' },
  inspirationReason: {
    fontSize: 11,
    lineHeight: 14,
    color: colors.textSecondary,
    paddingHorizontal: 6,
    paddingBottom: 8,
  },

  plannerSavedText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: spacing.sm,
  },
  plannerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
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
    marginHorizontal: spacing.sm,
    marginBottom: spacing.xs,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
  },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 18 },

  // Empty-state feature card — violet-tinted, centered, shown only until
  // the client's first real exchange exists.
  emptyStateCard: {
    backgroundColor: cardTints.violet,
    borderRadius: radius.cardLg,
    padding: spacing.md,
    marginHorizontal: spacing.sm,
    marginTop: spacing.sm,
    alignItems: 'center',
  },
  emptyStateIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.violet,
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
  emptyStateBtn: {
    backgroundColor: colors.violet,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    ...shadows.accent,
  },
  emptyStateBtnText: { fontSize: 13, fontWeight: '700', color: colors.inverseText },

  // Quick Prompts — horizontal one-tap starters pinned above the input bar.
  quickPromptsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
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
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.premiumBackground,
    ...shadows.soft,
  },
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
  sendBtn: {
    width: 50,
    height: 50,
    borderRadius: radius.xl,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },

  // Typing Indicator — 3 bouncing dots inside the same aiCard shell as a
  // real reply.
  typingCard: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 14 },
  typingDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.textMuted,
  },
});

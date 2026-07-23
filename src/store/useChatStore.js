import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from '../i18n';

// `i18n.t()` (not the useTranslation hook — this isn't a component) is safe
// to call here: importing '../i18n' fully evaluates its module body first,
// which calls i18n.init() synchronously with inline resources. Note this
// text is frozen into AsyncStorage the moment it's first written — like any
// other persisted chat message, it won't retroactively re-translate if the
// user picks a different language in a later session.
export const WELCOME_MESSAGE = {
  id: 'welcome',
  sender: 'ai',
  text: i18n.t('stylist.welcomeMessage'),
  outfitIds: [],
};

// Persists the AI Stylist chat transcript to disk so it survives
// navigating away (Closet/Profile tabs) and app restarts — without this,
// `messages` lived in StylistScreen's own useState and reset every time the
// tab remounted.
export const useChatStore = create(
  persist(
    (set) => ({
      messages: [WELCOME_MESSAGE],
      // Set by the Planner's "Ask AI Stylist" step right before switching
      // tabs — StylistScreen picks this up on mount/focus, sends it as if
      // the client had typed and submitted it themselves, then clears it so
      // it can't re-fire on a later visit to the tab.
      pendingPrompt: null,

      // Freemium chat cap — every real client-typed/quick-prompt send counts
      // once, forever, regardless of `clearMessages()` (that resets the
      // visible transcript, not usage — otherwise a client could just clear
      // the chat to reset their free limit, which would make the cap
      // meaningless). Counted here, inside the one write path every message
      // already goes through, rather than as a separate action StylistScreen
      // would have to remember to call alongside every send.
      freeMessagesUsed: 0,

      addMessage: (message) =>
        set((state) => ({
          messages: [...state.messages, message],
          freeMessagesUsed:
            message.sender === 'user' && !message.hidden
              ? state.freeMessagesUsed + 1
              : state.freeMessagesUsed,
        })),
      updateMessage: (id, patch) =>
        set((state) => ({
          messages: state.messages.map((message) => (message.id === id ? { ...message, ...patch } : message)),
        })),
      clearMessages: () => set({ messages: [WELCOME_MESSAGE] }),
      setPendingPrompt: (prompt) => set({ pendingPrompt: prompt }),
      clearPendingPrompt: () => set({ pendingPrompt: null }),

      // Strips any earlier *unresolved* profileStaleConfirm bubble before
      // appending the new one, in the same `set()` call. Reads current store
      // state (not a render-time closure), so it's safe to call more than
      // once in a row — e.g. React 18 Strict Mode double-invoking the effect
      // that calls this — without ever leaving two "confirm profile update?"
      // prompts stacked in the transcript.
      upsertProfileStalePrompt: (text) =>
        set((state) => ({
          messages: [
            ...state.messages.filter((m) => !(m.type === 'profileStaleConfirm' && !m.resolution)),
            {
              id: `${Date.now()}-profile-stale`,
              sender: 'ai',
              type: 'profileStaleConfirm',
              text,
              outfitIds: [],
              newItems: [],
            },
          ],
        })),
    }),
    {
      name: 'chat-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // `pendingPrompt` is a one-shot handoff to StylistScreen, not
      // transcript history — excluding it from persistence means a prompt
      // can never get "stuck" and replay on a later, unrelated app launch.
      // `freeMessagesUsed` DOES persist — it's the whole point of an
      // account-level cap that survives an app restart.
      partialize: (state) => ({ messages: state.messages, freeMessagesUsed: state.freeMessagesUsed }),
    }
  )
);

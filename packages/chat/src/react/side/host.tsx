import { useContext, createContext } from 'react';
import type { Context, ReactNode, ComponentType } from 'react';
import type { TConversation } from 'librechat-data-provider';
import type { FollowedChat, FollowChatOptions } from '../follow';
import type { ChatContract } from '../chat/contract';

/** What a host's composer for a side chat is given. */
export type SideChatSurfaceProps = {
  /** The conversation's chat contract: what main chat's composer reads from its own pane. */
  contract: ChatContract;
  /** Whether the conversation is in and its pane holds it, so a turn can be built for it. */
  ready: boolean;
  /**
   * Words the reader wrote for this conversation before it opened. They are sent once, as its
   * next turn, when it can take them, and left in the field when it cannot.
   */
  handedText?: string;
  onHandedTextTaken: () => void;
  /**
   * The words of a turn stopped before the server kept anything of it, to go back in the field
   * unless the reader has written something since.
   */
  returnedText?: string;
  onReturnedTextTaken: () => void;
  /**
   * Gives the panel a way to read the words not sent yet, for when the conversation moves to
   * the page's main chat and nothing else would carry them there; `null` takes it away. A
   * composer that keeps a conversation's draft where main chat's finds it gives none.
   */
  onUnsentWords: (read: (() => string) | null) => void;
  /** Whether the deployment draws a footer bar the composer has to clear. */
  clearsFooter: boolean;
  /** Whether the field takes focus once the conversation is in; not as a modal sheet. */
  focusWhenReady: boolean;
  /** The conversation's message list, which the surface draws above its composer. */
  children: ReactNode;
};

/**
 * What a side chat reads from the app. Members named `use*` are hooks, called unconditionally,
 * and a host stays the same object for the life of the tree it wraps.
 */
export interface SideChatHost {
  /**
   * The conversation as a chat the reader drives: its stored messages, the generation running
   * under it, and a transport that can start and stop one on the conversation's endpoint.
   */
  useChat: (
    conversation: Pick<TConversation, 'conversationId' | 'endpoint'>,
    options?: Pick<FollowChatOptions, 'onWithdrawn'>,
  ) => FollowedChat;
  /** Opens the conversation as the page's main one. */
  useOpenConversation: () => (conversation: TConversation) => void;
  /** Whether the panel is a modal sheet over the chat rather than a region beside it. */
  useSheetLayout: () => boolean;
  /** Whether the deployment draws a footer bar the panel's composer has to clear. */
  useClearsFooter: () => boolean;
  /**
   * The app's own composer for the conversation, around its message list: main chat's form,
   * with what that form needs around it, reading the contract it is given. A host without one
   * gets the panel's plain field, which sends text and stops a reply.
   */
  Surface?: ComponentType<SideChatSurfaceProps>;
}

const SideChatHostContext: Context<SideChatHost | null> = createContext<SideChatHost | null>(null);

/** Supplies the host a side chat reads from. */
export function SideChatHostProvider({
  host,
  children,
}: {
  host: SideChatHost;
  children?: ReactNode;
}): ReactNode {
  return <SideChatHostContext.Provider value={host}>{children}</SideChatHostContext.Provider>;
}

export function useSideChatHost(): SideChatHost {
  const host = useContext(SideChatHostContext);
  if (host == null) {
    throw new Error('A side chat needs a SideChatHostProvider above it.');
  }
  return host;
}

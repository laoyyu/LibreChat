import { useCallback, useMemo } from 'react';
import { useFollowChat } from '@librechat/chat/react';
import { useQueryClient } from '@tanstack/react-query';
import { createGenerationTransport } from '@librechat/chat';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { FollowedChat, SideChatHost, FollowChatOptions } from '@librechat/chat/react';
import type { TMessage, TConversation, ChatFinalFrame } from 'librechat-data-provider';
import { isTemporaryConversation, proveFetchedReplyByIdentity } from '~/utils';
import useNavigateToConvo from '~/hooks/Conversations/useNavigateToConvo';
import useAttachmentHandler from '~/hooks/SSE/useAttachmentHandler';
import { ARTIFACTS_SHEET_MAX_WIDTH } from '~/utils/breakpoints';
import { createConversationCache } from '~/hooks/SSE/services';
import { useConfiguredFooter } from '~/components/Chat/Footer';
import useScaledMaxWidth from '~/hooks/useScaledMaxWidth';
import { useChatTransport } from './ChatTransportContext';
import { useChatSettings } from './ChatSettingsContext';
import { fetchStreamStatus } from '~/data-provider';

/**
 * A conversation of the reader's own as a chat they drive: its messages through the ordinary
 * route, and its generations started, streamed and stopped over the transport main chat uses.
 */
function useChat(
  { conversationId, endpoint }: Pick<TConversation, 'conversationId' | 'endpoint'>,
  options?: Pick<FollowChatOptions, 'onWithdrawn'>,
): FollowedChat {
  const id = conversationId ?? '';
  const { token } = useChatSettings().auth;
  const transport = useChatTransport();
  const generation = useMemo(
    () =>
      createGenerationTransport({
        wire: () => transport.stream({ token }),
        getStatus: fetchStreamStatus,
        start: (request, options) => transport.start(request, options),
        abort: ({ chatId, streamId, generationCreatedAt }) =>
          transport.abort({ conversationId: chatId, streamId, generationCreatedAt }),
      }),
    [transport, token],
  );
  const loadMessages = useCallback(() => dataService.getMessagesByConvoId(id), [id]);
  /**
   * What a tool hands back while it runs (search sources, a generated file) arrives beside the
   * message it belongs to. It goes where main chat's goes: onto the rows that show it, and into
   * the app's file, memory and preview caches.
   */
  const queryClient = useQueryClient();
  const onAttachment = useAttachmentHandler(queryClient);
  /**
   * What lets a reply read here be acknowledged, as main chat's is: the reply a turn just ended
   * on is stamped on the conversation wherever it is listed, paired with the list that holds
   * it; and the history just read stands as proof of the reply the conversation already names.
   */
  const onSettled = useCallback(
    (final?: ChatFinalFrame) => {
      if (final == null) {
        const messages = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, id]);
        if (messages != null) {
          proveFetchedReplyByIdentity(queryClient, id, messages);
        }
        return;
      }
      const settled = final.conversation as Partial<TConversation> | undefined;
      if (settled?.lastResponseAt == null || isTemporaryConversation(settled)) {
        return;
      }
      createConversationCache(queryClient).commitReply(id, {
        lastResponseAt: settled.lastResponseAt,
        lastResponseMessageId: settled.lastResponseMessageId,
        updatedAt: settled.updatedAt,
      });
    },
    [queryClient, id],
  );
  const beside = useMemo(() => ({ onAttachment, onSettled }), [onAttachment, onSettled]);
  return useFollowChat({
    id,
    transport: generation,
    loadMessages,
    endpoint,
    enabled: id !== '',
    beside,
    onWithdrawn: options?.onWithdrawn,
  });
}

function useOpenConversation(): (conversation: TConversation) => void {
  const { navigateToConvo } = useNavigateToConvo();
  return useCallback((conversation) => navigateToConvo(conversation), [navigateToConvo]);
}

/** What a side chat reads from the app. */
export const appSideChatHost: SideChatHost = {
  useChat,
  useOpenConversation,
  useSheetLayout: () => useScaledMaxWidth(ARTIFACTS_SHEET_MAX_WIDTH),
  useClearsFooter: useConfiguredFooter,
};

import { useRef, useMemo, useEffect } from 'react';
import { useRecoilValue } from 'recoil';
import { useForm } from 'react-hook-form';
import { ChatContext, ComposerRestoreProvider } from '@librechat/chat/react';
import type { SideChatSurfaceProps } from '@librechat/chat/react';
import type { AddedChatContract } from '~/hooks/Chat/contract';
import type { ChatFormValues } from '~/common';
import DragDropWrapper from '~/components/Chat/Input/Files/DragDropWrapper';
import { AddedChatContext, ChatFormProvider } from '~/Providers';
import { TargetContext } from '~/Providers/TargetContext';
import ChatForm from '~/components/Chat/Input/ChatForm';
import useTarget from '~/hooks/Chat/target';
import store from '~/store';

/** A conversation beside the chat is compared with no other model. */
const alone: AddedChatContract = {
  conversation: null,
  setConversation: () => undefined,
  generateConversation: () => {
    throw new Error('A side chat holds one conversation');
  },
};

/**
 * Main chat's composer for a conversation open beside it: the same form, reading that
 * conversation's chat contract, under the providers `ChatView` puts around its own. Each is
 * this conversation's alone: its form state, its target, its place for words handed back, and
 * its drop target, so a file dropped on the panel is this conversation's and not main chat's.
 */
export default function SideChatSurface({
  contract,
  ready,
  handedText,
  onHandedTextTaken,
  returnedText,
  onReturnedTextTaken,
  clearsFooter,
  focusWhenReady,
  children,
}: SideChatSurfaceProps) {
  const methods = useForm<ChatFormValues>({ defaultValues: { text: '' } });
  const enterToSend = useRecoilValue(store.enterToSend);
  const autoSendText = useRecoilValue(store.autoSendText);
  const speechSettingsInitialized = useRecoilValue(store.speechSettingsInitialized);
  const { ask, conversation, setConversation } = contract;
  const target = useTarget(conversation, setConversation);
  const readiness = useMemo(
    () => ({
      ready: target.ready,
      pending: target.pending,
      failed: target.failed,
      retry: target.retry,
    }),
    [target.ready, target.pending, target.failed, target.retry],
  );
  const sendable = ready && target.ready;
  const conversationId = conversation?.conversationId ?? '';

  /** Sent once, when the conversation can take them; left in the field when it cannot. */
  const handed = useRef<string>();
  useEffect(() => {
    if (!sendable || handedText == null || handedText === '' || handed.current === conversationId) {
      return;
    }
    handed.current = conversationId;
    if (ask({ text: handedText }) === false) {
      methods.setValue('text', handedText, { shouldValidate: true });
    }
    onHandedTextTaken();
  }, [ask, conversationId, handedText, methods, onHandedTextTaken, sendable]);

  /** A turn the server never kept gives its words back, unless something was written since. */
  useEffect(() => {
    if (returnedText == null) {
      return;
    }
    if (methods.getValues('text').trim() === '') {
      methods.setValue('text', returnedText, { shouldValidate: true });
    }
    onReturnedTextTaken();
  }, [methods, onReturnedTextTaken, returnedText]);

  const form = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (!ready || !focusWhenReady || focused.current) {
      return;
    }
    const field = form.current?.querySelector('textarea');
    if (field == null) {
      return;
    }
    focused.current = true;
    field.focus({ preventScroll: true });
  }, [focusWhenReady, ready, conversation?.endpoint]);

  return (
    <ChatContext.Provider value={contract}>
      <TargetContext.Provider value={readiness}>
        <ChatFormProvider {...methods}>
          <ComposerRestoreProvider>
            <AddedChatContext.Provider value={alone}>
              <DragDropWrapper className="min-h-0 flex-1 flex-col">
                {children}
                <div ref={form} className="shrink-0">
                  <ChatForm
                    index={contract.index}
                    routePending={!ready}
                    isLandingPage={false}
                    enterToSend={enterToSend}
                    autoSendText={autoSendText}
                    speechSettingsInitialized={speechSettingsInitialized}
                    footerBelow={clearsFooter}
                    centerFormOnLanding={false}
                  />
                </div>
              </DragDropWrapper>
            </AddedChatContext.Provider>
          </ComposerRestoreProvider>
        </ChatFormProvider>
      </TargetContext.Provider>
    </ChatContext.Provider>
  );
}

import React from 'react';
import { RecoilRoot } from 'recoil';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryKeys, EModelEndpoint } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  TFile,
  TMessage,
  ChatEvent,
  ChatStreamRequest,
  ChatTransportOptions,
} from 'librechat-data-provider';
import type { Transport } from '~/hooks/Chat/contract';
import { findConvoInAllQueries, hasServerFetchedReply, hasLocallyCommittedReply } from '~/utils';
import { ChatTransportContext, defaultChatTransport } from '../ChatTransportContext';
import AnnouncerContext from '../AnnouncerContext';

const mockMessages = jest.fn();
jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      getMessagesByConvoId: (...args: unknown[]) => mockMessages(...args),
    },
  };
});

const mockStreamStatus = jest.fn();
jest.mock('~/data-provider/SSE/queries', () => ({
  ...jest.requireActual('~/data-provider/SSE/queries'),
  fetchStreamStatus: (...args: unknown[]) => mockStreamStatus(...args),
}));

const { appSideChatHost } = jest.requireActual('~/Providers/SideChatHostContext');

const conversation = { conversationId: 'side-conversation', endpoint: EModelEndpoint.agents };

const asked: TMessage = {
  messageId: 'user-1',
  conversationId: 'side-conversation',
  parentMessageId: '00000000-0000-0000-0000-000000000000',
  isCreatedByUser: true,
  text: 'Make a chart.',
} as TMessage;

/** The app's transport with a wire the test drives, and a start and stop it can see. */
function createTransport() {
  const attachments: Array<{ request: ChatStreamRequest; options: ChatTransportOptions }> = [];
  const start = jest.fn();
  const abort = jest.fn(async () => ({ success: true }));
  const transport: Transport = {
    ...defaultChatTransport,
    stream: () => ({
      send: () => undefined,
      reconnectToStream(request, options) {
        attachments.push({ request, options });
        return { closed: false };
      },
    }),
    start,
    abort,
  };
  return { transport, attachments, start, abort };
}

const answered: TMessage = {
  messageId: 'response-1',
  conversationId: 'side-conversation',
  parentMessageId: 'user-1',
  isCreatedByUser: false,
  text: 'Here it is.',
} as TMessage;

/** The conversation as the sidebar lists it: the reply it names, which the reader has not seen. */
const list = (client: QueryClient, lastResponseAt: string) =>
  client.setQueryData([QueryKeys.allConversations, { isArchived: false }], {
    pages: [
      {
        conversations: [
          {
            conversationId: 'side-conversation',
            title: 'Chart',
            lastResponseAt,
            lastResponseMessageId: 'response-1',
          },
        ],
        nextCursor: null,
      },
    ],
    pageParams: [null],
  });

const setup = (seed?: (client: QueryClient) => void) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed?.(client);
  const harness = createTransport();
  const announcePolite = jest.fn();
  const announcer = { announcePolite, announceAssertive: announcePolite };
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <RecoilRoot>
      <QueryClientProvider client={client}>
        <AnnouncerContext.Provider value={announcer}>
          <ChatTransportContext.Provider value={harness.transport}>
            {children}
          </ChatTransportContext.Provider>
        </AnnouncerContext.Provider>
      </QueryClientProvider>
    </RecoilRoot>
  );
  const view = renderHook(() => appSideChatHost.useChat(conversation), { wrapper });
  return { ...view, ...harness, client, announcePolite };
};

describe("the app's side chat host", () => {
  beforeEach(() => {
    mockMessages.mockReset();
    mockStreamStatus.mockReset();
  });

  it('reads the conversation through the ordinary messages route, as a list', async () => {
    mockStreamStatus.mockResolvedValue({ active: false });
    mockMessages.mockResolvedValue([asked]);

    const { result } = setup();

    await waitFor(() => expect(result.current.messages).toEqual([asked]));
    expect(mockMessages).toHaveBeenCalledWith('side-conversation');
    expect(result.current.hasEarlier).toBe(false);
  });

  it('puts what a tool hands back while it runs into the app, as main chat does', async () => {
    mockStreamStatus.mockResolvedValue({
      active: true,
      streamId: 'side-conversation',
      createdAt: 2000,
      generationProtocolVersion: 2,
    });
    mockMessages.mockResolvedValue([asked]);
    const { attachments, client } = setup();
    await waitFor(() => expect(attachments).toHaveLength(1));
    const emit = (event: ChatEvent) => act(() => attachments[0].options.onEvent(event));

    emit({ type: 'open' });
    emit({
      type: 'created',
      data: { created: true, message: asked, turn: { responseMessageId: 'response-1' } },
    } as ChatEvent);
    emit({
      type: 'attachment',
      data: {
        file_id: 'file-1',
        filename: 'chart.png',
        filepath: '/images/user/chart.png',
        type: 'image/png',
        messageId: 'response-1',
        toolCallId: 'call-1',
        conversationId: 'side-conversation',
      },
    } as unknown as ChatEvent);

    /** The app's own file list learns of it, which only the app's handler does. */
    await waitFor(() =>
      expect(client.getQueryData<TFile[]>([QueryKeys.files])).toEqual([
        expect.objectContaining({ file_id: 'file-1', filename: 'chart.png' }),
      ]),
    );
  });

  it('stands the history it read as proof of the reply the conversation names', async () => {
    const repliedAt = '2026-11-18T10:00:00.000Z';
    mockStreamStatus.mockResolvedValue({ active: false });
    mockMessages.mockResolvedValue([asked, answered]);

    const { result, client } = setup((seeded) => list(seeded, repliedAt));
    await waitFor(() => expect(result.current.messages).toEqual([asked, answered]));

    /** What reading the reply on screen needs before it can be acknowledged. */
    expect(hasServerFetchedReply(client, 'side-conversation', repliedAt)).toBe(true);
  });

  it('does not take a history without the reply as proof of it', async () => {
    const repliedAt = '2026-11-18T10:00:00.000Z';
    mockStreamStatus.mockResolvedValue({ active: false });
    mockMessages.mockResolvedValue([asked]);

    const { result, client } = setup((seeded) => list(seeded, repliedAt));
    await waitFor(() => expect(result.current.messages).toEqual([asked]));

    expect(hasServerFetchedReply(client, 'side-conversation', repliedAt)).toBe(false);
  });

  it('stamps the conversation with the reply a generation ended on, paired with the list that holds it', async () => {
    const before = '2026-11-18T10:00:00.000Z';
    const repliedAt = '2026-11-18T10:05:00.000Z';
    mockStreamStatus.mockResolvedValue({
      active: true,
      streamId: 'side-conversation',
      createdAt: 2000,
      generationProtocolVersion: 2,
    });
    mockMessages.mockResolvedValue([asked]);
    const { result, attachments, client } = setup((seeded) => list(seeded, before));
    await waitFor(() => expect(attachments).toHaveLength(1));
    const emit = (event: ChatEvent) => act(() => attachments[0].options.onEvent(event));

    emit({ type: 'open' });
    emit({
      type: 'created',
      data: { created: true, message: asked, turn: { responseMessageId: 'response-1' } },
    } as ChatEvent);
    mockStreamStatus.mockResolvedValue({ active: false });
    mockMessages.mockResolvedValue([asked, answered]);
    emit({
      type: 'final',
      data: {
        final: true,
        conversation: {
          conversationId: 'side-conversation',
          lastResponseAt: repliedAt,
          lastResponseMessageId: 'response-1',
          updatedAt: repliedAt,
        },
        requestMessage: asked,
        responseMessage: answered,
      },
    } as ChatEvent);
    await waitFor(() => expect(result.current.messages).toEqual([asked, answered]));

    /** The sidebar's entry carries the new reply, and the list on screen is known to hold it. */
    await waitFor(() =>
      expect(findConvoInAllQueries(client, 'side-conversation')).toMatchObject({
        lastResponseAt: repliedAt,
        lastResponseMessageId: 'response-1',
      }),
    );
    expect(hasLocallyCommittedReply(client, 'side-conversation', repliedAt)).toBe(true);
  });

  it("says a turn through the app's announcer, as main chat's is said", async () => {
    mockStreamStatus.mockResolvedValue({
      active: true,
      streamId: 'side-conversation',
      createdAt: 2000,
      generationProtocolVersion: 2,
    });
    mockMessages.mockResolvedValue([asked]);
    const { attachments, announcePolite } = setup();
    await waitFor(() => expect(attachments).toHaveLength(1));
    const emit = (event: ChatEvent) => act(() => attachments[0].options.onEvent(event));

    emit({ type: 'open' });
    emit({
      type: 'created',
      data: { created: true, message: asked, turn: { responseMessageId: 'response-1' } },
    } as ChatEvent);
    await waitFor(() =>
      expect(announcePolite).toHaveBeenCalledWith({ message: 'start', isStatus: true }),
    );

    mockStreamStatus.mockResolvedValue({ active: false });
    emit({
      type: 'final',
      data: {
        final: true,
        conversation: { conversationId: 'side-conversation' },
        requestMessage: asked,
        responseMessage: answered,
      },
    } as ChatEvent);
    await waitFor(() =>
      expect(announcePolite).toHaveBeenLastCalledWith({ message: 'Here it is.' }),
    );
    expect(announcePolite).toHaveBeenCalledWith({ message: 'end', isStatus: true });
  });

  it('stops a generation through the app, by its conversation and the stream it names', async () => {
    mockStreamStatus.mockResolvedValue({
      active: true,
      streamId: 'side-conversation',
      createdAt: 2000,
      generationProtocolVersion: 2,
    });
    mockMessages.mockResolvedValue([asked]);
    const { result, attachments, abort } = setup();
    await waitFor(() => expect(attachments).toHaveLength(1));
    act(() => attachments[0].options.onEvent({ type: 'open' }));
    act(() =>
      attachments[0].options.onEvent({
        type: 'created',
        data: { created: true, message: asked, turn: { responseMessageId: 'response-1' } },
      } as ChatEvent),
    );
    await waitFor(() => expect(result.current.status).not.toBe('ready'));

    act(() => {
      void result.current.stop().catch(() => undefined);
    });

    await waitFor(() => expect(abort).toHaveBeenCalledTimes(1));
    expect(abort).toHaveBeenCalledWith({
      conversationId: 'side-conversation',
      streamId: 'side-conversation',
      generationCreatedAt: 2000,
    });
  });
});

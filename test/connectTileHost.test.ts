import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectTileHost } from '../src/index';

// Wire literals duplicated here on purpose: they aren't exported, and a real
// tile implementation wouldn't import them either — it duplicates them too.
const hostReadyMessage = 'investifi:host-ready';
const tileListeningMessage = 'investifi:tile-listening';
const tileReadyMessage = 'investifi:tile-ready';
const tileLaunchMessage = 'investifi:launch';

const tileOrigin = 'https://tile.example';

function createFakeIframe() {
  const postMessage = vi.fn();
  const contentWindow = { postMessage } as unknown as Window;
  const iframe = Object.assign(new EventTarget(), { contentWindow }) as unknown as HTMLIFrameElement;
  return { iframe, contentWindow, postMessage };
}

function postFromTile(contentWindow: Window, type: string, origin = tileOrigin) {
  window.dispatchEvent(new MessageEvent('message', { data: { type }, origin, source: contentWindow as unknown as Window }));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('connectTileHost announce budget', () => {
  it('announces on an interval up to the attempt budget, then goes quiet', () => {
    const { iframe, postMessage } = createFakeIframe();
    const onEvent = vi.fn();

    connectTileHost({ iframe, tileOrigin, onLaunch: vi.fn(), announceIntervalMs: 100, announceAttempts: 3, onEvent });

    // Synchronous first attempt on connect.
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenLastCalledWith({ type: hostReadyMessage }, tileOrigin);
    expect(onEvent).toHaveBeenLastCalledWith({ kind: 'announce', attempt: 1, attemptsAllowed: 3 });

    vi.advanceTimersByTime(100);
    expect(postMessage).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(100);
    expect(postMessage).toHaveBeenCalledTimes(3);

    // Budget exhausted: no further announces, but still subscribed.
    vi.advanceTimersByTime(100);
    expect(postMessage).toHaveBeenCalledTimes(3);
    expect(onEvent).toHaveBeenLastCalledWith({ kind: 'announceExhausted', attemptsAllowed: 3 });

    vi.advanceTimersByTime(1000);
    expect(postMessage).toHaveBeenCalledTimes(3);
  });
});

describe('connectTileHost message guards', () => {
  it('ignores foreign-window traffic, reporting it only when it wears the contract\'s clothes', () => {
    const { iframe } = createFakeIframe();
    const onEvent = vi.fn();
    connectTileHost({ iframe, tileOrigin, onLaunch: vi.fn(), onEvent });
    onEvent.mockClear();

    const foreignWindow = {} as unknown as Window;
    postFromTile(foreignWindow, tileReadyMessage);
    expect(onEvent).toHaveBeenCalledWith({ kind: 'ignored', reason: 'foreignSource', type: tileReadyMessage, origin: tileOrigin });

    onEvent.mockClear();
    postFromTile(foreignWindow, 'some-extension-message');
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('reports the right window posting from the wrong origin', () => {
    const { iframe, contentWindow } = createFakeIframe();
    const onEvent = vi.fn();
    connectTileHost({ iframe, tileOrigin, onLaunch: vi.fn(), onEvent });
    onEvent.mockClear();

    postFromTile(contentWindow, tileReadyMessage, 'https://evil.example');
    expect(onEvent).toHaveBeenCalledWith({
      kind: 'ignored',
      reason: 'foreignOrigin',
      type: tileReadyMessage,
      origin: 'https://evil.example',
    });
  });

  it('reports an unrecognized message type from the right window and origin', () => {
    const { iframe, contentWindow } = createFakeIframe();
    const onEvent = vi.fn();
    connectTileHost({ iframe, tileOrigin, onLaunch: vi.fn(), onEvent });
    onEvent.mockClear();

    postFromTile(contentWindow, 'investifi:something-else');
    expect(onEvent).toHaveBeenCalledWith({
      kind: 'ignored',
      reason: 'unknownType',
      type: 'investifi:something-else',
      origin: tileOrigin,
    });
  });
});

describe('connectTileHost handshake transitions', () => {
  it('stops announcing on ack, idempotently', () => {
    const { iframe, postMessage, contentWindow } = createFakeIframe();
    const onEvent = vi.fn();
    connectTileHost({ iframe, tileOrigin, onLaunch: vi.fn(), announceIntervalMs: 100, announceAttempts: 5, onEvent });

    postFromTile(contentWindow, tileReadyMessage);
    const callsAfterAck = postMessage.mock.calls.length;

    vi.advanceTimersByTime(1000);
    expect(postMessage).toHaveBeenCalledTimes(callsAfterAck);

    // A second ack must not throw or restart anything.
    expect(() => postFromTile(contentWindow, tileReadyMessage)).not.toThrow();
    vi.advanceTimersByTime(1000);
    expect(postMessage).toHaveBeenCalledTimes(callsAfterAck);
  });

  it('restarts announcing on tileListeningMessage from any state, including after exhaustion', () => {
    const { iframe, postMessage, contentWindow } = createFakeIframe();
    const onEvent = vi.fn();
    connectTileHost({ iframe, tileOrigin, onLaunch: vi.fn(), announceIntervalMs: 100, announceAttempts: 1, onEvent });

    vi.advanceTimersByTime(100);
    expect(onEvent).toHaveBeenLastCalledWith({ kind: 'announceExhausted', attemptsAllowed: 1 });
    const callsBeforeRevive = postMessage.mock.calls.length;

    postFromTile(contentWindow, tileListeningMessage);
    expect(postMessage).toHaveBeenCalledTimes(callsBeforeRevive + 1);
    expect(onEvent).toHaveBeenLastCalledWith({ kind: 'announce', attempt: 1, attemptsAllowed: 1 });
  });

  it('invokes onLaunch on the launch message', () => {
    const { iframe, contentWindow } = createFakeIframe();
    const onLaunch = vi.fn();
    connectTileHost({ iframe, tileOrigin, onLaunch });

    postFromTile(contentWindow, tileLaunchMessage);
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });

  it('restarts announcing on iframe load', () => {
    const { iframe, postMessage } = createFakeIframe();
    const onEvent = vi.fn();
    connectTileHost({ iframe, tileOrigin, onLaunch: vi.fn(), onEvent });
    const callsBeforeLoad = postMessage.mock.calls.length;

    iframe.dispatchEvent(new Event('load'));

    expect(onEvent).toHaveBeenCalledWith({ kind: 'frameLoad' });
    expect(postMessage).toHaveBeenCalledTimes(callsBeforeLoad + 1);
  });
});

describe('connectTileHost teardown', () => {
  it('disconnect stops the timer and removes listeners', () => {
    const { iframe, postMessage, contentWindow } = createFakeIframe();
    const onEvent = vi.fn();
    const { disconnect } = connectTileHost({
      iframe,
      tileOrigin,
      onLaunch: vi.fn(),
      announceIntervalMs: 100,
      announceAttempts: 5,
      onEvent,
    });

    const callsBeforeDisconnect = postMessage.mock.calls.length;
    disconnect();
    onEvent.mockClear();

    vi.advanceTimersByTime(1000);
    expect(postMessage).toHaveBeenCalledTimes(callsBeforeDisconnect);
    expect(onEvent).not.toHaveBeenCalled();

    postFromTile(contentWindow, tileReadyMessage);
    iframe.dispatchEvent(new Event('load'));
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('reannounce restarts with a fresh budget', () => {
    const { iframe, postMessage } = createFakeIframe();
    const onEvent = vi.fn();
    const { reannounce } = connectTileHost({
      iframe,
      tileOrigin,
      onLaunch: vi.fn(),
      announceIntervalMs: 100,
      announceAttempts: 5,
      onEvent,
    });

    vi.advanceTimersByTime(300); // consume a few attempts
    const callsBeforeReannounce = postMessage.mock.calls.length;

    reannounce();
    expect(postMessage).toHaveBeenCalledTimes(callsBeforeReannounce + 1);
    expect(onEvent).toHaveBeenLastCalledWith({ kind: 'announce', attempt: 1, attemptsAllowed: 5 });
  });
});

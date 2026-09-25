/**
 * Host side of the InvestiFi tile `postMessage` contract.
 *
 * The host speaks first: it builds the iframe `src`, so it is the only side that
 * knows the other's origin. It announces on a repeating budget until the tile
 * acks, and keeps listening forever — a tile that hydrates late (cold login,
 * an SSO redirect, a long main-thread task) re-opens the handshake by posting
 * `tileListeningMessage`, and a host that ignores that message silently renders a
 * card whose button does nothing.
 */

const hostReadyMessage = 'investifi:host-ready';
const tileListeningMessage = 'investifi:tile-listening';
const tileReadyMessage = 'investifi:tile-ready';
const tileLaunchMessage = 'investifi:launch';

/** Message source for hosts that share a message channel. */
const tileMessageSource = 'eux-tile';

const defaultAnnounceIntervalMs = 250;
const defaultAnnounceAttempts = 20;

/** Why a message that reached the listener was dropped without being acted on. */
type IgnoredReason = 'foreignSource' | 'foreignOrigin' | 'unknownType';

/**
 * Everything the connector does, reported for observability. Pass an onEvent 
 * handler for your own telemetry or logging.
 */
type TileHostEvent =
  | { kind: 'announce'; attempt: number; attemptsAllowed: number }
  | { kind: 'announceExhausted'; attemptsAllowed: number }
  | { kind: 'frameLoad' }
  | { kind: 'accepted'; type: string; origin: string; source: unknown }
  | { kind: 'ignored'; reason: IgnoredReason; type: unknown; origin: string };

interface ConnectTileHostOptions {
  iframe: HTMLIFrameElement;
  /** Origin of the tile's `src`. Every outbound message targets it explicitly, never `*`. */
  tileOrigin: string;
  onLaunch: () => void;
  announceIntervalMs?: number;
  announceAttempts?: number;
  onEvent?: (event: TileHostEvent) => void;
}

/**
 * Frames the handshake for one iframe and returns a teardown. Safe to call again
 * after `disconnect` — a host that rebuilds the iframe on config changes can
 * simply reconnect against the new element.
 */
export const connectTileHost = ({
  iframe,
  tileOrigin,
  onLaunch,
  announceIntervalMs = defaultAnnounceIntervalMs,
  announceAttempts = defaultAnnounceAttempts,
  onEvent = () => {},
}: ConnectTileHostOptions) => {
  let timer: number | null = null;
  let attempts = 0;

  const stopAnnouncing = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  const announce = () => {
    if (attempts >= announceAttempts) {
      // Go quiet, but stay subscribed: `tileListeningMessage` can still revive us.
      stopAnnouncing();
      onEvent({ kind: 'announceExhausted', attemptsAllowed: announceAttempts });
      return;
    }

    attempts += 1;
    iframe.contentWindow?.postMessage({ type: hostReadyMessage }, tileOrigin);
    onEvent({ kind: 'announce', attempt: attempts, attemptsAllowed: announceAttempts });
    timer = window.setTimeout(announce, announceIntervalMs);
  };

  const startAnnouncing = () => {
    stopAnnouncing();
    attempts = 0;
    announce();
  };

  const onMessage = (event: MessageEvent) => {
    const type: unknown = event.data?.type;
    const isContractType = type === tileListeningMessage || type === tileReadyMessage || type === tileLaunchMessage;

    // All three checks must pass before we act. What varies is how loudly each
    // rejection is reported: a dashboard is a shared channel, and browser
    // extensions, devtools bridges and other widgets all post here. Reporting
    // every one of them buries the rejections that actually mean something.
    if (event.source !== iframe.contentWindow) {
      // Someone else's traffic. Only worth a line if it wears our contract's
      // clothes, which would mean a message is reaching us from the wrong window.
      if (isContractType) {
        onEvent({ kind: 'ignored', reason: 'foreignSource', type, origin: event.origin });
      }
      return;
    }

    // Past here it is the framed window talking, so everything it says is worth
    // seeing — including near-misses, which the contract ignores silently.
    if (event.origin !== tileOrigin) {
      onEvent({ kind: 'ignored', reason: 'foreignOrigin', type, origin: event.origin });
      return;
    }

    if (!isContractType) {
      onEvent({ kind: 'ignored', reason: 'unknownType', type, origin: event.origin });
      return;
    }

    onEvent({ kind: 'accepted', type, origin: event.origin, source: event.data?.source });

    switch (type) {
      case tileListeningMessage:
        // The tile mounted, possibly after our budget ran out or after an in-frame
        // navigation. No budget on this path: always restart, from any state.
        startAnnouncing();
        break;

      case tileReadyMessage:
        // Acked every announce, not just the first, so this has to be idempotent.
        stopAnnouncing();
        break;

      case tileLaunchMessage:
        onLaunch();
        break;
    }
  };

  const onFrameLoad = () => {
    onEvent({ kind: 'frameLoad' });
    startAnnouncing();
  };

  // Attached synchronously, so nothing the tile sends can be missed.
  window.addEventListener('message', onMessage);
  iframe.addEventListener('load', onFrameLoad);
  startAnnouncing(); // In case the frame already loaded.

  return {
    /** Re-announce with a fresh budget. */
    reannounce: startAnnouncing,
    disconnect: () => {
      stopAnnouncing();
      window.removeEventListener('message', onMessage);
      iframe.removeEventListener('load', onFrameLoad);
    },
  };
};

# InvestiFi Tile Bridge

[![npm version](https://img.shields.io/npm/v/%40investifi%2Ftile-bridge)](https://www.npmjs.com/package/@investifi/tile-bridge)
[![CI](https://github.com/CryptoFi-LLC/investifi-tile-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/CryptoFi-LLC/investifi-tile-bridge/actions/workflows/ci.yml)

Host side of the InvestiFi tile `postMessage` contract.

## Install

```sh
npm install @investifi/tile-bridge
```

## Usage

### Step 1: Frame the tile

Set the iframe `src` to the financial institution's corresponding `/tile` URL:

```html
<iframe
  id="investifi-tile"
  src="https://investifi.example-fi.com/tile"
  height="560"
  style="width: 100%; border: 0;"
></iframe>
```

If you sandbox the frame, you must include `allow-same-origin`.

For example, use `sandbox="allow-scripts allow-same-origin"`, never `allow-scripts` alone.

### Step 2: Add the script to your page

Call `connectTileHost` with your iframe element, the tile's origin, and a callback for when the user presses the tile's button.

Pass an optional `onEvent` handler if you want visibility into the handshake for your own telemetry or logging.

```ts
import { connectTileHost } from '@investifi/tile-bridge';

const iframe = document.querySelector('iframe')!;

const { disconnect } = connectTileHost({
  iframe,
  tileOrigin: 'https://investifi.example-fi.com',
  onLaunch,
  onEvent, // optional
});

// Later, e.g. when the host component unmounts:
disconnect();
```

### Step 3: Resolve the launch

The onLaunch handler carries no destination and allows you to resolve the intended behavior, such as launching the InvestiFi experience in a new browser tab, or in the current tab.

```ts
function onLaunch() {
  window.location.assign('https://investifi.example-fi.com');
}
```

## connectTileHost API

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `iframe` | `HTMLIFrameElement` | yes | The iframe hosting the tile. |
| `tileOrigin` | `string` | yes | Origin of the tile's `src`. Every outbound message targets this explicitly. |
| `onLaunch` | `() => void` | yes | Called when the tile posts `investifi:launch`. |
| `announceIntervalMs` | `number` | no | Delay between announce attempts. Default `250`. |
| `announceAttempts` | `number` | no | Max announce attempts before going quiet (the connector stays subscribed and can still be revived). Default `20`. |
| `onEvent` | `(event: TileHostEvent) => void` | no | Observability hook that announces, frame loads, accepted messages, and ignored messages. |

Returns:

| Field | Type | Description |
| --- | --- | --- |
| `disconnect` | `() => void` | Stop the timer and remove all listeners. Calling `connectTileHost` again after `disconnect` (e.g. against a rebuilt iframe) starts a fresh connection. |
| `reannounce` | `() => void` | Restart the announce loop with a fresh attempt budget. Provided as an escape hatch for cases like an iframe going from hidden to visible, or a manual "retry" affordance after `announceExhausted`. |


## postMessage Contract

Every message is a plain object containing one of the `type`s below. Messages also carry `source: "eux-tile"`, for identification on a shared channel.

| `type` | Direction | Description |
| --- | --- | --- |
| `investifi:host-ready` | Host → Tile | Host is ready and listening, sent repeatedly until the tile acknowledges it.
| `investifi:tile-listening` | Tile → Host | Host cue to start announcing. Sent to `*`, because the tile does not know the host's origin yet. |
| `investifi:tile-ready` | Tile → Host | Acks the host announce. Sent only to the same origin the message came from. |
| `investifi:launch` | Tile → Host | The user pressed the button. Navigate to your launch route. | 

## How the handshake works

1. As soon as `connectTileHost` is called (and again on every iframe load), the host posts `investifi:host-ready` to `tileOrigin` on a repeating interval, up to a fixed number of attempts.
2. The tile acks with `investifi:tile-ready`, which stops the announce loop.
3. If the tile mounts or hydrates after the announce budget has ran out, it posts `investifi:tile-listening`, which restarts the announce loop.
4. When a user clicks the tile's CTA button, it posts `investifi:launch`, invoking `onLaunch`.

Every inbound message is checked against the framed window (`event.source`) and the expected origin (`event.origin`) before being acted on.


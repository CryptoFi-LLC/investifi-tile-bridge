# @investifi/tile-bridge

Host side of the InvestiFi tile `postMessage` contract.

## Install

```sh
npm install @investifi/tile-bridge
```

## Usage

```ts
import { connectTileHost } from '@investifi/tile-bridge';

const iframe = document.querySelector('iframe')!;

const { disconnect, reannounce } = connectTileHost({
  iframe,
  tileOrigin: 'https://tile.investifi.com',
  onLaunch: () => openLaunchFlow(),
  onEvent: (event) => console.debug('tile-bridge', event),
});

// Later, e.g. when the host component unmounts:
disconnect();
```

## How the handshake works

1. As soon as `connectTileHost` is called (and again on every iframe `load`),
   the host posts `investifi:host-ready` to `tileOrigin` on a repeating
   interval, up to a fixed number of attempts.
2. The tile acks with `investifi:tile-ready`, which stops the announce loop.
3. If the tile mounts late — after the announce budget already ran out, or
   after an in-frame navigation — it posts `investifi:tile-listening`, which
   restarts the announce loop from scratch, no budget lost.
4. When the tile wants to launch, it posts `investifi:launch`, which invokes
   `onLaunch`.

Every inbound message is checked against the framed window (`event.source`)
and the expected origin (`event.origin`) before it's acted on.

## API

### `connectTileHost(options)`

| Option | Type | Required | Description |
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


## License

MIT

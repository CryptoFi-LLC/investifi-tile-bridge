# Host Integration Guide for React Native

This document outlines how to handle the tile's `investifi:launch` message sent via `postMessage`, in a React Native mobile WebView.

The full InvestiFi experience is served from the same web origin as the tile, so there is no session to hand across. 

What you build is one `onMessage` handler on the screen that hosts the tile.

## Example Implementation

In this example `InvestingScreen` is a screen holding a WebView pointed at the full InvestiFi app. Push it as its own screen for a native back button, or navigate this WebView in place.

```jsx
<WebView
  source={{ uri: "https://investifi.example-fi.com/tile" }}
  sharedCookiesEnabled // iOS: use the app's shared cookie store
  onMessage={(event) => {
    let message;
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (message.source !== "eux-tile") return;
    if (message.type !== "investifi:launch") return;

    navigation.push("InvestingScreen");
  }}
/>
```

### Lock the WebView to the financial institution's origin

On web, the tile and your dashboard validate each other by origin. A native bridge has no origin to check, so the trust comes entirely from your app controlling what that WebView is allowed to load. Without this, any page that manages to navigate the WebView inherits the bridge.

```jsx
onShouldStartLoadWithRequest={(request) =>
  request.url.startsWith('https://investifi.example-fi.com/')
}
```

The tile posts the same payload used in the web implementation:

```jsx
window.ReactNativeWebView.postMessage(
  JSON.stringify({ type: "investifi:launch", source: "eux-tile" }),
);
```

## React Native vs Web iFrame

|                | React Native                                                              | Web Iframe                                                       |
| -------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Connection     | Capability detection via `window.ReactNativeWebView`                      | `postMessage` handshake                                          |
| Retries        | None, not affected by the race edge case on web                           | An announce budget, plus a re-announce when the tile mounts late |
| Messages       | Only `investifi:launch` crosses the bridge                                | Four messages                                                    |
| Trust boundary | Your app controls what the WebView loads, hence the navigation lock above | `event.origin`, validated on both sides                          |

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { BrowserKeyValueStore } from "@effect/platform-browser";

/**
 * Capability for broadcasting storage changes across browser contexts
 * @since 0.1.0
 * @category Capabilities
 */
export class StorageBroadcast extends Context.Tag("@convex-atom/StorageBroadcast")<
  StorageBroadcast,
  {
    readonly post: (key: string, value: string) => Effect.Effect<void>;
    readonly subscribe: (key: string, listener: (value: string) => Effect.Effect<void>) => Effect.Effect<() => void>;
  }
>() { }

/**
 * Capability for subscribing to browser storage events
 * @since 0.1.0
 * @category Capabilities
 */
export class StorageSubscription extends Context.Tag("@convex-atom/StorageSubscription")<
  StorageSubscription,
  {
    readonly subscribe: (key: string, listener: (value: string) => Effect.Effect<void>) => Effect.Effect<() => void>;
  }
>() { }

/**
 * Layer providing BroadcastChannel-based storage broadcasting
 * @since 0.1.0
 * @category Layers
 */
export const BrowserStorageBroadcastLive = Layer.sync(StorageBroadcast, () => {
  const channel = new BroadcastChannel("@convex-atom");

  return StorageBroadcast.of({
    post: (key, value) => Effect.sync(() => channel.postMessage({ key, value }))
      .pipe(Effect.withSpan("StorageBroadcast.post")),

    subscribe: Effect.fn("StorageBroadcast.subscribe")(function* (key, listener) {
      const onBroadcast = (event: MessageEvent) => {
        if (event.data && event.data.key === key && typeof event.data.value === "string") {
          listener(event.data.value).pipe(Effect.runSync)
        }
      }

      channel.addEventListener("message", onBroadcast);
      return () => channel.removeEventListener("message", onBroadcast);
    })
  });
});

/**
 * Layer providing storage event subscription
 * @since 0.1.0
 * @category Layers
 */
export const BrowserStorageSubscriptionLive = Layer.sync(StorageSubscription, () =>
  StorageSubscription.of({
    subscribe: Effect.fn("StorageSubscription.subscribe")(function* (key, listener) {
      const onStorage = (event: StorageEvent) => {
        if (event.key === key && event.newValue && event.newValue !== event.oldValue) {
          listener(event.newValue).pipe(Effect.runSync);
        }
      };

      addEventListener("storage", onStorage);
      return () => removeEventListener("storage", onStorage);
    })
  })
);

/**
 * Combined layer providing both storage subscription and broadcasting
 * @since 0.1.0
 * @category Layers
 */
export const layerLocalStorage = Layer.mergeAll(
  BrowserKeyValueStore.layerLocalStorage,
  BrowserStorageBroadcastLive,
  BrowserStorageSubscriptionLive
);


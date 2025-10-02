"use client"
import { Atom } from "@effect-atom/atom";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Hash from "effect/Hash"
import * as Equal from "effect/Equal"
import * as Result from "@effect-atom/atom/Result";
import * as Data from "effect/Data";
import { ConvexReactClient, useConvex } from "convex/react";
import { type FunctionReference, type FunctionReturnType, type FunctionArgs, getFunctionName } from "convex/server";
import { useAtom, useAtomValue } from "@effect-atom/atom-react";
import { EmitOpsPush } from "effect/StreamEmit";
import * as KeyValueStore from "@effect/platform/KeyValueStore"
import * as Option from "effect/Option";
import * as Layer from "effect/Layer"
import React from "react";
import * as SubscribeableStorage from "./subscribeable-storage";

/**
 * Error type for Convex-related failures
 * @since 0.1.0
 * @category Errors
 */
export class ConvexError extends Data.TaggedError("ConvexError")<{
  message: string;
  cause?: unknown;
}> { }

/**
 * Check if we're in a browser environment
 * @internal
 */
const isBrowser = () => typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";

/**
 * @since 0.1.0
 * @category Symbols
 */
export const QueryParamsTypeId: unique symbol = Symbol.for("@convex-atom/QueryParams");
export type QueryParamsTypeId = typeof QueryParamsTypeId;


/**
 * Type guard to check if a value is QueryParams
 * @since 0.1.0
 * @category Predicates
 */
export const isQueryParams = <Query extends FunctionReference<"query">>(u: unknown): u is QueryParams<Query> =>
  u !== null &&
  typeof u === "object" &&
  QueryParamsTypeId in u;


/**
 * Query parameters for Convex query atoms
 * @since 0.1.0
 * @category Models
 */
interface QueryParams<Query extends FunctionReference<"query">> extends Hash.Hash, Equal.Equal {
  readonly [QueryParamsTypeId]: QueryParamsTypeId;
  readonly client: ConvexReactClient;
  readonly query: Query;
  readonly args: FunctionArgs<Query>;
}

const QueryParamsProto = {
  [QueryParamsTypeId]: QueryParamsTypeId,

  [Hash.symbol]<Query extends FunctionReference<"query">>(
    this: QueryParams<Query>
  ): number {
    return Hash.cached(this, Hash.array([
      getFunctionName(this.query),
      Hash.structure(this.args)
    ]));
  },

  [Equal.symbol]<Query extends FunctionReference<"query">>(
    this: QueryParams<Query>,
    that: unknown
  ): boolean {
    return (
      isQueryParams(that) &&
      getFunctionName(this.query) === getFunctionName(that.query)) &&
      Equal.equals(this.args, that.args)
  }
};

const makeQueryParams = <Query extends FunctionReference<"query">>({
  client,
  query,
  args,
}: {
  readonly client: ConvexReactClient;
  readonly query: Query;
  readonly args?: FunctionArgs<Query>;
}): QueryParams<Query> =>
  Object.assign(Object.create(QueryParamsProto), { client, query, args: Data.struct(args ?? {}) });


/**
 * Atom family for Convex queries.
 * Creates reactive atoms that automatically update when Convex data changes.
 *
 * @since 0.1.0
 * @category Atoms
 */
export const convexQueryFamily = Atom.family(
  <Query extends FunctionReference<"query">>(
    params: QueryParams<Query>
  ) => {
    return Atom.make(
      Stream.asyncPush<FunctionReturnType<Query>, ConvexError>(
        (emit: EmitOpsPush<ConvexError, FunctionReturnType<Query>>) =>
          Effect.acquireRelease(
            Effect.gen(function* () {
              const kv = yield* Effect.serviceOption(KeyValueStore.KeyValueStore);
              const broadcast = yield* Effect.serviceOption(SubscribeableStorage.StorageBroadcast);
              const subscription = yield* Effect.serviceOption(SubscribeableStorage.StorageSubscription);

              const kvKey = getFunctionName(params.query) + JSON.stringify(params.args);
              const watch = params.client.watchQuery(params.query, params.args);

              let unsubscribeStorage = () => { };
              let unsubscribeBroadcast = () => { };

              const listener = (value: string) => Effect.try(() => emit.single(JSON.parse(value)))
                .pipe(
                  Effect.tapError((err) => Effect.sync(() => emit.fail(new ConvexError({
                    message: `Failed to parse stored value for key ${kvKey}`,
                    cause: err
                  })))),
                  Effect.orElse(() => Effect.void)
                )

              // Set up subscriptions (if available)
              if (Option.isSome(subscription)) {
                unsubscribeStorage = yield* subscription.value.subscribe(kvKey, listener);
              }

              if (Option.isSome(broadcast)) {
                unsubscribeBroadcast = yield* broadcast.value.subscribe(kvKey, listener);
              }

              // Initial load: try localQueryResult first, then cached value
              try {
                const initial = watch.localQueryResult();
                if (initial !== undefined) {
                  emit.single(initial);
                  // Store in KV and broadcast to other tabs
                  if (Option.isSome(kv)) {
                    yield* kv.value.set(kvKey, JSON.stringify(initial));
                  }
                  if (Option.isSome(broadcast)) {
                    yield* broadcast.value.post(kvKey, JSON.stringify(initial));
                  }
                } else {
                  // No initial result from watch, check cached value
                  yield* Effect.transposeMapOption(kv, store => store.get(kvKey))
                    .pipe(
                      Effect.map(Option.flatten),
                      Effect.map(Option.match({
                        onSome: v => emit.single(JSON.parse(v)),
                        onNone: () => { }
                      }))
                    );
                }
              } catch (error) {
                emit.fail(new ConvexError({
                  message: `Query ${getFunctionName(params.query)} failed`,
                  cause: error
                }));
              }

              // Set up Convex subscription - updates KV and broadcasts
              const unsubscribe = watch.onUpdate(
                () => {
                  try {
                    const result = watch.localQueryResult();
                    if (result !== undefined) {
                      const value = JSON.stringify(result);

                      if (Option.isSome(kv)) {
                        kv.value.set(kvKey, value).pipe(Effect.runSync);
                      }

                      if (Option.isSome(broadcast)) {
                        broadcast.value.post(kvKey, value).pipe(Effect.runSync);
                      }
                    }
                  } catch (error) {
                    emit.fail(new ConvexError({
                      message: `Query ${getFunctionName(params.query)} failed during update`,
                      cause: error
                    }));
                  }
                });

              // Return cleanup function
              return () => {
                unsubscribe();
                unsubscribeStorage();
                unsubscribeBroadcast();
              };
            }).pipe(
              Effect.provide(isBrowser() ? SubscribeableStorage.layerLocalStorage : Layer.empty),
              Effect.mapError(error => new ConvexError({
                message: `Stream failed`,
                cause: error
              }))
            ),
            // Cleanup: unsubscribe when stream is terminated
            (cleanup) => Effect.sync(cleanup)
          ),
        {
          bufferSize: 2,
          strategy: "sliding"
        }
      )
    ).pipe(
      Atom.keepAlive,

    )

  }

);


/**
 * @since 0.1.0
 * @category Symbols
 */
export const MutationParamsTypeId: unique symbol = Symbol.for("@convex-atom/MutationParams");
export type MutationParamsTypeId = typeof MutationParamsTypeId;

/**
 * Type guard to check if a value is MutationParams
 * @since 0.1.0
 * @category Predicates
 */
export const isMutationParams = <Mutation extends FunctionReference<"mutation">>(u: unknown): u is MutationParams<Mutation> =>
  u !== null &&
  typeof u === "object" &&
  MutationParamsTypeId in u;

/**
 * Mutation parameters for Convex mutation atoms
 * @since 0.1.0
 * @category Models
 */
interface MutationParams<Mutation extends FunctionReference<"mutation">> {
  readonly [MutationParamsTypeId]: MutationParamsTypeId;
  readonly client: ConvexReactClient;
  readonly mutation: Mutation;
  readonly [Hash.symbol]: () => number;
  readonly [Equal.symbol]: (that: unknown) => boolean;
}

const MutationParamsProto = {
  [MutationParamsTypeId]: MutationParamsTypeId,

  [Hash.symbol]<Mutation extends FunctionReference<"mutation">>(
    this: MutationParams<Mutation>
  ): number {
    // Only hash the mutation name, not the client
    return Hash.cached(this, Hash.string(getFunctionName(this.mutation)));
  },

  [Equal.symbol]<Mutation extends FunctionReference<"mutation">>(
    this: MutationParams<Mutation>,
    that: unknown
  ): boolean {
    // Only compare mutation names, not clients
    return (
      isMutationParams(that) &&
      getFunctionName(this.mutation) === getFunctionName(that.mutation)
    );
  }
};

const makeMutationParams = <Mutation extends FunctionReference<"mutation">>({
  client,
  mutation,
}: {
  readonly client: ConvexReactClient;
  readonly mutation: Mutation;
}): MutationParams<Mutation> =>
  Object.assign(Object.create(MutationParamsProto), { client, mutation });

/**
 * Atom family for Convex mutations.
 * Creates effectful function atoms that execute mutations.
 *
 * @since 0.1.0
 * @category Atoms
 */
export const convexMutationFamily = Atom.family(
  <Mutation extends FunctionReference<"mutation">>(
    params: MutationParams<Mutation>
  ) => Atom.fn(
    Effect.fn(function* (args: FunctionArgs<Mutation>) {
      return yield* Effect.tryPromise({
        try: () => params.client.mutation(params.mutation, args),
        catch: (error) => new ConvexError({
          message: `Mutation ${getFunctionName(params.mutation)} failed`,
          cause: error
        })
      });
    })
  )
);

/**
 * React hook for Convex queries with automatic reactivity.
 * Returns a Result type that handles loading, success, and error states.
 *
 * @since 0.1.0
 * @category Hooks
 *
 * @param query - The Convex query function reference
 * @param args - Optional arguments for the query
 */
export const useQuery = <Query extends FunctionReference<"query">>(
  query: Query,
  args?: FunctionArgs<Query>
): Result.Result<FunctionReturnType<Query>, ConvexError> => {

  const client = useConvex();

  const params = makeQueryParams({ client, query, args });
  const atom = React.useMemo(() => convexQueryFamily(params), [params]);

  return useAtomValue(atom);
};


/**
 * React hook for Convex mutations.
 * Returns an effectful function that executes the mutation.
 *
 * @since 0.1.0
 * @category Hooks
 *
 * @param mutation - The Convex mutation function reference
 */
export const useMutation = <Mutation extends FunctionReference<"mutation">>(
  mutation: Mutation
) => {

  const client = useConvex();

  const params = makeMutationParams({ client, mutation });
  const mutationAtom = React.useMemo(() => convexMutationFamily(params), [params]);

  return useAtom(mutationAtom, { mode: "promiseExit" });
};


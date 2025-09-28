import { Atom } from "@effect-atom/atom";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Hash from "effect/Hash"
import * as Equal from "effect/Equal"
import * as Result from "@effect-atom/atom/Result";
import * as Data from "effect/Data";
import { ConvexReactClient, useConvex } from "convex/react";
import { type FunctionReference, type FunctionReturnType, type FunctionArgs, getFunctionName } from "convex/server";
import { useAtomValue } from "@effect-atom/atom-react";

/**
 * Error type for Convex-related failures
 * @since 1.0.0
 * @category Errors
 */
export class ConvexError extends Data.TaggedError("ConvexError")<{
  message: string;
  cause?: unknown;
}> { }


/**
 * @since 1.0.0
 * @category Symbols
 */
export const QueryParamsTypeId: unique symbol = Symbol.for("@convex-atom/QueryParams");

/**
 * @since 1.0.0
 * @category Symbols
 */
export type QueryParamsTypeId = typeof QueryParamsTypeId;

/**
 * Query parameters for Convex query atoms
 * @since 1.0.0
 * @category Models
 */
interface QueryParams<Query extends FunctionReference<"query">> {
  readonly [QueryParamsTypeId]: QueryParamsTypeId;
  readonly client: ConvexReactClient;
  readonly query: Query;
  readonly args?: FunctionArgs<Query>;
  readonly [Hash.symbol]: () => number;
  readonly [Equal.symbol]: (that: unknown) => boolean;
}

const QueryParamsProto = {
  [QueryParamsTypeId]: QueryParamsTypeId,

  [Hash.symbol]<Query extends FunctionReference<"query">>(
    this: QueryParams<Query>
  ): number {
    return Hash.cached(this, Hash.array([
      getFunctionName(this.query),
      JSON.stringify(this.args ?? {})
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
  Object.assign(Object.create(QueryParamsProto), { client, query, args });


/**
 * Creates a Convex query watcher effect that emits query results
 * @internal
 */
const createQueryWatcher = <Query extends FunctionReference<"query">>(
  params: QueryParams<Query>,
  emit: {
    single: (value: FunctionReturnType<Query>) => void;
  }
) =>
  Effect.gen(function* () {
    const watch = params.client.watchQuery(params.query, params.args);

    // Emit initial value if available
    const initial = watch.localQueryResult();
    if (initial !== undefined) {
      emit.single(initial);
    }

    // Set up subscription for updates
    const unsubscribe = watch.onUpdate(() => {
      const result = watch.localQueryResult();
      if (result !== undefined) {
        emit.single(result);
      }
    });

    return unsubscribe;
  });

/**
 * Atom family for Convex queries.
 * Creates reactive atoms that automatically update when Convex data changes.
 *
 * @since 1.0.0
 * @category Atoms
 *
 * @example
 * ```ts
 * const params = makeQueryParams({ client, query: api.users.list, args: {} });
 * const atom = convexQueryFamily(params);
 * ```
 */
export const convexQueryFamily = Atom.family(
  <Query extends FunctionReference<"query">>(
    params: QueryParams<Query>
  ) => {
    return Atom.make(
      Stream.asyncPush<FunctionReturnType<Query>, ConvexError>(
        (emit) =>
          Effect.acquireRelease(
            createQueryWatcher(params, emit),
            (unsubscribe) => Effect.sync(unsubscribe)
          ),
        {
          bufferSize: 16,
          strategy: "sliding"
        }
      )
    ).pipe(
      Atom.keepAlive
    );
  }
);

/**
 * React hook for Convex queries with automatic reactivity.
 * Returns a Result type that handles loading, success, and error states.
 *
 * @since 1.0.0
 * @category Hooks
 *
 * @param query - The Convex query function reference
 * @param args - Optional arguments for the query
 * @returns Result containing the query data or error
 *
 * @example
 * ```tsx
 * const users = useQuery(api.users.list);
 *
 * if (Result.isInitial(users)) return <div>Loading...</div>;
 * if (Result.isFailure(users)) return <div>Error: {users.error.message}</div>;
 * return <div>{users.value.map(...)}</div>;
 * ```
 */
export const useQuery = <Query extends FunctionReference<"query">>(
  query: Query,
  args?: FunctionArgs<Query>
): Result.Result<FunctionReturnType<Query>, ConvexError> => {
  const client = useConvex();

  const params = makeQueryParams({ client, query, args });
  const atom = convexQueryFamily(params);

  return useAtomValue(atom);
};

/**
 * React hook for Convex mutations.
 * Returns a tuple of [Result state, mutation function].
 *
 * @since 1.0.0
 * @category Hooks
 *
 * @param mutation - The Convex mutation function reference
 * @returns Tuple of mutation state and executor function
 *
 * @example
 * ```tsx
 * const [state, createUser] = useMutation(api.users.create);
 *
 * const handleSubmit = async (data) => {
 *   await createUser({ name: data.name });
 * };
 * ```
 */
export const useMutation = <Mutation extends FunctionReference<"mutation">>(
  mutation: Mutation
): [Result.Result<void, ConvexError>, (args: FunctionArgs<Mutation>) => Promise<FunctionReturnType<Mutation>>] => {
  const client = useConvex();

  // For now, we'll return a simple implementation
  // In a full implementation, this would track mutation state with atoms
  const executeMutation = async (args: FunctionArgs<Mutation>) => {
    return client.mutation(mutation, args);
  };

  // Return initial state and mutation function
  return [Result.initial(), executeMutation];
};


/**
 * Type guard to check if a value is QueryParams
 * @since 1.0.0
 */
export const isQueryParams = <Query extends FunctionReference<"query">>(u: unknown): u is QueryParams<Query> =>
  u !== null &&
  typeof u === "object" &&
  QueryParamsTypeId in u;
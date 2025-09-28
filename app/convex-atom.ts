import { Atom } from "@effect-atom/atom";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Result from "@effect-atom/atom/Result";
import * as Data from "effect/Data";
import { ConvexReactClient, useConvex } from "convex/react";
import type { FunctionReference, FunctionReturnType, FunctionArgs } from "convex/server";
import { useAtomValue } from "@effect-atom/atom-react";

// ============================================================================
// Error Types
// ============================================================================

export class ConvexError extends Data.TaggedError("ConvexError")<{
  message: string;
  cause?: unknown;
}> { }

// ============================================================================
// Create Query Atom Family - Module Level
// ============================================================================

/**
 * Simple atom family that takes client and args, returns a query atom.
 * Created once at module level, Atom.family handles all caching.
 *
 * When passing a Stream to Atom.make, it automatically:
 * - Returns Result.initial() while waiting for first value
 * - Returns Result.success(value) for each emitted value
 * - Returns Result.failure(error) if the stream fails
 */
export const convexQueryFamily = Atom.family(
  <Query extends FunctionReference<"query">>(params: {
    client: ConvexReactClient;
    query: Query;
    args?: FunctionArgs<Query>;
  }) => {
    // This function only runs once per unique params combination
    // Atom.family caches the result
    return Atom.make(
      Stream.asyncPush<FunctionReturnType<Query>, ConvexError>(
        (emit) =>
          Effect.acquireRelease(
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
            }),
            // Cleanup function
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

// ============================================================================
// React Hook
// ============================================================================

/**
 * Simple hook - just get the atom from the family and use it.
 * The Result type is automatically handled by Atom.make when given a Stream.
 */
export const useQuery = <Query extends FunctionReference<"query">>(
  query: Query,
  args?: FunctionArgs<Query>
): Result.Result<FunctionReturnType<Query>, ConvexError> => {
  const client = useConvex();

  // Get atom from family - this is memoized by Atom.family
  const atom = convexQueryFamily({ client, query, args });

  return useAtomValue(atom);
};

// ============================================================================
// Mutation Hook (temporary simple implementation)
// ============================================================================

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
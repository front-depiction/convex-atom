import { v } from "convex/values";
import { query, mutation, action } from "./_generated/server";
import { api } from "./_generated/api";
import * as Effect from "effect/Effect"
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ParseError } from "effect/ParseResult";
import * as Exit from "effect/Exit";

// Write your Convex functions in any file inside this directory (`convex`).
// See https://docs.convex.dev/functions for more.

type ExtractExit<T> = T extends Exit.Exit<infer A, infer B> ? Effect.Effect<
  Exit.Exit<A, Schema.CauseEncoded<B, never>>,
  ParseError,
  never
> : never
const encodeTransparent = <T extends Exit.Exit<unknown, unknown>>(self: T) =>
  Schema.encodeUnknown(Schema.Exit({ defect: Schema.Any, failure: Schema.Any, success: Schema.Any }))(self) as ExtractExit<T>






// You can read data from the database via a query:
export const listNumbers = query({
  // Validators for arguments.
  args: {
    count: v.number(),
  },

  // Query implementation.
  handler: (ctx, args) => Effect.gen(function* () {
    const numbersEffect = Effect.tryPromise(() => ctx.db
      .query("numbers")
      // Ordered by _creationTime, return most recent
      .order("desc")
      .take(args.count))

    const userNameEffect = Effect.tryPromise(() => ctx.auth.getUserIdentity())
      .pipe(Effect.map(id => Option.fromNullable(id?.name)))

    return yield* Effect.all([numbersEffect, userNameEffect]).pipe(
      Effect.map(([numbersResult, userNameResult]) => ({
        viewer: userNameResult,
        numbers: numbersResult.reverse().map((number) => number.value),
      })),
    )
  }).pipe(
    Effect.exit,
    Effect.flatMap(exit => encodeTransparent(exit)),
    Effect.runPromise,
  )
});

// You can write data to the database via a mutation:
export const addNumber = mutation({
  // Validators for arguments.
  args: {
    value: v.number(),
  },

  // Mutation implementation.
  handler: async (ctx, args) => {
    //// Insert or modify documents in the database here.
    //// Mutations can also read from the database like queries.
    //// See https://docs.convex.dev/database/writing-data.

    const id = await ctx.db.insert("numbers", { value: args.value });

    console.log("Added new document with id:", id);
    // Optionally, return a value from your mutation.
    // return id;
  },
});

// You can fetch data from and send data to third-party APIs via an action:
export const myAction = action({
  // Validators for arguments.
  args: {
    first: v.number(),
    second: v.string(),
  },

  // Action implementation.
  handler: async (ctx, args) => {
    //// Use the browser-like `fetch` API to send HTTP requests.
    //// See https://docs.convex.dev/functions/actions#calling-third-party-apis-and-using-npm-packages.
    // const response = await ctx.fetch("https://api.thirdpartyservice.com");
    // const data = await response.json();

    //// Query data by running Convex queries.
    const data = await ctx.runQuery(api.myFunctions.listNumbers, {
      count: 10,
    });
    console.log(data);

    //// Write data by running Convex mutations.
    await ctx.runMutation(api.myFunctions.addNumber, {
      value: args.first,
    });
  },
});

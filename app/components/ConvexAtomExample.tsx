"use client";

import React from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { RegistryProvider } from "@effect-atom/atom-react";
import { useQuery } from "../convex-atom";
import { api } from "../../convex/_generated/api";
import * as Result from "@effect-atom/atom/Result";

const convexClient = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

function NumbersList() {
  const queryResult = useQuery(
    api.myFunctions.listNumbers,
    { count: 10 }
  );

  return (
    <div className="p-4">
      {Result.match(queryResult, {
        onInitial: () => (
          <div className="text-gray-500">Loading numbers...</div>
        ),
        onFailure: (error) => (
          <div className="text-red-500">
            Error: {error.cause._tag === 'Fail' && error.cause.error && typeof error.cause.error === 'object' && 'message' in error.cause.error
              ? String(error.cause.error.message)
              : 'Unknown error'}
          </div>
        ),
        onSuccess: (data) => {
          // Since the Convex function returns an Exit encoded value,
          // we need to handle that structure
          const exitData = data.value;

          // Check if it's a success Exit
          if (exitData && typeof exitData === 'object' && '_tag' in exitData) {
            if (exitData._tag === 'Success') {
              const result = (exitData as any).value;
              return (
                <div>
                  <h3 className="text-lg font-semibold mb-2">Numbers List</h3>
                  {result.viewer && (
                    <p className="text-sm text-gray-600 mb-2">
                      Viewer: {result.viewer._tag === 'Some' ? result.viewer.value : 'Anonymous'}
                    </p>
                  )}
                  <ul className="space-y-1">
                    {result.numbers && result.numbers.length > 0 ? (
                      result.numbers.map((num: number, index: number) => (
                        <li key={index} className="p-2 bg-gray-100 rounded">
                          {num}
                        </li>
                      ))
                    ) : (
                      <li className="text-gray-500">No numbers yet</li>
                    )}
                  </ul>
                </div>
              );
            } else {
              return (
                <div className="text-red-500">
                  Query failed with Exit.Failure
                </div>
              );
            }
          }

          // Fallback for unexpected data structure
          return (
            <div className="text-gray-500">
              Received unexpected data structure
            </div>
          );
        }
      })}
    </div>
  );
}

export function ConvexAtomExample() {
  return (
    <ConvexProvider client={convexClient}>
      <RegistryProvider>
        <div className="max-w-2xl mx-auto p-8">
          <h1 className="text-2xl font-bold mb-6">
            Convex + Effect Atom Integration Example
          </h1>
          <NumbersList />
        </div>
      </RegistryProvider>
    </ConvexProvider>
  );
}
"use client";

import { api } from "../convex/_generated/api";
import * as ConvexAtom from "@/app/convex-atom"
import * as Result from "@effect-atom/atom/Result";
import { useMutation } from "convex/react";
import * as Option from "effect/Option"
import Link from "next/link";

export default function Home() {
  return (
    <>
      <header className="sticky top-0 z-10 bg-background p-4 border-b-2 border-slate-200 dark:border-slate-800 flex flex-row justify-between items-center">
        Convex + Next.js
      </header>
      <main className="p-8 flex flex-col gap-16">
        <h1 className="text-4xl font-bold text-center">Convex + Next.js</h1>
        <Content />
      </main>
    </>
  );
}

function Content() {
  const listNumberResult = ConvexAtom.useQuery(api.myFunctions.listNumbers, {
    count: 10,
  });
  const addNumber = useMutation(api.myFunctions.addNumber)

  return Result.match(listNumberResult, {
    onInitial: () => (
      <div className="mx-auto">
        <p>loading... (consider a loading skeleton)</p>
      </div>
    ),
    onFailure: (error) => (
      <div className="mx-auto">
        <p className="text-red-600">Error loading numbers: {String(error)}</p>
      </div>
    ),
    onSuccess: (success) => {
      // Handle Exit type from Convex function
      const exitValue = success.value;
      if (!exitValue || typeof exitValue !== 'object' || !('_tag' in exitValue)) {
        return <div>Invalid data structure</div>;
      }

      if (exitValue._tag !== 'Success') {
        return <div>Query failed</div>;
      }

      const { viewer, numbers } = exitValue.value;
      return (
        <div className="flex flex-col gap-8 max-w-lg mx-auto">
          <p>
            {Option.match(viewer, {
              onNone: () => "Welcome Anonymous",
              onSome: (v) => "Welcome " + v,
            })}
            !
          </p>
          <p>
            Click the button below and open this page in another window - this data
            is persisted in the Convex cloud database!
          </p>
          <p>
            <button
              className="bg-foreground text-background text-sm px-4 py-2 rounded-md"
              onClick={() => {

                void addNumber({ value: Math.floor(Math.random() * 100) });
              }}
            >
              Add a random number
            </button>

          </p>
          <p>
            Numbers:{" "}
            {numbers?.length === 0
              ? "Click the button!"
              : numbers?.join(", ") ?? "..."}
          </p>
          <p>
            Edit{" "}
            <code className="text-sm font-bold font-mono bg-slate-200 dark:bg-slate-800 px-1 py-0.5 rounded-md">
              convex/myFunctions.ts
            </code>{" "}
            to change your backend
          </p>
          <p>
            Edit{" "}
            <code className="text-sm font-bold font-mono bg-slate-200 dark:bg-slate-800 px-1 py-0.5 rounded-md">
              app/page.tsx
            </code>{" "}
            to change your frontend
          </p>
          <p>
            See the{" "}
            <Link href="/server" className="underline hover:no-underline">
              /server route
            </Link>{" "}
            for an example of loading data in a server component
          </p>
          <div className="flex flex-col">
            <p className="text-lg font-bold">Useful resources:</p>
            <div className="flex gap-2">
              <div className="flex flex-col gap-2 w-1/2">
                <ResourceCard
                  title="Convex docs"
                  description="Read comprehensive documentation for all Convex features."
                  href="https://docs.convex.dev/home"
                />
                <ResourceCard
                  title="Stack articles"
                  description="Learn about best practices, use cases, and more from a growing
                collection of articles, videos, and walkthroughs."
                  href="https://www.typescriptlang.org/docs/handbook/2/basic-types.html"
                />
              </div>
              <div className="flex flex-col gap-2 w-1/2">
                <ResourceCard
                  title="Templates"
                  description="Browse our collection of templates to get started quickly."
                  href="https://www.convex.dev/templates"
                />
                <ResourceCard
                  title="Discord"
                  description="Join our developer community to ask questions, trade tips & tricks,
                and show off your projects."
                  href="https://www.convex.dev/community"
                />
              </div>
            </div>
          </div>
        </div>
      );
    },
  });
}

function ResourceCard({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <div className="flex flex-col gap-2 bg-slate-200 dark:bg-slate-800 p-4 rounded-md h-28 overflow-auto">
      <a href={href} className="text-sm underline hover:no-underline">
        {title}
      </a>
      <p className="text-xs">{description}</p>
    </div>
  );
}

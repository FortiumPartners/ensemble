---
name: typescript-reference
description: Comprehensive TypeScript 5.x reference covering advanced generics, conditional types, declaration files, decorators, and build tool integration.
---

# TypeScript Development - Comprehensive Reference

**Version**: 1.0.0 | **TypeScript**: 5.x | **Use Case**: Advanced patterns, deep dives

---

## Table of Contents

1. [Advanced Generics](#1-advanced-generics)
2. [Conditional Types](#2-conditional-types)
3. [Mapped Types Deep Dive](#3-mapped-types-deep-dive)
4. [Template Literal Types](#4-template-literal-types)
5. [Declaration Files](#5-declaration-files)
6. [Module Augmentation](#6-module-augmentation)
7. [Decorators](#7-decorators)
8. [Advanced tsconfig](#8-advanced-tsconfig)
9. [Type Inference Patterns](#9-type-inference-patterns)
10. [Build Tool Integration](#10-build-tool-integration)
11. [Migration from JavaScript](#11-migration-from-javascript)

---

## 1. Advanced Generics

### Recursive Types

```typescript
// Deep readonly for nested objects
type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K];
};

// JSON value type
type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue };

// Tree structure
interface TreeNode<T> {
  value: T;
  children: TreeNode<T>[];
}
```

### Variadic Tuple Types (TS 4.0+)

```typescript
// Concat tuples
type Concat<T extends unknown[], U extends unknown[]> = [...T, ...U];
type Combined = Concat<[1, 2], ["a", "b"]>;  // [1, 2, "a", "b"]

// Extract first/rest/last
type First<T extends unknown[]> = T extends [infer F, ...unknown[]] ? F : never;
type Rest<T extends unknown[]> = T extends [unknown, ...infer R] ? R : never;
type Last<T extends unknown[]> = T extends [...unknown[], infer L] ? L : never;
```

### Const Type Parameters (TS 5.0+)

```typescript
// Preserve literal types
function routesConst<const T extends string[]>(paths: T): T {
  return paths;
}
const routes = routesConst(["home", "about"]);  // readonly ["home", "about"]
```

---

## 2. Conditional Types

### Basic Syntax

```typescript
// T extends U ? X : Y
type IsString<T> = T extends string ? true : false;

type TypeName<T> =
  T extends string ? "string" :
  T extends number ? "number" :
  T extends boolean ? "boolean" :
  T extends Function ? "function" :
  "object";
```

### Distributive Conditional Types

```typescript
// Distributes over unions automatically
type ToArray<T> = T extends unknown ? T[] : never;
type Result = ToArray<string | number>;  // string[] | number[]

// Prevent distribution with tuple wrapper
type ToArrayNonDist<T> = [T] extends [unknown] ? T[] : never;
type Combined = ToArrayNonDist<string | number>;  // (string | number)[]
```

### Infer Keyword

```typescript
// Extract from complex structures
type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;
type ElementType<T> = T extends (infer E)[] ? E : never;

type GetReturnType<T> = T extends (...args: any[]) => infer R ? R : never;

// Multiple infer positions
type ParseSignature<T> = T extends (arg: infer A) => infer R
  ? { arg: A; return: R }
  : never;

// Infer in template literals
type ParsePath<T> = T extends `${infer Start}/${infer Rest}`
  ? [Start, ...ParsePath<Rest>]
  : [T];
type Segments = ParsePath<"users/123/posts">;  // ["users", "123", "posts"]
```

---

## 3. Mapped Types Deep Dive

### Key Remapping (TS 4.1+)

```typescript
// Rename keys with 'as' clause
type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K];
};

// Filter keys
type RemoveFunctions<T> = {
  [K in keyof T as T[K] extends Function ? never : K]: T[K];
};

// Transform key names
type EventHandlers<T> = {
  [K in keyof T as `on${Capitalize<string & K>}Change`]: (value: T[K]) => void;
};
```

### Property Modifiers

```typescript
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Concrete<T> = { [K in keyof T]-?: T[K] };

// Deep variants
type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

type DeepRequired<T> = {
  [K in keyof T]-?: T[K] extends object ? DeepRequired<T[K]> : T[K];
};
```

---

## 4. Template Literal Types

### String Manipulation

```typescript
type Color = "red" | "blue";
type Size = "small" | "large";
type ColoredSize = `${Color}-${Size}`;  // "red-small" | "red-large" | "blue-small" | "blue-large"

// Extract route parameters
type ExtractRouteParams<T extends string> =
  T extends `${string}:${infer Param}/${infer Rest}`
    ? { [K in Param | keyof ExtractRouteParams<Rest>]: string }
    : T extends `${string}:${infer Param}`
    ? { [K in Param]: string }
    : {};

type UserRoute = ExtractRouteParams<"/users/:userId/posts/:postId">;
// { userId: string; postId: string }
```

### Split and Join

```typescript
type Split<S extends string, D extends string> =
  S extends `${infer T}${D}${infer U}` ? [T, ...Split<U, D>] : [S];

type Join<T extends string[], D extends string> =
  T extends [] ? "" :
  T extends [infer F extends string] ? F :
  T extends [infer F extends string, ...infer R extends string[]] ? `${F}${D}${Join<R, D>}` :
  never;
```

---

## 5. Declaration Files

### Writing .d.ts Files

```typescript
// my-library.d.ts
declare module "my-library" {
  export function process(input: string): ProcessResult;
  export class Client {
    constructor(options: ClientOptions);
    connect(): Promise<void>;
  }
  export interface ClientOptions {
    host: string;
    port: number;
  }
  export default class DefaultClient extends Client {}
}
```

### Ambient Declarations

```typescript
// globals.d.ts
declare const VERSION: string;
declare function log(message: string): void;

declare interface Window {
  analytics: { track(event: string): void };
}

declare class GlobalEvent {
  type: string;
  timestamp: number;
}
```

### Triple-Slash Directives

```typescript
/// <reference types="node" />
/// <reference path="./utils.d.ts" />
/// <reference lib="es2022" />
```

---

## 6. Module Augmentation

### Extending Third-Party Types

```typescript
// Extend Express
declare module "express" {
  interface Request {
    user?: { id: string; email: string };
    requestId: string;
  }
}

// Extend Node.js process.env
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV: "development" | "production" | "test";
      DATABASE_URL: string;
    }
  }
}

export {};  // Make this a module
```

### Extending Global Types

```typescript
declare global {
  interface Array<T> {
    first(): T | undefined;
    last(): T | undefined;
  }
}

Array.prototype.first = function() { return this[0]; };
Array.prototype.last = function() { return this[this.length - 1]; };

export {};
```

---

## 7. Decorators

### Modern Decorator Syntax (TS 5.0+)

```typescript
// Class decorator
function logged<T extends new (...args: any[]) => any>(
  target: T,
  context: ClassDecoratorContext
) {
  return class extends target {
    constructor(...args: any[]) {
      console.log(`Creating ${context.name}`);
      super(...args);
    }
  };
}

@logged
class MyService {
  constructor(public name: string) {}
}
```

### Method Decorators

```typescript
function log<T extends (...args: any[]) => any>(
  target: T,
  context: ClassMethodDecoratorContext
): T {
  return function (this: any, ...args: any[]) {
    console.log(`Calling ${String(context.name)}`);
    return target.apply(this, args);
  } as T;
}

class Calculator {
  @log
  add(a: number, b: number): number { return a + b; }
}
```

### Legacy Decorators (experimentalDecorators)

```typescript
// Enable: "experimentalDecorators": true
function sealed(constructor: Function) {
  Object.seal(constructor);
  Object.seal(constructor.prototype);
}

function enumerable(value: boolean) {
  return (target: any, key: string, descriptor: PropertyDescriptor) => {
    descriptor.enumerable = value;
  };
}
```

---

## 8. Advanced tsconfig

### Project References

```json
// packages/shared/tsconfig.json
{
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "outDir": "./dist"
  }
}

// packages/app/tsconfig.json
{
  "references": [{ "path": "../shared" }]
}
```

Build: `tsc --build` or `tsc -b`

### Path Aliases

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@components/*": ["src/components/*"]
    }
  }
}
```

**Note**: Requires bundler/runtime support (tsconfig-paths for Node.js)

### Additional Strict Options

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

---

## 9. Type Inference Patterns

### Const Assertions

```typescript
const colors = ["red", "green"] as const;  // readonly ["red", "green"]

const EVENTS = { CLICK: "click", SUBMIT: "submit" } as const;
type EventType = (typeof EVENTS)[keyof typeof EVENTS];  // "click" | "submit"
```

### Satisfies Operator (TS 4.9+)

```typescript
type Colors = Record<string, [number, number, number] | string>;

const palette = {
  red: [255, 0, 0],
  green: "#00ff00",
} satisfies Colors;

// palette.red is [number, number, number], not string | [number, number, number]
const redChannel = palette.red[0];  // number
```

### NoInfer Utility (TS 5.4+)

```typescript
function createFSM<S extends string>(config: {
  initial: NoInfer<S>;
  states: S[];
}) { return config; }

// Error: "unknown" not in states
// createFSM({ initial: "unknown", states: ["idle", "running"] });
```

---

## 10. Build Tool Integration

### esbuild

```typescript
import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/bundle.js",
  platform: "node",
  target: "node18",
  sourcemap: true,
});
```

### SWC

```json
// .swcrc
{
  "jsc": {
    "parser": { "syntax": "typescript", "tsx": true, "decorators": true },
    "target": "es2022"
  },
  "module": { "type": "es6" }
}
```

### Vite

```typescript
// vite.config.ts
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "esnext",
    lib: {
      entry: "src/index.ts",
      formats: ["es", "cjs"],
    },
  },
});
```

---

## 11. Migration from JavaScript

### Progressive Strategy

```json
// Step 1: Allow JS, no checking
{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": false,
    "strict": false
  }
}

// Step 2: Enable checkJs
// Step 3: Convert .js -> .ts one file at a time
// Step 4: Enable strict flags progressively
```

### Common Patterns

```typescript
// Handling dynamic types with validation
import { z } from "zod";

const ConfigSchema = z.object({
  host: z.string(),
  port: z.number(),
});

type Config = z.infer<typeof ConfigSchema>;
const config = ConfigSchema.parse(JSON.parse(rawConfig));
```

### Type Predicates for Unknown Data

```typescript
function isConfig(obj: unknown): obj is Config {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "host" in obj &&
    "port" in obj &&
    typeof (obj as Config).host === "string" &&
    typeof (obj as Config).port === "number"
  );
}
```

---

## See Also

- [SKILL.md](SKILL.md) - Quick reference for common patterns
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/)
- [Type Challenges](https://github.com/type-challenges/type-challenges)

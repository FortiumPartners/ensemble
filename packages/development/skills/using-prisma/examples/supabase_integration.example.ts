/**
 * Supabase + Prisma Integration Example
 *
 * This example demonstrates:
 * - Supabase Auth integration with Prisma
 * - Row Level Security (RLS) patterns
 * - Supabase Realtime with Prisma
 * - Edge Functions with Prisma
 * - Storage integration
 * - Service role vs user context
 */

// =============================================================================
// Environment Configuration
// =============================================================================

/**
 * .env.local configuration for Supabase:
 *
 * # Pooled connection (for application)
 * DATABASE_URL="postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres?pgbouncer=true"
 *
 * # Direct connection (for migrations)
 * DIRECT_URL="postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres"
 *
 * # Supabase client
 * NEXT_PUBLIC_SUPABASE_URL="https://PROJECT_REF.supabase.co"
 * NEXT_PUBLIC_SUPABASE_ANON_KEY="your-anon-key"
 * SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
 */

// =============================================================================
// lib/supabase.ts - Supabase Client Setup
// =============================================================================

import { createClient, SupabaseClient, User } from "@supabase/supabase-js";
import { createServerClient, createBrowserClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server-side Supabase client (App Router)
export function createServerSupabaseClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          cookieStore.delete({ name, ...options });
        },
      },
    }
  );
}

// Service role client (bypasses RLS)
export function createServiceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

// Browser client
export function createBrowserSupabaseClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// =============================================================================
// lib/prisma.ts - Prisma Client with User Context
// =============================================================================

import { PrismaClient, Prisma } from "@prisma/client";

// Base Prisma client
const prismaClientSingleton = () => {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
};

declare global {
  var prisma: ReturnType<typeof prismaClientSingleton> | undefined;
}

export const prisma = globalThis.prisma ?? prismaClientSingleton();

if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = prisma;
}

// Prisma client with user context for RLS-like filtering
export function createPrismaWithContext(userId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async findMany({ model, args, query }) {
          // Auto-filter by userId for user-owned models
          if (["Post", "Profile", "Comment"].includes(model)) {
            args.where = { ...args.where, userId };
          }
          return query(args);
        },
        async findFirst({ model, args, query }) {
          if (["Post", "Profile", "Comment"].includes(model)) {
            args.where = { ...args.where, userId };
          }
          return query(args);
        },
        async create({ model, args, query }) {
          if (["Post", "Profile", "Comment"].includes(model)) {
            args.data = { ...args.data, userId };
          }
          return query(args);
        },
        async update({ model, args, query }) {
          if (["Post", "Profile", "Comment"].includes(model)) {
            args.where = { ...args.where, userId };
          }
          return query(args);
        },
        async delete({ model, args, query }) {
          if (["Post", "Profile", "Comment"].includes(model)) {
            args.where = { ...args.where, userId };
          }
          return query(args);
        },
      },
    },
  });
}

// =============================================================================
// Auth Sync: Sync Supabase Auth User to Prisma Profile
// =============================================================================

export async function syncUserProfile(user: User) {
  // Create or update profile when user signs in
  const profile = await prisma.profile.upsert({
    where: {
      userId: user.id,
    },
    create: {
      userId: user.id,
      email: user.email!,
      username: user.email?.split("@")[0] ?? `user_${user.id.slice(0, 8)}`,
      fullName: user.user_metadata?.full_name,
      avatarUrl: user.user_metadata?.avatar_url,
    },
    update: {
      email: user.email!,
      fullName: user.user_metadata?.full_name,
      avatarUrl: user.user_metadata?.avatar_url,
    },
  });

  return profile;
}

// =============================================================================
// API Route: Protected Route with Auth Check
// =============================================================================

// app/api/posts/route.ts
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const supabase = createServerSupabaseClient();

  // Check authentication
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Use Prisma with user context
  const userPrisma = createPrismaWithContext(user.id);

  const posts = await userPrisma.post.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      author: {
        select: {
          username: true,
          avatarUrl: true,
        },
      },
    },
  });

  return NextResponse.json(posts);
}

export async function POST(request: NextRequest) {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { title, content, categoryId } = body;

  // Validate input
  if (!title || typeof title !== "string") {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  try {
    const post = await prisma.post.create({
      data: {
        title,
        content,
        slug: title.toLowerCase().replace(/\s+/g, "-"),
        userId: user.id,
        authorId: user.id, // Profile relation
        categoryId,
      },
      include: {
        author: {
          select: {
            username: true,
            avatarUrl: true,
          },
        },
      },
    });

    return NextResponse.json(post, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return NextResponse.json(
          { error: "A post with this slug already exists" },
          { status: 409 }
        );
      }
    }
    throw error;
  }
}

// =============================================================================
// Server Action: With Supabase Auth
// =============================================================================

// app/actions/posts.ts
"use server";

import { revalidatePath } from "next/cache";

export async function createPost(formData: FormData) {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be logged in to create a post" };
  }

  const title = formData.get("title") as string;
  const content = formData.get("content") as string;

  try {
    const post = await prisma.post.create({
      data: {
        title,
        content,
        slug: title.toLowerCase().replace(/\s+/g, "-"),
        userId: user.id,
        authorId: user.id,
      },
    });

    revalidatePath("/posts");
    return { success: true, post };
  } catch (error) {
    return { error: "Failed to create post" };
  }
}

export async function deletePost(postId: string) {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Unauthorized" };
  }

  // Verify ownership
  const post = await prisma.post.findFirst({
    where: {
      id: postId,
      userId: user.id,
    },
  });

  if (!post) {
    return { error: "Post not found or access denied" };
  }

  await prisma.post.delete({
    where: { id: postId },
  });

  revalidatePath("/posts");
  return { success: true };
}

// =============================================================================
// Edge Function: Prisma with Supabase Edge
// =============================================================================

// supabase/functions/process-post/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// For Edge Functions, use @prisma/client/edge
// Note: Requires Prisma Accelerate or direct connection
import { PrismaClient } from "@prisma/client/edge";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: Deno.env.get("DATABASE_URL")!,
    },
  },
});

serve(async (req) => {
  // Verify JWT from request
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "No authorization header" }), {
      status: 401,
    });
  }

  // Create Supabase client with user's JWT
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: {
        headers: { Authorization: authHeader },
      },
    }
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401,
    });
  }

  // Process with Prisma
  const { postId } = await req.json();

  const post = await prisma.post.update({
    where: {
      id: postId,
      userId: user.id, // Ensure ownership
    },
    data: {
      processedAt: new Date(),
      status: "PROCESSED",
    },
  });

  return new Response(JSON.stringify(post), {
    headers: { "Content-Type": "application/json" },
  });
});

// =============================================================================
// Realtime: Subscribe to Changes
// =============================================================================

// hooks/useRealtimePosts.ts
import { useEffect, useState } from "react";
import { RealtimeChannel } from "@supabase/supabase-js";

export function useRealtimePosts(userId: string) {
  const [posts, setPosts] = useState<any[]>([]);
  const supabase = createBrowserSupabaseClient();

  useEffect(() => {
    // Initial fetch with Prisma (via API)
    fetch("/api/posts")
      .then((res) => res.json())
      .then(setPosts);

    // Subscribe to realtime changes
    const channel: RealtimeChannel = supabase
      .channel("posts-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "posts",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setPosts((prev) => [payload.new, ...prev]);
          } else if (payload.eventType === "UPDATE") {
            setPosts((prev) =>
              prev.map((p) => (p.id === payload.new.id ? payload.new : p))
            );
          } else if (payload.eventType === "DELETE") {
            setPosts((prev) => prev.filter((p) => p.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  return posts;
}

// =============================================================================
// Storage: Upload with Prisma Metadata
// =============================================================================

export async function uploadWithMetadata(
  file: File,
  postId: string,
  userId: string
) {
  const supabase = createServerSupabaseClient();

  // Upload to Supabase Storage
  const filename = `${userId}/${postId}/${file.name}`;
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from("post-attachments")
    .upload(filename, file);

  if (uploadError) {
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  // Get public URL
  const {
    data: { publicUrl },
  } = supabase.storage.from("post-attachments").getPublicUrl(filename);

  // Store metadata in Prisma
  const media = await prisma.media.create({
    data: {
      url: publicUrl,
      filename: file.name,
      size: file.size,
      mimeType: file.type,
      type: file.type.startsWith("image/") ? "IMAGE" : "DOCUMENT",
      attachableType: "Post",
      attachableId: postId,
      postId,
    },
  });

  return media;
}

// =============================================================================
// Admin: Service Role Operations (Bypasses RLS)
// =============================================================================

export async function adminGetAllUsers() {
  // Use service role for admin operations
  const supabase = createServiceRoleClient();

  // Get auth users
  const { data: authUsers, error } = await supabase.auth.admin.listUsers();

  if (error) {
    throw error;
  }

  // Get profile data from Prisma
  const profiles = await prisma.profile.findMany({
    include: {
      _count: {
        select: {
          posts: true,
        },
      },
    },
  });

  // Merge data
  return authUsers.users.map((authUser) => {
    const profile = profiles.find((p) => p.userId === authUser.id);
    return {
      id: authUser.id,
      email: authUser.email,
      lastSignIn: authUser.last_sign_in_at,
      profile,
      postCount: profile?._count?.posts ?? 0,
    };
  });
}

export async function adminDeleteUser(userId: string) {
  const supabase = createServiceRoleClient();

  // Delete from Prisma first (cascade will handle related records)
  await prisma.profile.delete({
    where: { userId },
  });

  // Then delete from Supabase Auth
  const { error } = await supabase.auth.admin.deleteUser(userId);

  if (error) {
    throw error;
  }

  return { success: true };
}

// =============================================================================
// Database Trigger: Sync Auth to Profile (SQL)
// =============================================================================

/**
 * Run this SQL in Supabase SQL Editor to auto-create profiles:
 *
 * -- Function to handle new user signup
 * CREATE OR REPLACE FUNCTION public.handle_new_user()
 * RETURNS trigger AS $$
 * BEGIN
 *   INSERT INTO public.profiles (user_id, email, username, created_at, updated_at)
 *   VALUES (
 *     new.id,
 *     new.email,
 *     COALESCE(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
 *     now(),
 *     now()
 *   );
 *   RETURN new;
 * END;
 * $$ LANGUAGE plpgsql SECURITY DEFINER;
 *
 * -- Trigger on auth.users
 * CREATE OR REPLACE TRIGGER on_auth_user_created
 *   AFTER INSERT ON auth.users
 *   FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
 */

// =============================================================================
// Middleware: Auth Check for Protected Routes
// =============================================================================

// middleware.ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set({
            name,
            value,
            ...options,
          });
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set({
            name,
            value: "",
            ...options,
          });
        },
      },
    }
  );

  const {
    data: { session },
  } = await supabase.auth.getSession();

  // Protect dashboard routes
  if (!session && request.nextUrl.pathname.startsWith("/dashboard")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
};

-- =============================================================================
-- Row Level Security (RLS) Migration Template
--
-- Template Variables:
--   table: Table name (e.g., "Post", "posts")
--   schema: Schema name (default: "public")
--   policies: Array of policy definitions
--   enable_realtime: boolean - Enable Supabase Realtime
--
-- Output: prisma/migrations/rls/{{ table | lower }}_rls.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enable RLS on {{ table }}
-- -----------------------------------------------------------------------------

ALTER TABLE "{{ schema | default('public') }}"."{{ table }}" ENABLE ROW LEVEL SECURITY;

-- Force RLS for table owners (important for security)
ALTER TABLE "{{ schema | default('public') }}"."{{ table }}" FORCE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- Drop Existing Policies (for idempotent migrations)
-- -----------------------------------------------------------------------------

{% for policy in policies %}
DROP POLICY IF EXISTS "{{ policy.name | replace(' ', '_') }}" ON "{{ schema | default('public') }}"."{{ table }}";
{% endfor %}

-- -----------------------------------------------------------------------------
-- Create Policies
-- -----------------------------------------------------------------------------

{% for policy in policies %}
-- Policy: {{ policy.name }}
-- Description: {{ policy.description | default('') }}
CREATE POLICY "{{ policy.name | replace(' ', '_') }}"
ON "{{ schema | default('public') }}"."{{ table }}"
{% if policy.operation == 'ALL' %}
FOR ALL
{% elif policy.operation == 'SELECT' %}
FOR SELECT
{% elif policy.operation == 'INSERT' %}
FOR INSERT
{% elif policy.operation == 'UPDATE' %}
FOR UPDATE
{% elif policy.operation == 'DELETE' %}
FOR DELETE
{% endif %}
{% if policy.role %}
TO {{ policy.role }}
{% else %}
TO authenticated
{% endif %}
{% if policy.using %}
USING ({{ policy.using }})
{% endif %}
{% if policy.with_check %}
WITH CHECK ({{ policy.with_check }})
{% endif %};

{% endfor %}

-- -----------------------------------------------------------------------------
-- Service Role Bypass
-- -----------------------------------------------------------------------------

-- Service role always has full access (bypasses RLS)
-- This is automatic in Supabase but explicit here for clarity
GRANT ALL ON "{{ schema | default('public') }}"."{{ table }}" TO service_role;

{% if enable_realtime %}
-- -----------------------------------------------------------------------------
-- Realtime Configuration
-- -----------------------------------------------------------------------------

-- Enable Realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE "{{ schema | default('public') }}"."{{ table }}";
{% endif %}

-- =============================================================================
-- Common RLS Patterns
-- =============================================================================

/*
-- Pattern 1: Owner-based access (users can only access their own rows)
CREATE POLICY "Users can manage own records"
ON "public"."profiles"
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Pattern 2: Public read, owner write
CREATE POLICY "Anyone can read published"
ON "public"."posts"
FOR SELECT
TO anon, authenticated
USING (published = true);

CREATE POLICY "Authors can manage own posts"
ON "public"."posts"
FOR ALL
TO authenticated
USING (auth.uid() = author_id)
WITH CHECK (auth.uid() = author_id);

-- Pattern 3: Role-based access
CREATE POLICY "Admins have full access"
ON "public"."posts"
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.user_id = auth.uid()
    AND profiles.role = 'ADMIN'
  )
);

-- Pattern 4: Team/Organization access
CREATE POLICY "Team members can access team resources"
ON "public"."documents"
FOR ALL
TO authenticated
USING (
  team_id IN (
    SELECT team_id FROM team_members
    WHERE user_id = auth.uid()
  )
);

-- Pattern 5: Time-based access
CREATE POLICY "Access only recent records"
ON "public"."logs"
FOR SELECT
TO authenticated
USING (
  created_at > NOW() - INTERVAL '30 days'
);

-- Pattern 6: Hierarchical access (parent-child)
CREATE POLICY "Access based on parent ownership"
ON "public"."comments"
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM posts
    WHERE posts.id = comments.post_id
    AND posts.author_id = auth.uid()
  )
);

-- Pattern 7: Custom JWT claims
CREATE POLICY "Access based on custom claims"
ON "public"."premium_content"
FOR SELECT
TO authenticated
USING (
  (auth.jwt() -> 'user_metadata' ->> 'subscription') = 'premium'
);
*/

-- =============================================================================
-- Helper Functions
-- =============================================================================

/*
-- Check if user has specific role
CREATE OR REPLACE FUNCTION auth.has_role(required_role TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid()
    AND role = required_role
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get current user's team IDs
CREATE OR REPLACE FUNCTION auth.user_team_ids()
RETURNS UUID[] AS $$
BEGIN
  RETURN ARRAY(
    SELECT team_id FROM public.team_members
    WHERE user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Usage in policy:
-- USING (team_id = ANY(auth.user_team_ids()))
*/

-- =============================================================================
-- Verification Queries
-- =============================================================================

/*
-- Check RLS is enabled
SELECT
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = '{{ table | lower }}';

-- List policies on table
SELECT
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = '{{ table | lower }}';

-- Test as specific user
SET ROLE authenticated;
SET request.jwt.claim.sub = 'user-uuid-here';
SELECT * FROM "public"."{{ table }}";
RESET ROLE;
*/

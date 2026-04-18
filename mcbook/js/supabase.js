import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

const SUPABASE_URL      = 'https://uijudgnqawtvjyjuyuwo.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVpanVkZ25xYXd0dmp5anV5dXdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1MjI1NDQsImV4cCI6MjA5MTA5ODU0NH0.MkIJL-GmeAzUsyinykQWa0-4mjAWTf-WEuZelLouDYg'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession:   true,
    storageKey:       'mcbook-auth',
    storage:          window.localStorage,
    autoRefreshToken: true,
  }
})

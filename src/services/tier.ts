import type { UserTier } from '../types/index.ts';
import { getUser } from './auth.ts';

const TIER_HIERARCHY: UserTier[] = ['guest', 'free', 'premium'];

export function getCurrentTier(): UserTier {
  const user = getUser();
  return user?.tier || 'guest';
}

export function hasAccess(requiredTier: UserTier): boolean {
  const user = getUser();
  if (user?.isAdmin) return true;
  const currentTier = getCurrentTier();
  return TIER_HIERARCHY.indexOf(currentTier) >= TIER_HIERARCHY.indexOf(requiredTier);
}

export function isAdmin(): boolean {
  const user = getUser();
  return !!user?.isAdmin;
}

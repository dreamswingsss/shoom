// Shared by every screen that shows the small violet-gradient avatar
// (WardrobeScreen hub header, PlannerScreen header, ProfileScreen) — one
// place so "AK" vs "A" vs "?" fallback logic can't drift between them.
export function getInitials(name) {
  if (!name) return '?';
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

import { Text } from 'react-native';
import { typography } from '../theme/tokens';

// Thin wrappers around <Text> that apply a typography token. Not yet wired
// into existing screens (those already reference `typography.*` directly
// in their StyleSheets) — available for new screens/components going
// forward so call sites don't have to import the raw token.

export function H1({ style, ...props }) {
  return <Text style={[typography.h1, style]} {...props} />;
}

export function H2({ style, ...props }) {
  return <Text style={[typography.h2, style]} {...props} />;
}

export function Title({ style, ...props }) {
  return <Text style={[typography.title, style]} {...props} />;
}

export function SerifText({ style, ...props }) {
  return <Text style={[typography.serif, style]} {...props} />;
}

export function Body({ size = 'md', style, ...props }) {
  const key = size === 'sm' ? 'bodySecondary' : 'body';
  return <Text style={[typography[key], style]} {...props} />;
}

export function Label({ style, ...props }) {
  return <Text style={[typography.label, style]} {...props} />;
}

export function Caption({ style, ...props }) {
  return <Text style={[typography.caption, style]} {...props} />;
}

import { useEffect, useRef } from 'react';
import { Animated, Pressable } from 'react-native';
import { animation } from '../theme/tokens';

// Press feedback: scale + opacity. Not yet wired into existing screens
// (those use plain TouchableOpacity/Pressable) — available for new UI.
export function AnimatedPressable({
  onPress,
  style,
  children,
  activeScale = animation.cardActiveScale,
  activeOpacity = animation.buttonActiveOpacity,
  ...props
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  function animateIn() {
    Animated.parallel([
      Animated.timing(scale, {
        toValue: activeScale,
        duration: animation.transitionDuration,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: activeOpacity,
        duration: animation.transitionDuration,
        useNativeDriver: true,
      }),
    ]).start();
  }

  function animateOut() {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 5, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();
  }

  return (
    <Pressable onPress={onPress} onPressIn={animateIn} onPressOut={animateOut} {...props}>
      <Animated.View style={[style, { transform: [{ scale }], opacity }]}>{children}</Animated.View>
    </Pressable>
  );
}

// Fade + slide-up on mount, with an optional stagger delay for cascading lists.
export function FadeInView({ delay = 0, duration = 400, style, children }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration, delay, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration, delay, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[style, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
      {children}
    </Animated.View>
  );
}

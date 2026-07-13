import { useCallback, useRef } from 'react';
import { Animated } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

// Returns an Animated.Value that fades 0 -> 1 every time the screen gains
// focus (initial mount included) — so switching tabs never "pops" content
// in instantly.
export function useFadeOnFocus(duration = 350) {
  const opacity = useRef(new Animated.Value(0)).current;

  useFocusEffect(
    useCallback(() => {
      opacity.setValue(0);
      Animated.timing(opacity, {
        toValue: 1,
        duration,
        useNativeDriver: true,
      }).start();
    }, [duration])
  );

  return opacity;
}
